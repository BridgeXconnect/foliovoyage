/**
 * Plain string checks for the SEO slice (spec 0006): the leak list (AC-T6),
 * the first person and team check (AC-H3, Notes file schema) and whole phrase
 * matching (forbidden names). All case insensitive. `seo:index` runs them on
 * notes and source facts; the page leak scan applies the same matchers to
 * rendered text.
 */

import { SEO_SLICE_LEAK_TERMS, SEO_SLICE_TEAM_TERMS } from "@folio/shared";

/** Not a letter or digit on that side, so "rated" does not match inside "berated". */
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase as a pattern: escaped, any run of spaces matching any whitespace. */
function phrasePattern(phrase: string): string {
  return phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
}

function currencyPattern(code: string): string {
  // Letter codes need a boundary ("USD", not inside a word); symbols do not.
  return /\p{L}/u.test(code) ? `${START}${escapeRegExp(code)}${END}` : escapeRegExp(code);
}

const CURRENCY = `(?:${SEO_SLICE_LEAK_TERMS.currencies.map(currencyPattern).join("|")})`;

const LEAK_MATCHERS: { term: string; re: RegExp }[] = [
  ...SEO_SLICE_LEAK_TERMS.wordPrefixes.map((t) => ({
    term: t,
    re: new RegExp(`${START}${escapeRegExp(t)}`, "iu"),
  })),
  ...SEO_SLICE_LEAK_TERMS.wholeWords.map((t) => ({
    term: t,
    re: new RegExp(`${START}${phrasePattern(t)}${END}`, "iu"),
  })),
  ...SEO_SLICE_LEAK_TERMS.symbols.map((t) => ({ term: t, re: new RegExp(escapeRegExp(t), "u") })),
  { term: "currency next to a digit", re: new RegExp(`${CURRENCY}\\s?\\d|\\d\\s?${CURRENCY}`, "iu") },
  { term: "from followed by a currency", re: new RegExp(`${START}from\\s+${CURRENCY}`, "iu") },
];

/** Every leak list rule the text breaks, by term; empty when it is clean. */
export function findLeakTerms(text: string): string[] {
  return LEAK_MATCHERS.filter(({ re }) => re.test(text)).map(({ term }) => term);
}

const FIRST_PERSON_WORDS = ["i", "i'm", "i've", "me", "my", "we", "we're", "we've", "us", "our", "ours"];

/** True when `phrase` appears in `text` as a whole word or phrase. */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase.trim()) return false;
  return new RegExp(`${START}${phrasePattern(phrase)}${END}`, "iu").test(text);
}

/**
 * First person words and team phrases the text holds (AC-H3 `firstPerson`).
 * Curly apostrophes count as straight ones, so "we’re" is caught too.
 */
export function findFirstPerson(text: string): string[] {
  const normalized = text.replace(/[‘’]/g, "'");
  const words = FIRST_PERSON_WORDS.filter((w) =>
    new RegExp(`${START}${escapeRegExp(w)}(?![\\p{L}\\p{N}'])`, "iu").test(normalized),
  );
  const team = SEO_SLICE_TEAM_TERMS.filter((t) => containsPhrase(normalized, t));
  return [...words, ...team];
}
