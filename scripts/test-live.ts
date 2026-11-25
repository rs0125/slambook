// Opt-in integration test. Deletes only the UUIDs created by this run.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { createDatabaseClient } from "../src/lib/database-client";
import { emptyEntry } from "../src/lib/questions";

if (process.env.RUN_LIVE_TESTS !== "1")
  throw new Error(
    "Live tests require explicit RUN_LIVE_TESTS=1 and a disposable test run.",
  );
const origin = process.env.TEST_BASE_URL || "http://localhost:6001";
const email = process.env.TEST_OWNER_EMAIL;
const password = process.env.TEST_OWNER_PASSWORD;
if (
  !email ||
  !password ||
  !process.env.DATABASE_URL ||
  !process.env.CRON_SECRET
)
  throw new Error(
    "Supply test owner credentials, DATABASE_URL and CRON_SECRET through the environment.",
  );

const db = createDatabaseClient(process.env.DATABASE_URL);
const attempts: { requestId: string; attemptToken: string }[] = [];
const attempt = () => {
  const value = {
    requestId: randomUUID(),
    attemptToken: randomBytes(32).toString("hex"),
  };
  attempts.push(value);
  return value;
};
let cookie = "";
let step = "setup";
const report = (label: string) => {
  console.log(`PASS ${label}`);
  step = label;
};
const counters = ["login", "upload", "photo", "submit"].map((action) =>
  createHmac("sha256", process.env.RATE_LIMIT_SECRET!)
    .update(`${action}:shared-origin`)
    .digest("hex"),
);
const previousCounters = await db.rateLimit.findMany({
  where: { key: { in: counters } },
  select: { key: true },
});
const before = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
async function request(path: string, init: RequestInit = {}, owner = false) {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  if (owner && cookie) headers.set("Cookie", cookie);
  return fetch(new URL(path, origin), {
    ...init,
    headers,
    signal: AbortSignal.timeout(70_000),
  });
}
async function json(
  path: string,
  body: unknown,
  expected = 200,
  owner = false,
  method = "POST",
) {
  const response = await request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    owner,
  );
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path}: status ${response.status}, code ${result.code || "none"}`,
  );
  return result;
}
try {
  step = "anonymous access";
  for (const path of [
    "/api/admin/session",
    "/api/admin/entries",
    "/api/admin/export",
    "/api/cron/cleanup",
  ])
    assert.equal((await request(path)).status, 401, path);
  const wrongOrigin = await fetch(new URL("/api/uploads", origin), {
    method: "POST",
    headers: {
      Origin: "https://example.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(wrongOrigin.status, 403);
  report("anonymous owner access and cross-origin writes denied");

  step = "owner sign-in";
  await json(
    "/api/auth/login",
    { email, password: "invalid-test-password" },
    401,
  );
  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, "owner login");
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  assert.equal((await request("/api/admin/session", {}, true)).status, 200);
  await json(
    "/api/admin/settings",
    { submissions_open: true },
    200,
    true,
    "PATCH",
  );
  report("owner login and verified session");

  step = "guest photo";
  const proof = attempt();
  const photoId = randomUUID();
  const bytes = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#edc5df" },
  })
    .png()
    .toBuffer();
  const manifest = {
    ...proof,
    files: [{ id: photoId, mime: "image/png", size: bytes.length }],
  };
  const prepared = await json("/api/uploads", manifest);
  assert.equal(prepared.files[0].uploaded, false);
  assert.ok(!prepared.files[0].url.includes(proof.attemptToken));
  await json(
    "/api/uploads",
    { ...manifest, attemptToken: "0".repeat(64) },
    403,
  );
  const upload = (data: Uint8Array, token = proof.attemptToken) =>
    request(prepared.files[0].url, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "X-Submission-Token": token },
      body: new Uint8Array(data),
    });
  assert.equal((await upload(bytes, "0".repeat(64))).status, 403);
  assert.equal((await upload(new Uint8Array(bytes.length))).status, 400);
  assert.equal((await upload(bytes)).status, 200);
  assert.equal((await upload(bytes)).status, 200);
  assert.equal((await json("/api/uploads", manifest)).files[0].uploaded, true);
  report("real photo upload, validation, proof checks and upload retry");

  step = "submission retry";
  const name = `Live check ${proof.requestId.slice(0, 8)} 100% _`;
  const entry = {
    ...emptyEntry,
    name,
    answers: {
      ...emptyEntry.answers,
      how_we_met: "Integration test",
      favourite_memory: "A disposable test entry",
    },
  };
  const submission = {
    ...proof,
    entry,
    media: [{ id: photoId, caption: "Temporary test photo" }],
  };
  await json("/api/submissions", { ...submission, media: [] }, 400);
  await Promise.all([
    json("/api/submissions", submission),
    json("/api/submissions", submission),
  ]);
  assert.equal(
    await db.entry.count({ where: { submission_request_id: proof.requestId } }),
    1,
  );
  const saved = await db.entry.findUniqueOrThrow({
    where: { submission_request_id: proof.requestId },
  });
  report("concurrent submission retries create exactly one entry");

  step = "private reads and export";
  const search = await (
    await request(`/api/admin/entries?q=${encodeURIComponent(name)}`, {}, true)
  ).json();
  assert.equal(search.total, 1);
  const photo = await request(`/api/admin/media/${photoId}`, {}, true);
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), bytes);
  assert.match(photo.headers.get("cache-control") || "", /no-store/);
  assert.equal((await request(`/api/admin/media/${photoId}`)).status, 401);
  const anonHeaders = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  };
  const direct = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/entries?select=id&id=eq.${saved.id}`,
    { headers: anonHeaders },
  );
  assert.equal(direct.status, 200);
  assert.deepEqual(await direct.json(), []);
  const blobRead = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/upload_blobs?select=id`,
    { headers: anonHeaders },
  );
  assert.ok([401, 403].includes(blobRead.status));
  const archive = await request(`/api/admin/export?id=${saved.id}`, {}, true);
  assert.equal(archive.status, 200);
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.ok(strFromU8(files["entries.json"]).includes(name));
  const photoPath = Object.keys(files).find((path) =>
    path.startsWith("photos/"),
  );
  assert.ok(photoPath);
  assert.deepEqual(Buffer.from(files[photoPath]), bytes);
  report("literal search, private photos, direct-API denial and ZIP contents");

  step = "closed submissions";
  const inFlight = attempt();
  await json("/api/uploads", { ...inFlight, files: [] });
  await json(
    "/api/admin/settings",
    { submissions_open: false },
    200,
    true,
    "PATCH",
  );
  await json("/api/submissions", { ...inFlight, entry, media: [] }, 409);
  await json("/api/uploads", { ...attempt(), files: [] }, 409);
  await json("/api/submissions", submission); // A previous success remains acknowledged.
  await json(
    "/api/admin/settings",
    { submissions_open: true },
    200,
    true,
    "PATCH",
  );
  report("closed-book handling preserves completed receipts");

  step = "cleanup";
  const abandoned = attempt();
  const abandonedId = randomUUID();
  await json("/api/uploads", {
    ...abandoned,
    files: [{ id: abandonedId, mime: "image/png", size: bytes.length }],
  });
  await db.submissionAttempt.update({
    where: { id: abandoned.requestId },
    data: {
      created_at: new Date(Date.now() - 28 * 3600_000),
      expires_at: new Date(Date.now() - 4 * 3600_000),
    },
  });
  const cleanup = await request("/api/cron/cleanup", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(cleanup.status, 200);
  assert.equal(await db.uploadFile.count({ where: { id: abandonedId } }), 0);
  assert.equal(await db.uploadBlob.count({ where: { id: photoId } }), 1);
  report(
    "authenticated cleanup removes abandoned slots and retains saved photos",
  );

  step = "deletion";
  await json(`/api/admin/entries/${saved.id}`, undefined, 200, true, "DELETE");
  assert.equal(
    (await request(`/api/admin/entries/${saved.id}`, {}, true)).status,
    404,
  );
  assert.equal(
    (await request(`/api/admin/media/${photoId}`, {}, true)).status,
    404,
  );
  assert.equal(await db.uploadBlob.count({ where: { id: photoId } }), 0);
  await json("/api/submissions", submission);
  assert.equal(
    await db.entry.count({ where: { submission_request_id: proof.requestId } }),
    0,
  );
  report("atomic deletion and late retry cannot resurrect an entry");
} catch (error) {
  console.error(
    `FAIL at ${step}:`,
    error instanceof assert.AssertionError
      ? error.message
      : "request/database failure",
  );
  process.exitCode = 1;
} finally {
  const ids = attempts.map((value) => value.requestId);
  try {
    await db.$transaction(async (tx) => {
      await tx.settings.update({
        where: { id: 1 },
        data: { submissions_open: before.submissions_open },
      });
      await tx.entry.deleteMany({
        where: { submission_request_id: { in: ids } },
      });
      await tx.uploadFile.deleteMany({ where: { attempt_id: { in: ids } } });
      await tx.submissionAttempt.deleteMany({ where: { id: { in: ids } } });
      await tx.rateLimit.deleteMany({
        where: {
          key: {
            in: counters.filter(
              (key) => !previousCounters.some((row) => row.key === key),
            ),
          },
        },
      });
    });
    assert.equal(
      await db.entry.count({ where: { submission_request_id: { in: ids } } }),
      0,
    );
    assert.equal(
      await db.submissionAttempt.count({ where: { id: { in: ids } } }),
      0,
    );
    report(
      "test entries, photos, attempts and newly created local counters removed; settings restored",
    );
  } catch {
    console.error(
      "Test cleanup failed; inspect only these test attempt UUIDs:",
      ids.join(", "),
    );
    process.exitCode = 1;
  }
  if (cookie) {
    try {
      await json("/api/auth/logout", {}, 200, true);
    } catch {
      console.error("Test session sign-out failed.");
      process.exitCode = 1;
    }
  }
  await db.$disconnect();
}
