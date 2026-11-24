import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import {
  literalSearchPattern,
  quoteFilterValue,
} from "../src/lib/postgrest-filters";

test("owner search treats punctuation, quotes, wildcard characters and backslashes literally", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const input of [
    "A.J.",
    "Adi_(school)",
    "100%",
    "A*B",
    'A "nickname"',
    "A,B",
    "A\\B",
    "[.*]+?^${}|",
    "राज",
    "),name.imatch.*",
  ]) {
    const pattern = literalSearchPattern(input);
    const { rows } = await db.query<{ matched: boolean; unrelated: boolean }>(
      "select $1 ~* $2 as matched, 'unrelated friend' ~* $2 as unrelated",
      [`Before ${input} after`, pattern],
    );
    assert.equal(rows[0].matched, true, input);
    assert.equal(rows[0].unrelated, false, input);
    assert.equal(JSON.parse(quoteFilterValue(pattern)), pattern);
  }
  const { rows } = await db.query<{ matched: boolean }>(
    "select 'hello ADI' ~* $1 as matched",
    [literalSearchPattern(" adi ")],
  );
  assert.equal(rows[0].matched, true);
  assert.equal(literalSearchPattern(" "), "");
  assert.equal(literalSearchPattern("a".repeat(200)).length, 100);
});

test("Supabase preserves quoted filter values and timestamp cursors without double URL encoding", async () => {
  let received: URL | undefined;
  const db = createClient("https://example.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        received = new URL(String(input));
        return Response.json([]);
      },
    },
  });
  const value = quoteFilterValue(literalSearchPattern('A.J., "friend" \\'));
  const filter = `name.imatch.${value},nickname.imatch.${value}`;
  await db.from("entries").select("id").or(filter);
  assert.equal(received?.searchParams.get("or"), `(${filter})`);
  const timestamp = quoteFilterValue("2026-11-24T10:20:30.123456+00:00");
  await db.from("entries").select("id").or(`created_at.gt.${timestamp}`);
  assert.equal(
    received?.searchParams.get("or"),
    `(created_at.gt.${timestamp})`,
  );
});
