// Prisma's contains filter uses LIKE. Escape its three special characters so
// names such as “100%”, “A_B” and backslashes remain literal substring searches.
export function literalSearchValue(value: string) {
  return value
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&");
}
