import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { EntryRecord } from "./questions";

export const EXPORT_PAGE_SIZE = 100;
export type ExportCursor = Pick<EntryRecord, "created_at" | "id">;

// An offset moves when earlier entries are deleted. Resume after the last
// immutable (timestamp, id) instead, including when timestamps are identical.
export async function collectExportEntries(
  readPage: (cursor?: ExportCursor) => Promise<EntryRecord[]>,
) {
  const entries: EntryRecord[] = [];
  let cursor: ExportCursor | undefined;
  for (;;) {
    const batch = await readPage(cursor);
    entries.push(...batch);
    if (batch.length < EXPORT_PAGE_SIZE) return entries;
    const last = batch[batch.length - 1];
    cursor = { created_at: last.created_at, id: last.id };
  }
}

function downloadWithAbort(
  download: () => Promise<Uint8Array>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return new Promise<Uint8Array>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    // Also settle cancellation when a download implementation ignores its signal.
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return download();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createExportStream(
  entries: EntryRecord[],
  download: (path: string, signal: AbortSignal) => Promise<Uint8Array>,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const disconnect = () => signal?.removeEventListener("abort", onAbort);
  let cancelled = false;
  async function* generate() {
    const pending: Uint8Array[] = [];
    const zip = new Zip((error, data) => {
      if (error) throw error;
      if (data.length) pending.push(data);
    });
    const add = (path: string, data: Uint8Array) => {
      const file = new ZipPassThrough(path);
      zip.add(file);
      file.push(data, true);
    };
    try {
      controller.signal.throwIfAborted();
      const createdAt = new Date().toISOString();
      const manifest = entries.map((entry) => ({
        entry_id: entry.id,
        name: entry.name,
        photos: entry.entry_media.map((media) => ({
          id: media.id,
          file: `photos/${entry.id}/${media.id}.${media.mime_type === "image/png" ? "png" : media.mime_type === "image/webp" ? "webp" : "jpg"}`,
          caption: media.caption,
          size_bytes: media.size_bytes,
          mime_type: media.mime_type,
          sort_order: media.sort_order,
        })),
      }));
      add(
        "entries.json",
        strToU8(
          JSON.stringify(
            {
              exported_at: createdAt,
              entries: entries.map(({ entry_media, ...entry }) => ({
                ...entry,
                photo_ids: entry_media.map((media) => media.id),
              })),
            },
            null,
            2,
          ),
        ),
      );
      add(
        "manifest.json",
        strToU8(
          JSON.stringify(
            { exported_at: createdAt, format_version: 1, entries: manifest },
            null,
            2,
          ),
        ),
      );
      add(
        "README.txt",
        strToU8(
          "Raghav’s Slambook — private archive\n\nentries.json contains all answers. manifest.json connects each entry and caption to files in photos/. These are private contributions, not permission to publish. Keep this archive somewhere safe.\n",
        ),
      );
      while (pending.length) yield pending.shift()!;
      for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < entries[i].entry_media.length; j++) {
          const media = entries[i].entry_media[j];
          const bytes = await downloadWithAbort(
            () => download(media.storage_path, controller.signal),
            controller.signal,
          );
          controller.signal.throwIfAborted();
          if (bytes.byteLength !== media.size_bytes)
            throw new Error(
              "Export interrupted: a photo download was incomplete.",
            );
          add(manifest[i].photos[j].file, bytes);
          while (pending.length) yield pending.shift()!;
        }
      }
      zip.end();
      while (pending.length) yield pending.shift()!;
    } finally {
      zip.terminate();
      pending.length = 0;
      disconnect();
    }
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (cancelled) return;
        if (item.done) controller.close();
        else controller.enqueue(item.value);
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      controller.abort();
      disconnect();
      await iterator.return();
    },
  });
}
