import { z } from "zod";

import type { PriceBand } from "./index";

/**
 * Wire contract for the Atlas API (`apps/api`), shared with `apps/web`.
 *
 * These describe JSON over HTTP, not the static-editorial content model in
 * `index.ts`. `apps/api` builds its responses to these types (type-only
 * import, erased at compile time, so the CommonJS API never loads this file at
 * runtime); `apps/web` parses what it fetches against the schemas, so a field
 * that drifts between the two fails loudly instead of being silently cast.
 *
 * Schemas tolerate unknown extra fields (Zod strips them) so an API that ships
 * a new field ahead of the web does not break the site; a missing or
 * wrong-typed field does.
 *
 * Covers `GET /v1/destinations/:country/:city` today. Add further endpoints
 * here as `apps/web` starts consuming them.
 */

/** Rough price signal derived from a Tour's price, never an exact price. */
export const priceBandSchema: z.ZodType<PriceBand> = z.enum([
  "$",
  "$$",
  "$$$",
  "$$$$",
]);

/**
 * One published Experience card. Fields Atlas hasn't curated yet are honestly
 * nullable/empty rather than faked: `editorRating` is null until an editor sets
 * it, `tags` is empty until curation, `affiliateUrl` is omitted so the card
 * renders a "coming soon" placeholder instead of a live booking link.
 */
export const experienceResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Provider cover image (from the linked Tour), or null when none. */
  imageUrl: z.string().nullable(),
  /** Alt text for `imageUrl`, or null. */
  imageAlt: z.string().nullable(),
  /** Atlas editorial rating (0-5), or null until an editor sets it. */
  editorRating: z.number().nullable(),
  /** Rough price band from the linked Tour's price, or null when unpriced. */
  priceBand: priceBandSchema.nullable(),
  /** Curated tags. Empty until editorial curation (M7). */
  tags: z.array(z.string()),
  /**
   * AI-generated summary of the linked Tour (BRI-154), or null. Null covers
   * every case but one: no `TourCopy` row yet, the row is `failed`, its
   * `groundingHash` no longer matches the tour's current fields, or the tour
   * is no longer eligible (AC-12). Untrusted third-party-grounded text:
   * whoever renders it must escape it.
   */
  aiSummary: z.string().nullable(),
  /**
   * Live affiliate deep link, when present. Omitted for auto-created imports;
   * its absence is what makes the card render a "coming soon" placeholder.
   */
  affiliateUrl: z.string().optional(),
  /** Affiliate provider label, paired with `affiliateUrl`. */
  provider: z.string().optional(),
});
export type ExperienceResponse = z.infer<typeof experienceResponseSchema>;

/** Page metadata for the experiences list. */
export const paginationMetaSchema = z.object({
  /** 1-based current page. */
  page: z.number(),
  /** Items per page. */
  pageSize: z.number(),
  /** Total published experiences for the city. */
  total: z.number(),
  /** Total pages (at least 1). */
  totalPages: z.number(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const destinationResponseSchema = z.object({
  city: z.string(),
  citySlug: z.string(),
  country: z.string(),
  countrySlug: z.string(),
  heroImageUrl: z.string(),
  heroImageAlt: z.string(),
  experiences: z.array(experienceResponseSchema),
  pagination: paginationMetaSchema,
});
export type DestinationResponse = z.infer<typeof destinationResponseSchema>;
