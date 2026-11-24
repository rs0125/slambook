import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DemoStore } from "../src/lib/demo-store";
import { isDemoHost, isLocalDemo } from "../src/lib/demo-mode";
import { emptyEntry, submissionSchema } from "../src/lib/questions";

const attempt = () => ({
  requestId: randomUUID(),
  attemptToken: randomBytes(32).toString("hex"),
});
const entry = (name: string) => ({
  ...emptyEntry,
  name,
  answers: {
    ...emptyEntry.answers,
    how_we_met: "At school.",
    favourite_memory: "The class trip.",
  },
});

test("demo authentication bypass requires explicit local development and a loopback host", () => {
  assert.equal(isLocalDemo({ NODE_ENV: "development" }), false);
  assert.equal(
    isLocalDemo({ NODE_ENV: "development", SLAMBOOK_DEMO: "1" }),
    true,
  );
  for (const NODE_ENV of ["production", "test"] as const)
    assert.equal(isLocalDemo({ NODE_ENV, SLAMBOOK_DEMO: "1" }), false);
  assert.equal(
    isLocalDemo({ NODE_ENV: "development", SLAMBOOK_DEMO: "1", VERCEL: "1" }),
    false,
  );
  for (const host of ["localhost:6001", "127.0.0.1:6001", "[::1]:6001"])
    assert.equal(isDemoHost(host), true);
  for (const host of [
    null,
    "example.com:6001",
    "localhost.evil.test:6001",
    "localhost:6000",
    "evil@localhost:6001",
    "localhost:6001/",
    "localhost:6001/path",
    "localhost:6001?query",
    "localhost:6001#fragment",
    "localhost:6001\\evil",
    " localhost:6001",
    "localhost:6001\n",
  ])
    assert.equal(isDemoHost(host), false);
});

test("demo seeds once, persists concurrent submissions, and retains deletion receipts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slambook-demo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DemoStore(directory);
  assert.equal((await store.list()).total, 6);
  const inputs = Array.from({ length: 4 }, (_, index) =>
    submissionSchema.parse({
      ...attempt(),
      entry: entry(`Test friend ${index}`),
      media: [],
    }),
  );
  await Promise.all(
    inputs.map(async (input) => {
      await store.prepare({ ...input, files: [] });
      await store.submit(input);
      await store.submit(input);
    }),
  );
  assert.equal((await store.list()).total, 10);
  const reopened = new DemoStore(directory);
  assert.equal((await reopened.list("test friend")).total, 4);
  const saved = (await reopened.list("Test friend 0")).entries[0];
  await reopened.delete(saved.id);
  await reopened.submit(inputs[0]);
  assert.equal((await reopened.list()).total, 9);
  assert.equal(await reopened.get(saved.id), null);
  await assert.rejects(
    reopened.prepare({ ...inputs[1], attemptToken: "0".repeat(64), files: [] }),
    /verified/,
  );
  await reopened.updateSettings({ submissions_open: false });
  await assert.rejects(reopened.prepare({ ...attempt(), files: [] }), /closed/);
  assert.deepEqual(await reopened.submit(inputs[1]), { submitted: true });
});

test("demo validates photo bytes and persists, exports, and removes uploaded files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slambook-demo-photo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DemoStore(directory);
  const proof = attempt();
  const bytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#ffd7f0" },
  })
    .jpeg()
    .toBuffer();
  const photo = {
    id: randomUUID(),
    size: bytes.length,
    mime: "image/jpeg" as const,
  };
  await store.prepare({ ...proof, files: [photo] });
  const input = submissionSchema.parse({
    ...proof,
    entry: entry("Photo friend"),
    media: [{ id: photo.id, caption: "A happy day" }],
  });
  await assert.rejects(store.submit(input), /uploading/);
  await assert.rejects(
    store.putPhoto(
      proof.requestId,
      proof.attemptToken,
      photo.id,
      Buffer.alloc(bytes.length),
      photo.mime,
    ),
    /valid JPEG/,
  );
  await store.putPhoto(
    proof.requestId,
    proof.attemptToken,
    photo.id,
    bytes,
    photo.mime,
  );
  await store.submit(input);
  const reopened = new DemoStore(directory);
  const saved = (await reopened.list("Photo friend")).entries[0];
  assert.deepEqual((await reopened.photo(photo.id)).bytes, bytes);
  assert.deepEqual(
    await reopened.download(saved.entry_media[0].storage_path),
    new Uint8Array(bytes),
  );
  assert.equal(
    (await reopened.exportEntries(saved.id))[0].entry_media[0].caption,
    "A happy day",
  );
  await reopened.delete(saved.id);
  await assert.rejects(reopened.photo(photo.id), /could not be found/);
  await assert.rejects(
    readFile(join(directory, saved.entry_media[0].storage_path)),
    { code: "ENOENT" },
  );
});

test("unreadable demo state fails without overwriting saved data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slambook-demo-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "state.json"), "incomplete JSON");
  await assert.rejects(new DemoStore(directory).list());
  assert.equal(
    await readFile(join(directory, "state.json"), "utf8"),
    "incomplete JSON",
  );
});

test("valid JSON with incompatible or damaged demo structure is never overwritten", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slambook-demo-shape-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DemoStore(directory);
  await store.settings();
  const valid = JSON.parse(
    await readFile(join(directory, "state.json"), "utf8"),
  );
  for (const broken of [
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, entries: {} },
    { ...valid, attempts: [] },
  ]) {
    const raw = JSON.stringify(broken);
    await writeFile(join(directory, "state.json"), raw);
    await assert.rejects(
      store.updateSettings({ submissions_open: false }),
      /needs repair/,
    );
    assert.equal(await readFile(join(directory, "state.json"), "utf8"), raw);
  }
});

test("failed demo photo deletion is durable and retried after reopening the store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slambook-demo-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DemoStore(directory);
  const proof = attempt();
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "pink" },
  })
    .jpeg()
    .toBuffer();
  const file = {
    id: randomUUID(),
    size: bytes.length,
    mime: "image/jpeg" as const,
  };
  await store.prepare({ ...proof, files: [file] });
  await store.putPhoto(
    proof.requestId,
    proof.attemptToken,
    file.id,
    bytes,
    file.mime,
  );
  await store.submit(
    submissionSchema.parse({
      ...proof,
      entry: entry("Cleanup friend"),
      media: [{ id: file.id, caption: "" }],
    }),
  );
  const saved = (await store.list("Cleanup friend")).entries[0];
  const relative = saved.entry_media[0].storage_path;
  const path = join(directory, relative);
  // A directory at the expected file path causes unlink to fail even as root.
  await rm(path);
  await mkdir(path);
  assert.equal(await store.delete(saved.id), false);
  assert.equal(await store.get(saved.id), null);
  await assert.rejects(store.photo(file.id), /could not be found/);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8"))
      .pendingDeletions,
    [relative],
  );
  await rm(path, { recursive: true });
  await writeFile(path, bytes);
  await new DemoStore(directory).settings();
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8"))
      .pendingDeletions,
    [],
  );
});
