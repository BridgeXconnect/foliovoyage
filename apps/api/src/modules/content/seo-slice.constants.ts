/**
 * apps/api's copy of the SEO slice leak list (spec 0006 page template, AC-T6).
 *
 * The source is `SEO_SLICE_LEAK_TERMS` in `packages/shared/src/seo-slice.ts`.
 * AC-T6 keeps a copy here, and `seo-slice.constants.spec.ts` fails when the two
 * differ, so edit the shared list and then this one.
 */

export const SEO_SLICE_LEAK_TERMS = {
  wordPrefixes: ["rating", "rated", "review", "price", "availab", "cancel", "refund"],
  wholeWords: ["stars", "sold out", "book now", "spots left"],
  symbols: ["★"],
  currencies: ["$", "€", "£", "฿", "USD", "THB", "EUR", "GBP"],
} as const;
