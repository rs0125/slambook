import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { literalSearchValue } from "../src/lib/search";

test("Prisma LIKE searches treat punctuation, wildcards and backslashes literally", async (t) => {
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
    "राज",
    "'),name%_;",
  ]) {
    const pattern = `%${literalSearchValue(input)}%`;
    const { rows } = await db.query<{ matched: boolean; unrelated: boolean }>(
      "select $1 ilike $2 as matched, 'unrelated friend' ilike $2 as unrelated",
      [`Before ${input} after`, pattern],
    );
    assert.equal(rows[0].matched, true, input);
    assert.equal(rows[0].unrelated, false, input);
  }
  assert.equal(literalSearchValue(" "), "");
  assert.equal(literalSearchValue("a".repeat(200)).length, 100);
});
