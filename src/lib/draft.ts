import type { EntryInput } from "./questions";

export const DRAFT_KEY = "raghav-slambook:draft:v1";

// A late response from an old tab must not erase a newer, unrelated draft.
export function clearSubmittedDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  attempt: { requestId: string; attemptToken: string },
  entry: EntryInput,
) {
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return;
  const saved = JSON.parse(raw);
  if (
    saved?.attempt?.requestId === attempt.requestId &&
    saved?.attempt?.attemptToken === attempt.attemptToken &&
    JSON.stringify(saved.entry) === JSON.stringify(entry)
  )
    storage.removeItem(DRAFT_KEY);
}
