import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { ApiError, handleError } from "@/lib/http";
import { database } from "@/lib/database";
import {
  collectExportEntries,
  createExportStream,
  EXPORT_PAGE_SIZE,
} from "@/lib/export";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
import { readPhoto, serializeEntry } from "@/lib/entries";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    await requireOwner();
    const demo = isLocalDemo() ? demoStore() : null;
    const db = demo ? null : database();
    const rawId = new URL(request.url).searchParams.get("id");
    const id = rawId ? z.uuid().parse(rawId) : undefined;
    const snapshot = new Date().toISOString();
    const entries = demo
      ? await demo.exportEntries(id)
      : await collectExportEntries(async (cursor) => {
          request.signal.throwIfAborted();
          const rows = await db!.entry.findMany({
            where: {
              deleted_at: null,
              created_at: { lte: new Date(snapshot) },
              ...(id && { id }),
              ...(cursor && {
                OR: [
                  { created_at: { gt: new Date(cursor.created_at) } },
                  {
                    created_at: new Date(cursor.created_at),
                    id: { gt: cursor.id },
                  },
                ],
              }),
            },
            include: { entry_media: { orderBy: { sort_order: "asc" } } },
            orderBy: [{ created_at: "asc" }, { id: "asc" }],
            take: EXPORT_PAGE_SIZE,
          });
          request.signal.throwIfAborted();
          return rows.map(serializeEntry);
        });
    if (id && !entries.length)
      throw new ApiError(404, "This entry could not be found.");
    entries.forEach((entry) =>
      entry.entry_media.sort((a, b) => a.sort_order - b.sort_order),
    );
    const stream = createExportStream(
      entries,
      async (path, signal) => {
        if (demo) return demo.download(path, signal);
        const photo = await readPhoto({ storage_path: path }, signal);
        if (!photo)
          throw new Error(
            "Export interrupted: a photo could not be downloaded.",
          );
        return photo.bytes;
      },
      request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="raghavs-slambook-${snapshot.slice(0, 10)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
