import { createHash } from "node:crypto";

import type { ViatorProduct } from "./clients/viator.types";

/**
 * Normalizer (ST-7 / BRI-104).
 *
 * Pure translation of a raw Viator product (as archived by the ST-6 client)
 * into Atlas's own {@link TourDTO}. It is a plain function with **no DB access
 * and no side effects** — it never reads the clock, the network, or the
 * filesystem — so the same input always yields the same output and it can be
 * unit-tested against a recorded payload in isolation.
 *
 * Ownership boundary (docs/02 §1.3): this function only sets **provider-sourced**
 * fields (title, description, price, duration, aggregate rating, booking URL)
 * plus provenance. It deliberately does **not** set Atlas-owned fields — editor
 * rating, curated categories/tags, slug, curation status, `experience_id` — which
 * belong to editorial/enrichment and the dedup service, not to ingest.
 */

/**
 * The provider-owned + provenance slice of an Atlas `Tour` (docs/02 `tours`).
 *
 * Snake_case mirrors the `tours` columns so the DTO is directly upsertable
 * downstream (ST-8). Atlas-owned columns (`id`, `experience_id`, `slug`, `geom`,
 * `created_at`/`updated_at`/`deleted_at`) are intentionally absent — they are not
 * this function's to populate.
 */
export interface TourDTO {
  /** Provenance: source OTA. Always `"viator"` here. */
  provider: "viator";
  /** Provenance: the provider's immutable product id (Viator `productCode`). */
  provider_tour_id: string;
  /** Provider-sourced supplier title. */
  title: string;
  /** Provider-sourced description; `null` when the payload omits it. */
  description: string | null;
  /** Duration in minutes, or `null` when not a fixed-duration product. */
  duration_min: number | null;
  /**
   * Imported aggregate rating (Viator + TripAdvisor combined), quantized to the
   * `tours.rating_avg numeric(2,1)` column precision. `null` when unrated. This
   * is the *provider* aggregate — distinct from Atlas's own `editor_rating`,
   * which lives on `Experience` and is never set here.
   */
  rating_avg: number | null;
  /** Imported aggregate review count, or `null` when unrated. */
  rating_count: number | null;
  /** "From" price in minor units (e.g. cents), or `null` when unpriced. */
  price_minor: number | null;
  /** ISO-4217 currency code, or `null` when unpriced. */
  currency: string | null;
  /** Provider deep link (Viator `productUrl`, affiliate params intact). */
  affiliate_url: string | null;
  /**
   * Provenance: when the raw page was fetched. **Injected** by the caller (the
   * ST-6 crawl timestamp) rather than read from the clock, so normalization stays
   * pure and deterministic. Excluded from {@link source_hash}.
   */
  fetched_at: string;
  /**
   * Provenance: stable SHA-256 (hex) of the normalized *content* — every DTO
   * field except `fetched_at` and `source_hash` itself. Lets ST-8 skip
   * reprocessing rows whose normalized content is unchanged, even when the fetch
   * time differs.
   */
  source_hash: string;
}

/** Context the caller must supply — provenance that isn't in the payload. */
export interface NormalizeContext {
  /** ISO-8601 timestamp of when this raw page was fetched (ST-6). */
  fetchedAt: string;
}

/** The content fields hashed into {@link TourDTO.source_hash}, in stable order. */
type TourContent = Omit<TourDTO, "fetched_at" | "source_hash">;

/**
 * Normalize one raw Viator product into a {@link TourDTO}.
 *
 * @throws if the payload lacks the fields Atlas treats as required
 *   (`productCode`, `title`) — those back `NOT NULL` columns, so a missing value
 *   is a hard normalization error rather than a silently-null row.
 */
export function normalizeViatorProduct(
  raw: ViatorProduct,
  ctx: NormalizeContext,
): TourDTO {
  const providerTourId = requireString(raw, "productCode");
  const title = requireString(raw, "title");

  const content: TourContent = {
    provider: "viator",
    provider_tour_id: providerTourId,
    title,
    description: optionalString(raw["description"]),
    duration_min: extractDurationMin(raw),
    rating_avg: extractRatingAvg(raw),
    rating_count: extractRatingCount(raw),
    price_minor: extractPriceMinor(raw),
    currency: extractCurrency(raw),
    affiliate_url: optionalString(raw["productUrl"]),
  };

  return {
    ...content,
    fetched_at: ctx.fetchedAt,
    source_hash: hashContent(content),
  };
}

/**
 * SHA-256 of the content fields. We rebuild the object in a fixed key order so
 * the serialization — and therefore the hash — is stable regardless of the raw
 * payload's key order.
 */
function hashContent(content: TourContent): string {
  const canonical = JSON.stringify([
    content.provider,
    content.provider_tour_id,
    content.title,
    content.description,
    content.duration_min,
    content.rating_avg,
    content.rating_count,
    content.price_minor,
    content.currency,
    content.affiliate_url,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Duration in minutes. `/products/modified-since` returns full product detail,
 * so we read `itinerary.duration.fixedDurationInMinutes` first (the shape the
 * one recorded payload uses), falling back to a top-level `duration` object as
 * returned by the search summary. Variable-duration products have no single
 * fixed minute count and normalize to `null`.
 */
function extractDurationMin(raw: ViatorProduct): number | null {
  const itinerary = asRecord(raw["itinerary"]);
  const fromItinerary = asRecord(itinerary?.["duration"])?.[
    "fixedDurationInMinutes"
  ];
  const fromSummary = asRecord(raw["duration"])?.["fixedDurationInMinutes"];
  return optionalInteger(fromItinerary ?? fromSummary);
}

/** Combined aggregate rating, quantized to one decimal (`numeric(2,1)`). */
function extractRatingAvg(raw: ViatorProduct): number | null {
  const value = asRecord(raw["reviews"])?.["combinedAverageRating"];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/** Combined aggregate review count. */
function extractRatingCount(raw: ViatorProduct): number | null {
  return optionalInteger(asRecord(raw["reviews"])?.["totalReviews"]);
}

/**
 * "From" price in minor units. Reads `pricing.summary.fromPrice` (a major-unit
 * amount, per docs/06) and converts to integer minor units. `null` when absent.
 */
function extractPriceMinor(raw: ViatorProduct): number | null {
  const fromPrice = asRecord(asRecord(raw["pricing"])?.["summary"])?.[
    "fromPrice"
  ];
  if (typeof fromPrice !== "number" || !Number.isFinite(fromPrice)) return null;
  return Math.round(fromPrice * 100);
}

/** ISO-4217 currency code from `pricing.currency`. */
function extractCurrency(raw: ViatorProduct): string | null {
  return optionalString(asRecord(raw["pricing"])?.["currency"]);
}

// ---- small, total helpers (no throwing except the two required fields) ----

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function requireString(raw: ViatorProduct, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Cannot normalize Viator product: missing required field "${key}"`,
    );
  }
  return value;
}
