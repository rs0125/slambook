import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyEntry,
  entrySchema,
  submissionSchema,
  uploadSchema,
  isOwnerIdentity,
  MAX_IMAGE_BYTES,
  entryResponseSchema,
  entryListResponseSchema,
  sessionResponseSchema,
} from "../src/lib/questions";

const valid = {
  ...emptyEntry,
  name: "A friend",
  answers: {
    ...emptyEntry.answers,
    how_we_met: "At school",
    favourite_memory: "Our rainy road trip",
  },
};
test("required fields reject empty and whitespace-only submissions", () => {
  for (const key of ["name", "how_we_met", "favourite_memory"]) {
    const input = structuredClone(valid);
    if (key === "name") input.name = "   ";
    else input.answers[key as "how_we_met" | "favourite_memory"] = "   ";
    assert.equal(entrySchema.safeParse(input).success, false);
  }
});
test("answers have stable keys, trim whitespace, and enforce limits", () => {
  assert.equal(entrySchema.parse({ ...valid, name: "  Riya  " }).name, "Riya");
  assert.equal(
    entrySchema.safeParse({ ...valid, name: "a".repeat(101) }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...valid, nickname: "a".repeat(101) }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...valid, contact_handle: "a".repeat(251) })
      .success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({
      ...valid,
      answers: { ...valid.answers, future_message: "x".repeat(2001) },
    }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({
      ...valid,
      answers: { ...valid.answers, public: true },
    }).success,
    false,
  );
});
test("upload requests reject injected paths, duplicate slots, type spoof declarations, and limits", () => {
  const base = { requestId: randomUUID(), attemptToken: "a".repeat(64) };
  const file = { id: randomUUID(), size: 512_000, mime: "image/jpeg" };
  assert.equal(
    uploadSchema.safeParse({ ...base, files: [file] }).success,
    true,
  );
  for (const files of [
    [{ ...file, path: "someone-elses/photo.jpg" }],
    [{ ...file, size: MAX_IMAGE_BYTES + 1 }],
    [{ ...file, size: 0 }],
    [{ ...file, mime: "image/svg+xml" }],
    [file, file],
    Array.from({ length: 4 }, () => ({ ...file, id: randomUUID() })),
  ])
    assert.equal(uploadSchema.safeParse({ ...base, files }).success, false);
});

test("the optional unsaid note accepts old entries, trims text and rejects invalid values", () => {
  const { unsaid_note: _unused, ...legacyAnswers } = valid.answers;
  assert.equal(
    entrySchema.parse({ ...valid, answers: legacyAnswers }).answers.unsaid_note,
    "",
  );
  assert.equal(
    entrySchema.parse({
      ...valid,
      answers: {
        ...valid.answers,
        unsaid_note: "  Thanks for always showing up.  ",
      },
    }).answers.unsaid_note,
    "Thanks for always showing up.",
  );
  for (const unsaid_note of [null, 1, {}, "x".repeat(2001)])
    assert.equal(
      entrySchema.safeParse({
        ...valid,
        answers: { ...valid.answers, unsaid_note },
      }).success,
      false,
    );
});
test("submission shape cannot nominate paths or duplicate media", () => {
  const input = {
    requestId: randomUUID(),
    attemptToken: "a".repeat(64),
    entry: valid,
    media: [{ id: randomUUID(), caption: "A memory" }],
  };
  assert.equal(submissionSchema.safeParse(input).success, true);
  assert.equal(
    submissionSchema.safeParse({
      ...input,
      media: [...input.media, ...input.media],
    }).success,
    false,
  );
  assert.equal(
    submissionSchema.safeParse({
      ...input,
      media: [{ ...input.media[0], caption: "a".repeat(251) }],
    }).success,
    false,
  );
  assert.equal(
    submissionSchema.safeParse({
      ...input,
      media: [{ ...input.media[0], storage_path: "secret" }],
    }).success,
    false,
  );
  assert.equal(
    submissionSchema.safeParse({ ...input, attemptToken: "guessable" }).success,
    false,
  );
});
test("authentication alone never grants owner access", () => {
  const owner = randomUUID();
  assert.equal(isOwnerIdentity(owner, owner), true);
  assert.equal(isOwnerIdentity(randomUUID(), owner), false);
  assert.equal(isOwnerIdentity(undefined, owner), false);
  assert.equal(isOwnerIdentity(owner, undefined), false);
  assert.equal(isOwnerIdentity(undefined, undefined), false);
});

test("owner responses validate nested data and dates while allowing database-only columns", () => {
  const entry = {
    ...valid,
    id: randomUUID(),
    created_at: "2026-11-24T10:20:30.123456+00:00",
    questionnaire_version: 1,
    entry_media: [],
    deleted_at: null,
    submission_request_id: randomUUID(),
  };
  const parsed = entryResponseSchema.parse({ entry });
  assert.equal(parsed.entry.name, valid.name);
  assert.equal("submission_request_id" in parsed.entry, false);
  assert.equal(
    entryResponseSchema.safeParse({
      entry: { ...entry, created_at: "invalid date" },
    }).success,
    false,
  );
  assert.equal(
    entryListResponseSchema.safeParse({ entries: [entry], total: 1, page: 1 })
      .success,
    true,
  );
  assert.equal(
    entryListResponseSchema.safeParse({ entries: null, total: 1, page: 1 })
      .success,
    false,
  );
  assert.equal(
    sessionResponseSchema.safeParse({ settings: null }).success,
    false,
  );
});
