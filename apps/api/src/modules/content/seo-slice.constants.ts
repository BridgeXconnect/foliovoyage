/**
 * apps/api's copies of the SEO slice word lists: the leak list (spec 0006 page
 * template, AC-T6) and the first person words (AC-H3, used by AC-S5).
 *
 * The sources are `SEO_SLICE_LEAK_TERMS` and `SEO_SLICE_FIRST_PERSON_WORDS` in
 * `packages/shared/src/seo-slice.ts`. AC-T6 keeps a copy here, and
 * `seo-slice.constants.spec.ts` fails when a copy and its source differ, so
 * edit the shared list and then this one.
 */

export const SEO_SLICE_LEAK_TERMS = {
  wordPrefixes: ["rating", "rated", "review", "price", "availab", "cancel", "refund"],
  wholeWords: ["stars", "sold out", "book now", "spots left"],
  symbols: ["★"],
  currencies: ["$", "€", "£", "฿", "USD", "THB", "EUR", "GBP"],
} as const;

export const SEO_SLICE_FIRST_PERSON_WORDS = ["i", "i'm", "i've", "me", "my", "we", "we're", "we've", "us", "our", "ours"] as const;
