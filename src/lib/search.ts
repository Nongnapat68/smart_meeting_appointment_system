// Turning what a user typed into a search box into a PostgREST filter that
// matches it literally ("contains", case-insensitive).
//
// Without this, % and _ typed by the user act as SQL LIKE wildcards — a
// search for "%" or "_" alone matched every row. Postgres LIKE's default
// escape character is backslash, so \ itself is escaped too.
//
// * needs different handling: PostgREST treats * in a like/ilike value as an
// alias for % and swaps it in before Postgres sees the pattern, so no LIKE
// escape can protect it ("\*" arrives as "\%", a literal percent). A search
// containing * is therefore sent as imatch (Postgres ~*, case-insensitive
// regex) with every regex metacharacter escaped instead — PostgREST leaves *
// alone there.

export type ContainsFilter = { operator: "ilike" | "imatch"; value: string };

/** Escapes \, % and _ so a LIKE/ILIKE pattern matches them literally. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/** Escapes every Postgres regex metacharacter so ~* matches `text` literally. */
export function escapeRegexPattern(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/** Filter matching rows that contain `text` literally. For `.filter(column, f.operator, f.value)`. */
export function containsFilter(text: string): ContainsFilter {
  if (text.includes("*")) return { operator: "imatch", value: escapeRegexPattern(text) };
  return { operator: "ilike", value: `%${escapeLikePattern(text)}%` };
}

/**
 * A PostgREST `.or()` string matching rows where any of `columns` contains
 * `text` literally, e.g. `.or(orContainsAny(["name", "email"], q))`.
 * Each value is double-quoted so , ( ) typed by the user aren't read as
 * filter syntax; inside the quotes PostgREST's syntax wants \ and "
 * backslash-escaped, so the LIKE escapes above reach Postgres intact.
 */
export function orContainsAny(columns: string[], text: string): string {
  const { operator, value } = containsFilter(text);
  const quoted = `"${value.replace(/[\\"]/g, "\\$&")}"`;
  return columns.map((c) => `${c}.${operator}.${quoted}`).join(",");
}
