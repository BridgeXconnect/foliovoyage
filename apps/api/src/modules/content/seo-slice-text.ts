/**
 * Plain string checks for the SEO slice in apps/api (spec 0006): the leak list
 * (AC-T6), first person words (AC-H3, for AC-S5 inclusions) and whole phrase
 * matching (keyword groups, AC-S8). Case insensitive,
 * with the same word edges as apps/web's `src/lib/seo-slice/text-checks.ts`, so
 * a title that passes here also passes the page leak scan.
 */

import { SEO_SLICE_FIRST_PERSON_WORDS, SEO_SLICE_LEAK_TERMS } from "./seo-slice.constants";

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

const FIRST_PERSON_MATCHERS = SEO_SLICE_FIRST_PERSON_WORDS.map((w) => ({
  word: w,
  // An apostrophe after the word is part of a longer one, so "we" skips "we're".
  re: new RegExp(`${START}${escapeRegExp(w)}(?![\\p{L}\\p{N}'])`, "iu"),
}));

/**
 * First person words the text holds (AC-H3 `firstPerson`, the word list only).
 * Curly apostrophes count as straight ones, so "we’re" is caught too.
 */
export function findFirstPerson(text: string): string[] {
  const normalized = text.replace(/[‘’]/g, "'");
  return FIRST_PERSON_MATCHERS.filter(({ re }) => re.test(normalized)).map(({ word }) => word);
}

/** A matcher for a list of phrases, each as a whole word or phrase. */
export function phrasesMatcher(phrases: readonly string[]): (text: string) => boolean {
  const usable = phrases.filter((p) => p.trim());
  if (usable.length === 0) return () => false;
  const re = new RegExp(`${START}(?:${usable.map(phrasePattern).join("|")})${END}`, "iu");
  return (text) => re.test(text);
}
