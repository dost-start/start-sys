// ─────────────────────────────────────────────────────────────────────────────
// Who the appoint dialog's search finds (Officer feedback 2026-09-11: appoint by name).
//
// THE RULE: a candidate matches when EVERY typed word is a case-insensitive PREFIX of at
// least one token — a whitespace-separated word of the given name, a word of the family
// name, or the whole member ID. Prefix, not substring: "an" does not find "Juan", so each
// keystroke narrows the list instead of widening it with mid-word hits.
//
// It runs in two halves that must agree on what a token is. `candidateNameFilter` is the
// database half, for the FIRST word only, as a PostgREST `or` filter
// (lib/officers/actions.ts); `matchesCandidateQuery` then applies every word to the rows
// that came back. Both split on whitespace — tokenising on hyphens here but not there
// would make the database drop rows this function would have kept.
// ─────────────────────────────────────────────────────────────────────────────

/** Words past this are ignored. */
export const MAX_QUERY_WORDS = 4;

export type CandidateNameFields = {
  given_name: string;
  family_name: string;
  member_id: string | null;
};

/** Case-fold for comparison. NFC so a decomposed "ñ" from one keyboard equals a composed one. */
function fold(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function words(value: string): string[] {
  return fold(value)
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** The query as folded words, at most `MAX_QUERY_WORDS`. A blank query is `[]`. */
export function queryWords(q: string): string[] {
  return words(q).slice(0, MAX_QUERY_WORDS);
}

/** Does `candidate` match `q` under the rule in the header? A blank query matches everyone. */
export function matchesCandidateQuery(candidate: CandidateNameFields, q: string): boolean {
  const wanted = queryWords(q);
  if (wanted.length === 0) return true;

  const tokens = [...words(candidate.given_name), ...words(candidate.family_name)];
  if (candidate.member_id !== null && candidate.member_id !== "") {
    tokens.push(fold(candidate.member_id));
  }

  return wanted.every((word) => tokens.some((token) => token.startsWith(word)));
}

/**
 * One word that may enter a filter string: `officerCandidateSearchSchema`'s whitelist
 * (lib/officers/schema.ts) minus the space that separates words.
 */
const FILTER_WORD_RE = /^[\p{L}\p{M}\d.'-]+$/u;

/**
 * The database half of the rule for ONE word: a PostgREST `or` filter on `people`. `*` is
 * PostgREST's LIKE wildcard, and `"* w*"` reads "w starts a later word". Values are
 * double-quoted because `.` and `-` are legal in a word and would otherwise be read as
 * filter syntax.
 *
 * ⚠ THE WORD IS INTERPOLATED. The schema already refuses `, ( ) " * % _ \ :`; this checks
 * again where it matters and THROWS rather than build a filter from anything else.
 * Reaching the throw is a programmer error (a caller that skipped the schema), never a
 * user one. The message carries no part of the word.
 */
export function candidateNameFilter(word: string): string {
  if (!FILTER_WORD_RE.test(word)) {
    throw new Error("candidateNameFilter: word is outside the search whitelist");
  }
  return [
    `given_name.ilike."${word}*"`,
    `given_name.ilike."* ${word}*"`,
    `family_name.ilike."${word}*"`,
    `family_name.ilike."* ${word}*"`,
    `member_id.ilike."${word}*"`,
  ].join(",");
}
