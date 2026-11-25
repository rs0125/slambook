import "server-only";
import { database } from "@/lib/database";
import { entryRecordSchema, type EntryRecord } from "@/lib/questions";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
import { literalSearchValue } from "@/lib/search";
import type { Prisma } from "@/generated/prisma/client";

export function serializeEntry(
  row: Prisma.EntryGetPayload<{ include: { entry_media: true } }>,
): EntryRecord {
  return entryRecordSchema.parse({
    ...row,
    created_at: row.created_at.toISOString(),
  });
}

export async function listEntries(search = "", page = 1) {
  if (isLocalDemo()) return demoStore().list(search, page);
  const db = database();
  const clean = literalSearchValue(search);
  const where: Prisma.EntryWhereInput = {
    deleted_at: null,
    ...(clean && {
      OR: [
        { name: { contains: clean, mode: "insensitive" } },
        { nickname: { contains: clean, mode: "insensitive" } },
      ],
    }),
  };
  const [entries, total] = await db.$transaction(
    [
      db.entry.findMany({
        where,
        include: { entry_media: { orderBy: { sort_order: "asc" } } },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * 12,
        take: 12,
      }),
      db.entry.count({ where }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return { entries: entries.map(serializeEntry), total, page };
}

export async function getEntry(id: string): Promise<EntryRecord | null> {
  if (isLocalDemo()) return demoStore().get(id);
  const row = await database().entry.findFirst({
    where: { id, deleted_at: null },
    include: { entry_media: { orderBy: { sort_order: "asc" } } },
  });
  return row ? serializeEntry(row) : null;
}

export async function deleteEntry(id: string): Promise<boolean> {
  if (isLocalDemo()) return demoStore().delete(id);
  // Database cascades/trigger remove metadata and photo bytes in this statement.
  // The separate completed-attempt receipt survives deletion.
  await database().entry.deleteMany({ where: { id } });
  return true;
}

export async function readPhoto(
  where: { id?: string; storage_path?: string },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const photo = await database().entryMedia.findFirst({
    where: { ...where, entry: { deleted_at: null } },
    select: {
      mime_type: true,
      file: { select: { blob: { select: { bytes: true } } } },
    },
  });
  signal?.throwIfAborted();
  if (!photo?.file.blob) return null;
  return {
    mime: photo.mime_type,
    bytes: new Uint8Array(photo.file.blob.bytes),
  };
}
