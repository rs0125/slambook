import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { emptyEntry } from "../src/lib/questions";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const entry = {
  ...emptyEntry,
  name: "Same name",
  answers: {
    ...emptyEntry.answers,
    how_we_met: "At school",
    favourite_memory: "A long walk",
  },
};
let db: PGlite;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  for (const file of [
    "202611240001_slambook",
    "202611240002_cleanup",
    "202611260001_direct_database",
  ])
    await db.exec(
      await readFile(
        new URL(`../prisma/migrations/${file}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.entry_media, public.entries, public.upload_files, public.submission_attempts, public.rate_limits cascade;",
  );
  await db.query(
    "update public.settings set owner_id = $1, submissions_open = true",
    [owner],
  );
});
after(async () => {
  await db?.close();
});
async function storePhoto(
  requestId: string,
  fileId: string,
  bytes = new Uint8Array(600),
  token = hash,
) {
  return db.query("select public.store_photo($1::uuid,$2,$3::uuid,$4::bytea)", [
    requestId,
    token,
    fileId,
    bytes,
  ]);
}
async function prepare(id = randomUUID(), files: unknown[] = [], token = hash) {
  const result = await db.query<{
    result: { submitted: boolean; files: { storage_path: string }[] };
  }>("select public.prepare_uploads($1, $2, $3::jsonb) as result", [
    id,
    token,
    JSON.stringify(files),
  ]);
  return { id, result: result.rows[0].result };
}
async function finalize(
  id: string,
  media: unknown[] = [],
  payload = entry,
  token = hash,
) {
  const result = await db.query<{ id: string }>(
    "select public.finalize_entry($1, $2, $3::jsonb, $4::jsonb) as id",
    [id, token, JSON.stringify(payload), JSON.stringify(media)],
  );
  return result.rows[0].id;
}
async function asRole<T>(
  role: "anon" | "authenticated",
  user: string | null,
  run: () => Promise<T>,
) {
  await db.exec(`set role ${role}`);
  if (user)
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      user,
    ]);
  try {
    return await run();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
test("every application table enables RLS; the photo bucket is private with a hard limit", async () => {
  const { rows } = await db.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
  );
  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.relrowsecurity));
  const { rows: buckets } = await db.query<{
    public: boolean;
    file_size_limit: number;
  }>("select * from storage.buckets");
  assert.equal(buckets[0].public, false);
  assert.equal(Number(buckets[0].file_size_limit), 2097152);
});
test("anonymous and non-owner accounts cannot read entries, media or settings", async () => {
  const { id } = await prepare();
  await finalize(id);
  for (const [role, user] of [
    ["anon", null],
    ["authenticated", other],
  ] as const)
    await asRole(role, user, async () => {
      for (const table of ["entries", "entry_media", "settings"])
        assert.equal(
          (await db.query(`select * from public.${table}`)).rows.length,
          0,
        );
      await assert.rejects(
        db.query("select * from public.submission_attempts"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.prepare_uploads($1,$2,'[]')", [
          randomUUID(),
          hash,
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("insert into public.settings(id,owner_id) values(1,$1)", [
          other,
        ]),
        /permission denied/,
      );
    });
  await asRole("authenticated", owner, async () => {
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      1,
    );
  });
});
test("retries are idempotent, while separate deliberate entries can share a name", async () => {
  const first = await prepare();
  const a = await finalize(first.id);
  const b = await finalize(first.id);
  assert.equal(a, b);
  assert.equal((await prepare(first.id)).result.submitted, true);
  const second = await prepare();
  const c = await finalize(second.id);
  assert.notEqual(a, c);
  assert.equal((await db.query("select * from public.entries")).rows.length, 2);
});
test("an attempt cannot be stolen, including after it is complete", async () => {
  const { id } = await prepare();
  await assert.rejects(prepare(id, [], "b".repeat(64)), /INVALID_ATTEMPT/);
  await finalize(id);
  await assert.rejects(
    finalize(id, [], entry, "b".repeat(64)),
    /INVALID_ATTEMPT/,
  );
  await assert.rejects(prepare(id, [], "b".repeat(64)), /INVALID_ATTEMPT/);
});
test("closing submissions rejects authorisations and in-flight finalisation, but acknowledges old successes", async () => {
  const completed = await prepare();
  const completedId = await finalize(completed.id);
  const pending = await prepare();
  await db.exec("update public.settings set submissions_open = false");
  await assert.rejects(prepare(), /SUBMISSIONS_CLOSED/);
  await assert.rejects(prepare(pending.id), /SUBMISSIONS_CLOSED/);
  await assert.rejects(finalize(pending.id), /SUBMISSIONS_CLOSED/);
  assert.equal(await finalize(completed.id), completedId);
});
test("expired attempts reject upload authorisation and finalisation", async () => {
  const { id } = await prepare();
  await db.query(
    "update public.submission_attempts set expires_at = now() - interval '1 minute' where id=$1",
    [id],
  );
  await assert.rejects(prepare(id), /ATTEMPT_EXPIRED/);
  await assert.rejects(finalize(id), /ATTEMPT_EXPIRED/);
});
test("SQL validates upload counts, types, sizes and assigns its own paths", async () => {
  const file = {
    id: randomUUID(),
    size: 600,
    mime: "image/jpeg",
    storage_path: "attacker-chosen/path",
  };
  const { id, result } = await prepare(undefined, [file]);
  assert.equal(result.files[0].storage_path, `attempts/${id}/${file.id}.jpg`);
  await assert.rejects(
    prepare(
      undefined,
      Array.from({ length: 4 }, () => ({ ...file, id: randomUUID() })),
    ),
    /INVALID_MEDIA/,
  );
  await assert.rejects(
    prepare(undefined, [{ ...file, id: randomUUID(), size: 2097153 }]),
    /INVALID_MEDIA/,
  );
  await assert.rejects(
    prepare(undefined, [{ ...file, id: randomUUID(), mime: "image/svg+xml" }]),
    /INVALID_MEDIA/,
  );
  await assert.rejects(prepare(undefined, [file]), /INVALID_MEDIA/);
  await assert.rejects(prepare(id, [file, file]), /INVALID_MEDIA/);
});
test("an entry commits only once every selected upload is verified and owned by the attempt", async () => {
  const file = { id: randomUUID(), size: 600, mime: "image/jpeg" };
  const { id } = await prepare(undefined, [file]);
  const media = [{ id: file.id, caption: "A good day" }];
  await assert.rejects(finalize(id, media), /INVALID_MEDIA/);
  assert.equal((await db.query("select * from public.entries")).rows.length, 0);
  await db.query(
    "with blob as (insert into public.upload_blobs (id,bytes) select id, decode(repeat('00',size_bytes),'hex') from public.upload_files where id=$1) update public.upload_files set verified=true where id=$1",
    [file.id],
  );
  await assert.rejects(
    finalize(id, [{ id: randomUUID(), caption: "" }]),
    /INVALID_MEDIA/,
  );
  const entryId = await finalize(id, media);
  const { rows } = await db.query<{ entry_id: string; caption: string }>(
    "select * from public.entry_media",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry_id, entryId);
  assert.equal(rows[0].caption, "A good day");
});
test("manifest reconciliation permits photo removal, and never attaches retired slots", async () => {
  const photo = { id: randomUUID(), size: 600, mime: "image/png" };
  const { id } = await prepare(undefined, [photo]);
  await prepare(id, []);
  await assert.rejects(
    finalize(id, [{ id: photo.id, caption: "" }]),
    /INVALID_MEDIA/,
  );
  await finalize(id, []);
  assert.equal(
    (await db.query("select * from public.entry_media")).rows.length,
    0,
  );
});
test("SQL rejects missing and oversized answers without creating partial entries", async () => {
  const { id } = await prepare();
  await assert.rejects(
    finalize(id, [], { ...entry, name: " " }),
    /INVALID_ENTRY/,
  );
  await assert.rejects(
    finalize(id, [], {
      ...entry,
      answers: { ...entry.answers, favourite_memory: "x".repeat(2001) },
    }),
    /INVALID_ENTRY/,
  );
  assert.equal((await db.query("select * from public.entries")).rows.length, 0);
});
test("deletion tombstones immediately hide entries and retain an idempotency receipt", async () => {
  const { id } = await prepare();
  const entryId = await finalize(id);
  await db.query("update public.entries set deleted_at=now() where id=$1", [
    entryId,
  ]);
  await asRole("authenticated", owner, async () =>
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    ),
  );
  await db.query("delete from public.entries where id=$1", [entryId]);
  assert.equal(await finalize(id), entryId);
  assert.equal((await db.query("select * from public.entries")).rows.length, 0);
});
test("persistent rate limiting admits only the configured number of requests", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      db.query<{ ok: boolean }>(
        "select public.consume_rate_limit('ip-hash',5,3600) as ok",
      ),
    ),
  );
  assert.equal(results.filter((result) => result.rows[0].ok).length, 5);
  await db.exec(
    "update public.rate_limits set window_started_at=now()-interval '2 hours'",
  );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select public.consume_rate_limit('ip-hash',5,3600) as ok",
      )
    ).rows[0].ok,
    true,
  );
});
test("cleanup excludes referenced images and recent tokens, then removes abandoned uploads", async () => {
  const file = { id: randomUUID(), size: 600, mime: "image/jpeg" };
  const kept = await prepare(undefined, [file]);
  await db.query(
    "with blob as (insert into public.upload_blobs (id,bytes) select id, decode(repeat('00',size_bytes),'hex') from public.upload_files where id=$1) update public.upload_files set verified=true where id=$1",
    [file.id],
  );
  await finalize(kept.id, [{ id: file.id, caption: "" }]);
  const abandoned = await prepare(undefined, [{ ...file, id: randomUUID() }]);
  await db.exec(
    "update public.submission_attempts set created_at=now()-interval '27 hours', expires_at=now()-interval '3 hours'",
  );
  await prepare(undefined, [{ ...file, id: randomUUID() }]);
  const { rows } = await db.query<{ id: string }>(
    "select * from public.abandoned_uploads(now(),100)",
  );
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, file.id);
  await db.query("delete from public.upload_files where id=$1", [rows[0].id]);
  await db.query("select public.prune_empty_attempts(now())");
  assert.equal(
    (
      await db.query("select * from public.submission_attempts where id=$1", [
        abandoned.id,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("select * from public.submission_attempts where id=$1", [
        kept.id,
      ])
    ).rows.length,
    1,
  );
});

test("private photo writes verify the proof, active manifest and byte count; retries cannot overwrite", async () => {
  const file = { id: randomUUID(), size: 600, mime: "image/jpeg" };
  const { id } = await prepare(undefined, [file]);
  await assert.rejects(
    storePhoto(id, file.id, new Uint8Array(600), "b".repeat(64)),
    /INVALID_ATTEMPT/,
  );
  await assert.rejects(
    storePhoto(id, file.id, new Uint8Array(601)),
    /INVALID_MEDIA/,
  );
  await assert.rejects(storePhoto(id, randomUUID()), /INVALID_MEDIA/);
  await storePhoto(id, file.id, new Uint8Array(600).fill(5));
  await storePhoto(id, file.id, new Uint8Array(600).fill(9));
  const { rows } = await db.query<{ first_byte: number }>(
    "select get_byte(bytes,0) as first_byte from public.upload_blobs where id=$1",
    [file.id],
  );
  assert.equal(rows[0].first_byte, 5);
  await prepare(id, []);
  await assert.rejects(storePhoto(id, file.id), /INVALID_MEDIA/);
});

test("closed, expired and completed attempts cannot receive new photo bytes", async () => {
  const file = { id: randomUUID(), size: 600, mime: "image/jpeg" };
  const { id } = await prepare(undefined, [file]);
  await db.exec("update public.settings set submissions_open=false");
  await assert.rejects(storePhoto(id, file.id), /SUBMISSIONS_CLOSED/);
  await db.exec("update public.settings set submissions_open=true");
  await db.query(
    "update public.submission_attempts set expires_at=now()-interval '1 hour' where id=$1",
    [id],
  );
  await assert.rejects(storePhoto(id, file.id), /ATTEMPT_EXPIRED/);
  await db.query(
    "update public.submission_attempts set expires_at=now()+interval '1 hour' where id=$1",
    [id],
  );
  await storePhoto(id, file.id);
  await finalize(id, [{ id: file.id, caption: "" }]);
  await assert.rejects(storePhoto(id, file.id), /ATTEMPT_COMPLETED/);
});

test("deleting an entry atomically deletes photo bytes and metadata, while retaining the receipt", async () => {
  const file = { id: randomUUID(), size: 600, mime: "image/jpeg" };
  const { id } = await prepare(undefined, [file]);
  await storePhoto(id, file.id);
  const entryId = await finalize(id, [{ id: file.id, caption: "" }]);
  await db.query("delete from public.entries where id=$1", [entryId]);
  assert.equal(
    (await db.query("select * from public.upload_blobs")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.upload_files")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.entry_media")).rows.length,
    0,
  );
  assert.equal(await finalize(id), entryId);
});

test("photo bytes are inaccessible to public API roles; backend role cannot access Auth or insert unvalidated entries", async () => {
  for (const role of ["anon", "authenticated"] as const)
    await asRole(role, owner, async () => {
      await assert.rejects(
        db.query("select * from public.upload_blobs"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.store_photo($1,$2,$3,$4)", [
          randomUUID(),
          hash,
          randomUUID(),
          new Uint8Array(600),
        ]),
        /permission denied/,
      );
    });
  await db.exec("set role slambook_app");
  try {
    assert.equal(
      (await db.query("select * from public.settings")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("insert into public.entries default values"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("create table public.unexpected (id int)"),
      /permission denied/,
    );
    await assert.rejects(db.query("select auth.uid()"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
