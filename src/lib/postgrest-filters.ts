// Supabase encodes the URL; escape the PostgREST grammar before handing it over.
// https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
export function quoteFilterValue(value: string) {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

// imatch supports a literal, case-insensitive substring without PostgREST's
// special '*' alias for LIKE. Escape all regex operators supplied by the user.
export function literalSearchPattern(value: string) {
  return value
    .trim()
    .slice(0, 100)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
