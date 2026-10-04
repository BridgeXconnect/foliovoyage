import { z } from "zod";

import { MAX_TILES_PER_BUCKET } from "./canvas/geometry";
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
 * Covers `GET /v1/destinations/:country/:city` and the two discovery canvas
 * feed endpoints (`GET /v1/canvas/buckets` and
 * `GET /v1/canvas/buckets/:citySlug/:categorySlug`). Add further endpoints
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

/**
 * A tile's picture, picked from `Tour.images` (or `Tour.imageUrl`). `width` and
 * `height` are null when unknown: a variant reported at width 0, or the plain
 * `imageUrl` fallback.
 */
export const canvasImageSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type CanvasImage = z.infer<typeof canvasImageSchema>;

/**
 * One bucket (a city and a category) as the canvas first paint sees it.
 * `total` is the count of eligible tiles, uncapped, so it can exceed the 50
 * tiles a bucket carries. `image` is the cover image of the rank 1 tile.
 */
export const canvasBucketSummarySchema = z.object({
  citySlug: z.string(),
  countrySlug: z.string(),
  cityName: z.string(),
  categorySlug: z.string(),
  categoryLabel: z.string(),
  total: z.number().int().positive(),
  image: canvasImageSchema,
});
export type CanvasBucketSummary = z.infer<typeof canvasBucketSummarySchema>;

/** `GET /v1/canvas/buckets`: one summary per bucket with at least one eligible tile. */
export const canvasBucketsResponseSchema = z.object({
  buckets: z.array(canvasBucketSummarySchema),
});
export type CanvasBucketsResponse = z.infer<typeof canvasBucketsResponseSchema>;

/**
 * One tile: the best tour of one Experience in a bucket. Carries no aiSummary,
 * no affiliate URL and no tags. `price.amountMinor` is a Postgres BigInt sent as
 * a JSON number, checked as an integer here.
 */
export const canvasTileSchema = z.object({
  /** The Experience id, so a layout seed and a target page share one key. */
  id: z.string(),
  /** The chosen Tour id, so a click is attributed to a tour. */
  tourId: z.string(),
  /** 1-based position in the bucket's ranking. */
  rank: z.number().int().positive(),
  title: z.string(),
  image: canvasImageSchema,
  durationMin: z.number().int().nullable(),
  price: z.object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.string(),
  }),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int().nullable(),
});
export type CanvasTile = z.infer<typeof canvasTileSchema>;

/** `GET /v1/canvas/buckets/:citySlug/:categorySlug`: the summary fields plus up to 50 ranked tiles. */
export const canvasBucketResponseSchema = canvasBucketSummarySchema.extend({
  tiles: z.array(canvasTileSchema).min(1).max(MAX_TILES_PER_BUCKET),
});
export type CanvasBucketResponse = z.infer<typeof canvasBucketResponseSchema>;

/**
 * The page data for one Experience's tour page (`GET /v1/experiences/:id`, spec
 * 0005 AC-1). The Tour shown is the Experience's live Tour with the lowest id.
 *
 * Carries no rating of any kind: the rating is protected content under Viator's
 * rules and travels on its own route ({@link experienceRatingSchema}). A spec
 * pins that no rating key appears here.
 *
 * `price.amountMinor` is a Postgres BigInt sent as a JSON number, checked as an
 * integer. `cancellationDescription` is the provider's text exactly as stored.
 * `affiliateUrl` is read by the web server only and never reaches client props.
 */
export const experiencePageSchema = z.object({
  experienceId: z.string(),
  tourId: z.string(),
  title: z.string(),
  /** The largest available variant. `width` and `height` are null when unknown. */
  image: canvasImageSchema.extend({ alt: z.string() }).nullable(),
  durationMin: z.number().int().nullable(),
  price: z
    .object({
      amountMinor: z.number().int().nonnegative(),
      currency: z.string(),
    })
    .nullable(),
  cancellationDescription: z.string().nullable(),
  /** The AI copy when it is valid, else the provider description as plain text. */
  summary: z
    .object({
      kind: z.enum(["ai", "provider"]),
      text: z.string().min(1),
    })
    .nullable(),
  affiliateUrl: z.string().nullable(),
  city: z.object({
    slug: z.string(),
    countrySlug: z.string(),
    name: z.string(),
  }),
});
export type ExperiencePage = z.infer<typeof experiencePageSchema>;

/**
 * `GET /v1/experiences/:id/rating` (spec 0005 AC-2): the same Tour's imported
 * aggregate rating and nothing else. Both are null for an unrated tour.
 */
export const experienceRatingSchema = z.object({
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int().nullable(),
});
export type ExperienceRating = z.infer<typeof experienceRatingSchema>;
