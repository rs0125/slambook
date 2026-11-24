import { test } from "node:test";
import assert from "node:assert/strict";
import { clearSubmittedDraft, DRAFT_KEY } from "../src/lib/draft";
import { emptyEntry } from "../src/lib/questions";

const attempt = { requestId: "first-attempt", attemptToken: "first-proof" };
const entry = { ...emptyEntry, name: "Friend" };
function storage(raw: string | null) {
  const data = new Map(raw ? [[DRAFT_KEY, raw]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("successful submission clears its own saved draft", () => {
  const store = storage(JSON.stringify({ attempt, entry }));
  clearSubmittedDraft(store, attempt, entry);
  assert.equal(store.getItem(DRAFT_KEY), null);
});
test("a late submission response cannot delete a newer tab's draft", () => {
  for (const newer of [
    { requestId: "new-attempt", attemptToken: "new-proof" },
    { ...attempt, attemptToken: "different-proof" },
  ]) {
    const raw = JSON.stringify({
      attempt: newer,
      entry: { name: "Another friend" },
    });
    const store = storage(raw);
    clearSubmittedDraft(store, attempt, entry);
    assert.equal(store.getItem(DRAFT_KEY), raw);
  }
});
test("missing drafts are harmless and unreadable drafts are not overwritten", () => {
  clearSubmittedDraft(storage(null), attempt, entry);
  const store = storage("not readable JSON");
  assert.throws(() => clearSubmittedDraft(store, attempt, entry));
  assert.equal(store.getItem(DRAFT_KEY), "not readable JSON");
});

test("a response cannot clear newer text saved under the same restored attempt", () => {
  const raw = JSON.stringify({
    attempt,
    entry: { ...entry, name: "Updated name" },
  });
  const store = storage(raw);
  clearSubmittedDraft(store, attempt, entry);
  assert.equal(store.getItem(DRAFT_KEY), raw);
});
