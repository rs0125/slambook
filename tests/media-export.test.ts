import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { validateImage } from "../src/lib/image-validation";
import {
  collectExportEntries,
  createExportStream,
  EXPORT_PAGE_SIZE,
} from "../src/lib/export";
import { emptyEntry, type EntryRecord } from "../src/lib/questions";

test("server decodes each supported format and rejects spoofed, corrupt, mismatched, and oversized bytes", async () => {
  for (const type of ["jpeg", "png", "webp"] as const) {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#ffd7f0" },
    })
      [type]()
      .toBuffer();
    await validateImage(bytes, {
      size_bytes: bytes.length,
      mime_type: `image/${type}`,
    });
    await assert.rejects(
      validateImage(bytes, {
        size_bytes: bytes.length + 1,
        mime_type: `image/${type}`,
      }),
    );
    await assert.rejects(
      validateImage(bytes, {
        size_bytes: bytes.length,
        mime_type: "image/svg+xml",
      }),
    );
    const truncated = bytes.subarray(0, 20);
    await assert.rejects(
      validateImage(truncated, {
        size_bytes: truncated.length,
        mime_type: `image/${type}`,
      }),
    );
  }
  const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(
    validateImage(fake, { size_bytes: fake.length, mime_type: "image/jpeg" }),
  );
  await assert.rejects(
    validateImage(new Uint8Array(2097153), {
      size_bytes: 2097153,
      mime_type: "image/jpeg",
    }),
  );
});
test("the export connects complete answers, captions and exact image bytes with a manifest", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const entry: EntryRecord = {
    ...emptyEntry,
    name: "A friend",
    id: "entry-id",
    created_at: "2026-11-24T00:00:00Z",
    questionnaire_version: 1,
    entry_media: [
      {
        id: "photo-id",
        entry_id: "entry-id",
        storage_path: "private/path.jpg",
        caption: "The good days",
        size_bytes: 4,
        mime_type: "image/jpeg",
        sort_order: 0,
      },
    ],
  };
  const response = new Response(
    createExportStream([entry], async (path) => {
      assert.equal(path, "private/path.jpg");
      return bytes;
    }),
  );
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.entries[0].photos[0].caption, "The good days");
  assert.deepEqual(files[manifest.entries[0].photos[0].file], bytes);
  const answers = JSON.parse(strFromU8(files["entries.json"]));
  assert.equal(answers.entries[0].name, "A friend");
  assert.deepEqual(answers.entries[0].photo_ids, ["photo-id"]);
});
test("an export fails visibly instead of silently dropping a missing photo", async () => {
  const entry: EntryRecord = {
    ...emptyEntry,
    name: "Friend",
    id: "entry",
    created_at: "2026-11-24T00:00:00Z",
    questionnaire_version: 1,
    entry_media: [
      {
        id: "photo",
        entry_id: "entry",
        storage_path: "missing",
        caption: "",
        size_bytes: 4,
        mime_type: "image/jpeg",
        sort_order: 0,
      },
    ],
  };
  await assert.rejects(
    new Response(
      createExportStream([entry], async () => {
        throw new Error("missing photo");
      }),
    ).arrayBuffer(),
    /missing photo/,
  );
});

function photoEntry(): EntryRecord {
  return {
    ...emptyEntry,
    name: "Friend",
    id: "entry",
    created_at: "2026-11-24T00:00:00Z",
    questionnaire_version: 1,
    entry_media: [
      {
        id: "photo",
        entry_id: "entry",
        storage_path: "private/photo.jpg",
        caption: "",
        size_bytes: 4,
        mime_type: "image/jpeg",
        sort_order: 0,
      },
    ],
  };
}

test("an export rejects a truncated photo instead of emitting a misleading complete ZIP", async () => {
  await assert.rejects(
    new Response(
      createExportStream([photoEntry()], async () => new Uint8Array([1, 2])),
    ).arrayBuffer(),
    /photo download was incomplete/,
  );
});

test("cancelling an export aborts its in-flight download, even if the downloader never settles", async () => {
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let downloadSignal: AbortSignal | undefined;
  const reader = createExportStream([photoEntry()], (_path, signal) => {
    downloadSignal = signal;
    started();
    return new Promise<Uint8Array>(() => {});
  }).getReader();
  const reading = (async () => {
    while (!(await reader.read()).done) {
      /* consume archive headers */
    }
  })();
  await downloading;
  await reader.cancel();
  await reading;
  assert.equal(downloadSignal?.aborted, true);
});

test("disconnecting the HTTP request interrupts an export with the original abort reason", async () => {
  const request = new AbortController();
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const reading = new Response(
    createExportStream(
      [photoEntry()],
      () => {
        started();
        return new Promise<Uint8Array>(() => {});
      },
      request.signal,
    ),
  ).arrayBuffer();
  const reason = new DOMException("Client disconnected", "AbortError");
  const rejected = assert.rejects(
    reading,
    (error: unknown) => error === reason,
  );
  await downloading;
  request.abort(reason);
  await rejected;
});

test("export pagination retains every later entry when an earlier page is deleted", async () => {
  const original = Array.from(
    { length: EXPORT_PAGE_SIZE * 2 + 5 },
    (_, index) => ({
      ...photoEntry(),
      id: String(index).padStart(4, "0"),
      // Tie an entire page on timestamp so the ID tie-breaker is exercised too.
      created_at: index < 150 ? "2026-11-23T00:00:00Z" : "2026-11-24T00:00:00Z",
      entry_media: [],
    }),
  );
  let live = [...original];
  let page = 0;
  const exported = await collectExportEntries(async (cursor) => {
    const batch = live
      .filter(
        (entry) =>
          !cursor ||
          entry.created_at > cursor.created_at ||
          (entry.created_at === cursor.created_at && entry.id > cursor.id),
      )
      .slice(0, EXPORT_PAGE_SIZE);
    if (++page === 1) live = live.slice(30);
    return batch;
  });
  assert.deepEqual(
    exported.map((entry) => entry.id),
    original.map((entry) => entry.id),
  );
  assert.equal(page, 3);
});
