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
 * fields (title, description, duration, aggregate rating, booking URL) plus
 * provenance. It deliberately does **not** set Atlas-owned fields — editor
 * rating, curated categories/tags, slug, curation status, `experience_id` — which
 * belong to editorial/enrichment and the dedup service, not to ingest. Two
 * provider-sourced fields it also leaves `null`, because the product payload does
 * not contain them, are resolved by dedicated post-normalization steps:
 * coordinates (ST-7b, from `/locations/bulk`) and price/currency (ST-7c, from
 * `/availability/schedules/{code}` — the payload's `pricingInfo` holds no amount).
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
  /**
   * "From" price in minor units (e.g. cents), or `null` when unpriced. **Not**
   * set by {@link normalizeViatorProduct}: the Viator product payload carries no
   * price at all (its `pricingInfo` is booking constraints only — verified live,
   * BRI-165), so like {@link latitude}/{@link longitude} this is left `null` by
   * the pure normalizer and filled in by the ST-7c price resolver from
   * `/availability/schedules/{code}`. Deliberately excluded from
   * {@link source_hash}: a "from" price is volatile and would churn the content
   * hash of an otherwise-unchanged tour on every price move.
   */
  price_minor: number | null;
  /**
   * ISO-4217 currency code, or `null` when unpriced. Set alongside
   * {@link price_minor} by the price resolver, not the normalizer; excluded from
   * {@link source_hash} for the same reason.
   */
  currency: string | null;
  /**
   * "From" price converted to the reference currency (USD) in minor units, or
   * null when unpriced or no FX rate was available. NOT set by the pure
   * normalizer — attached after price resolution by the reference-price step,
   * exactly like {@link price_minor}/{@link currency}. Excluded from
   * {@link source_hash}: it is a resolved, volatile projection, not independent
   * content.
   */
  price_reference_minor: number | null;
  /**
   * Reference currency for {@link price_reference_minor} ("USD" today), or
   * null. Set alongside it by the reference-price step; excluded from
   * {@link source_hash} for the same reason.
   */
  price_reference_currency: string | null;
  /** Provider deep link (Viator `productUrl`, affiliate params intact). */
  affiliate_url: string | null;
  /**
   * Provider's location-reference id for the tour's **start** point
   * (`logistics.start[0].location.ref`, e.g. `"LOC-abc123"`), or `null` when the
   * payload carries no structured start location. Viator's product payload does
   * **not** embed coordinates — only this opaque reference — so the reference is
   * what {@link latitude}/{@link longitude} are resolved from downstream
   * (ST-7b / `/locations/bulk`). Part of {@link source_hash}: if the start
   * reference changes, the tour's location content has changed.
   */
  location_ref: string | null;
  /**
   * Provider cover-image URL — the `isCover` image's mid-size variant (prefers
   * ~540×360) — or `null` when the payload carries no imagery. Provider-owned
   * content, surfaced on the linked Experience's card (ST-11). Part of
   * {@link source_hash}.
   */
  image_url: string | null;
  /** Alt text for {@link image_url} (the image caption), or `null`. */
  image_alt: string | null;
  /**
   * Provider destination refs this product is filed under, e.g. `["343"]`
   * (Bangkok), taken verbatim from `destinations[].ref`. The import linker
   * (BRI-164) matches these against the curated-city registry to decide which
   * City an imported Experience belongs to. Empty array when absent. Part of
   * {@link source_hash}: a change in which destinations a tour belongs to is a
   * content change.
   */
  destination_refs: string[];
  /**
   * Provider category tag IDs, verbatim from the payload's top-level `tags`
   * array, e.g. `[12075, 11929, 367654]`. Opaque numeric IDs — resolving them
   * to names/categories via `/products/tags` is a deferred follow-up (Stage B).
   * Captured here (Stage A) so future data isn't silently discarded. Empty when
   * absent. Part of {@link source_hash}: a change in a product's tags is a
   * content change.
   */
  tags: number[];
  /**
   * The product's full image gallery — every entry in the payload's `images`
   * array, captions and all resolution variants included (not just the
   * single cover projection {@link image_url}/{@link image_alt} pick out).
   * Empty array when the payload carries no imagery. Part of
   * {@link source_hash}: a change to the gallery is a content change.
   */
  images: TourImageDTO[];
  /**
   * The product's inclusions checklist, verbatim from the payload's
   * `inclusions` array — every entry, collapsed to Atlas's own shape (see
   * {@link TourIncludedItemDTO}). Empty array when the payload carries none.
   * Part of {@link source_hash}: a change to what's included is a content change.
   */
  inclusions: TourIncludedItemDTO[];
  /**
   * The product's exclusions checklist, from the payload's `exclusions`
   * array. Same shape and hashing treatment as {@link inclusions}.
   */
  exclusions: TourIncludedItemDTO[];
  /**
   * The product's cancellation policy, verbatim from the payload's
   * `cancellationPolicy` object (raw `refundEligibility` renamed to
   * {@link TourCancellationPolicyDTO.refundTiers} — cosmetic only, no data
   * loss). `null` when the payload carries no usable policy — genuinely
   * distinct from a policy that exists and happens to be maximally strict, so
   * this is a nullable scalar, not an array defaulting to `[]` like
   * {@link inclusions}/{@link exclusions}. Part of {@link source_hash}: a
   * changed policy is a content change.
   */
  cancellation_policy: TourCancellationPolicyDTO | null;
  /**
   * Resolved latitude of the start location (WGS-84 decimal degrees), or `null`
   * when unresolved. **Not** set by {@link normalizeViatorProduct} — normalization
   * is pure and never touches the network, so it leaves this `null` and the
   * ST-7b location resolver fills it in from {@link location_ref}. Deliberately
   * excluded from {@link source_hash}: it is a resolved projection of
   * `location_ref` (already hashed), not independent content, and it is populated
   * asynchronously after the hash is computed.
   */
  latitude: number | null;
  /** Resolved longitude of the start location; see {@link latitude}. */
  longitude: number | null;
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

/**
 * One image in a tour's full gallery — every provider-supplied resolution
 * variant, not just the single cover projection {@link TourDTO.image_url}
 * picks out. Provider-owned content; part of {@link TourDTO.source_hash}.
 */
export interface TourImageDTO {
  /** The image's caption, or `null` when the payload omits it. */
  caption: string | null;
  /** Whether Viator marks this as the product's cover image. */
  isCover: boolean;
  /** Every resolution variant the payload lists for this image. */
  variants: { width: number; height: number; url: string }[];
}

/**
 * One entry in a tour's inclusions or exclusions checklist. The raw payload
 * puts the human-readable text under `description` or `otherDescription`
 * depending on `type` (never, in the fixtures seen, both at once) — Atlas
 * collapses that into a single {@link description} field rather than
 * carrying two near-duplicate optional keys.
 */
export interface TourIncludedItemDTO {
  category: string;
  categoryDescription: string;
  type: string;
  typeDescription: string;
  /** Unified from `description`/`otherDescription`; `null` when neither is set. */
  description: string | null;
}

/**
 * A tour's cancellation policy — type, refund-by-cutoff tiers, and
 * weather/traveler-count flags. See {@link TourDTO.cancellation_policy}.
 */
export interface TourCancellationPolicyDTO {
  type: string;
  /** `null` when the payload omits it. */
  description: string | null;
  cancelIfBadWeather: boolean;
  cancelIfInsufficientTravelers: boolean;
  /** Renamed from the payload's `refundEligibility` (cosmetic only). */
  refundTiers: {
    dayRangeMin: number;
    dayRangeMax: number | null;
    percentageRefundable: number;
  }[];
}

/** Context the caller must supply — provenance that isn't in the payload. */
export interface NormalizeContext {
  /** ISO-8601 timestamp of when this raw page was fetched (ST-6). */
  fetchedAt: string;
}

/**
 * The content fields hashed into {@link TourDTO.source_hash}, in stable order.
 * Excluded alongside the provenance fields:
 * - `latitude`/`longitude` — resolved from `location_ref` (which *is* hashed)
 *   after normalization, so hashing them would make an otherwise-unchanged tour's
 *   hash depend on resolution timing.
 * - `price_minor`/`currency` — resolved from `/availability/schedules` after
 *   normalization *and* volatile, so hashing them would churn the content hash of
 *   an unchanged tour every time its "from" price moved.
 * - `price_reference_minor`/`price_reference_currency` — resolved from
 *   `price_minor` by the reference-price step, for the same reason.
 */
type TourContent = Omit<
  TourDTO,
  | "fetched_at"
  | "source_hash"
  | "latitude"
  | "longitude"
  | "price_minor"
  | "currency"
  | "price_reference_minor"
  | "price_reference_currency"
>;

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
    affiliate_url: optionalString(raw["productUrl"]),
    location_ref: extractLocationRef(raw),
    image_url: extractCoverImageUrl(raw),
    image_alt: extractCoverImageAlt(raw),
    destination_refs: extractDestinationRefs(raw),
    tags: extractTags(raw),
    images: extractImages(raw),
    inclusions: extractIncludedItems(raw["inclusions"]),
    exclusions: extractIncludedItems(raw["exclusions"]),
    cancellation_policy: extractCancellationPolicy(raw),
  };

  return {
    ...content,
    // Price/currency and coordinates are resolved from separate endpoints after
    // normalization, not here — a pure function can't call the network. They
    // start null and are filled in downstream: coordinates by the ST-7b location
    // resolver (`/locations/bulk`), price/currency by the ST-7c price resolver
    // (`/availability/schedules/{code}`; the product payload has no price).
    price_minor: null,
    currency: null,
    price_reference_minor: null,
    price_reference_currency: null,
    latitude: null,
    longitude: null,
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
    content.affiliate_url,
    content.location_ref,
    content.image_url,
    content.image_alt,
    content.destination_refs,
    content.tags,
    content.images,
    content.inclusions,
    content.exclusions,
    content.cancellation_policy,
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
 * The start-location reference from `logistics.start`. Viator's product detail
 * models a tour's start point(s) as `logistics.start: [{ location: { ref } }]`
 * (confirmed against docs.viator.com/partner-api/technical) — an opaque
 * `"LOC-…"` reference, not coordinates. We take the **first** start entry (a
 * tour has one start point for map purposes) and read `location.ref`. Products
 * with legacy `UNSTRUCTURED` itineraries carry no such reference and normalize
 * to `null`. The reference is resolved to real lat/lng by the ST-7b resolver.
 */
function extractLocationRef(raw: ViatorProduct): string | null {
  const logistics = asRecord(raw["logistics"]);
  const start = logistics?.["start"];
  if (!Array.isArray(start) || start.length === 0) return null;
  const location = asRecord(asRecord(start[0])?.["location"]);
  return optionalString(location?.["ref"]);
}

/**
 * The cover image's URL. Viator models images as
 * `images: [{ isCover, caption, variants: [{ width, height, url }] }]`
 * (verified against the live modified-since payload, 2026-07-25). We take the
 * `isCover` image (falling back to the first image) and pick a mid-size variant
 * — preferring ~540×360, then 480×320, else the largest available — a good size
 * for a card without shipping a thumbnail or a full-resolution asset. `null`
 * when the product carries no imagery.
 */
function extractCoverImageUrl(raw: ViatorProduct): string | null {
  const image = pickCoverImage(raw);
  if (!image) return null;
  const variants = Array.isArray(image["variants"]) ? image["variants"] : [];
  const records = variants
    .map(asRecord)
    .filter((v): v is Record<string, unknown> => v !== undefined);
  const preferred = [
    [540, 360],
    [480, 320],
  ] as const;
  for (const [w, h] of preferred) {
    const match = records.find(
      (v) => v["width"] === w && v["height"] === h,
    );
    const url = optionalString(match?.["url"]);
    if (url) return url;
  }
  // Otherwise the largest variant by pixel area.
  let best: { url: string; area: number } | null = null;
  for (const v of records) {
    const url = optionalString(v["url"]);
    const width = optionalInteger(v["width"]) ?? 0;
    const height = optionalInteger(v["height"]) ?? 0;
    const area = width * height;
    if (url && (!best || area > best.area)) best = { url, area };
  }
  return best?.url ?? null;
}

/** The cover image's caption, used as alt text. `null` when absent. */
function extractCoverImageAlt(raw: ViatorProduct): string | null {
  const image = pickCoverImage(raw);
  return image ? optionalString(image["caption"]) : null;
}

/** The `isCover` image, or the first image, or `undefined`. */
function pickCoverImage(
  raw: ViatorProduct,
): Record<string, unknown> | undefined {
  const images = raw["images"];
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const records = images
    .map(asRecord)
    .filter((v): v is Record<string, unknown> => v !== undefined);
  return records.find((im) => im["isCover"] === true) ?? records[0];
}

/**
 * The product's full image gallery, from `images: [{ isCover, caption,
 * variants }]` — every entry, not just the cover. `[]` when `images` is
 * absent or not an array. Per entry: `caption` (nullable string), `isCover`
 * (strictly `=== true`, so a malformed non-boolean value normalizes to
 * `false`), and `variants` — missing numeric width/height coerce to `0`, and
 * a variant with no usable `url` is dropped entirely.
 */
function extractImages(raw: ViatorProduct): TourImageDTO[] {
  const images = raw["images"];
  if (!Array.isArray(images)) return [];

  const out: TourImageDTO[] = [];
  for (const entry of images) {
    const record = asRecord(entry);
    if (!record) continue;

    const rawVariants = Array.isArray(record["variants"])
      ? record["variants"]
      : [];
    const variants: TourImageDTO["variants"] = [];
    for (const v of rawVariants) {
      const variant = asRecord(v);
      const url = optionalString(variant?.["url"]);
      if (!url) continue;
      variants.push({
        width: optionalInteger(variant?.["width"]) ?? 0,
        height: optionalInteger(variant?.["height"]) ?? 0,
        url,
      });
    }

    out.push({
      caption: optionalString(record["caption"]),
      isCover: record["isCover"] === true,
      variants,
    });
  }
  return out;
}

/**
 * Unifies the payload's two mutually-exclusive text keys (`description` /
 * `otherDescription`, chosen per `type`) into one field. Both present is not
 * observed in the fixtures but is handled defensively: concatenated rather
 * than one silently dropped.
 */
function joinDescriptions(a: string | null, b: string | null): string | null {
  if (a && b) return `${a}; ${b}`;
  return a ?? b;
}

/**
 * One inclusions/exclusions checklist, from either `raw["inclusions"]` or
 * `raw["exclusions"]` — an array of `{ category, categoryDescription, type,
 * typeDescription, description? | otherDescription? }`. `[]` when `raw` is
 * absent or not an array.
 */
function extractIncludedItems(raw: unknown): TourIncludedItemDTO[] {
  if (!Array.isArray(raw)) return [];
  const out: TourIncludedItemDTO[] = [];
  for (const entry of raw) {
    const item = asRecord(entry);
    if (!item) continue;
    out.push({
      category: optionalString(item["category"]) ?? "",
      categoryDescription: optionalString(item["categoryDescription"]) ?? "",
      type: optionalString(item["type"]) ?? "",
      typeDescription: optionalString(item["typeDescription"]) ?? "",
      description: joinDescriptions(
        optionalString(item["description"]),
        optionalString(item["otherDescription"]),
      ),
    });
  }
  return out;
}

/**
 * The product's cancellation policy, from `cancellationPolicy: { type,
 * description, cancelIfBadWeather, cancelIfInsufficientTravelers,
 * refundEligibility }`. `null` when `raw["cancellationPolicy"]` is absent or
 * malformed — not an object, or missing/non-string `type` — since a policy
 * with no `type` is unusable rather than worth emitting half-populated.
 */
function extractCancellationPolicy(
  raw: ViatorProduct,
): TourCancellationPolicyDTO | null {
  const policy = asRecord(raw["cancellationPolicy"]);
  if (!policy) return null;
  const type = optionalString(policy["type"]);
  if (!type) return null;
  const tiers = Array.isArray(policy["refundEligibility"])
    ? policy["refundEligibility"]
    : [];
  return {
    type,
    description: optionalString(policy["description"]),
    cancelIfBadWeather: policy["cancelIfBadWeather"] === true,
    cancelIfInsufficientTravelers:
      policy["cancelIfInsufficientTravelers"] === true,
    refundTiers: tiers
      .map(asRecord)
      .filter((t): t is Record<string, unknown> => t !== undefined)
      .map((t) => ({
        dayRangeMin: optionalInteger(t["dayRangeMin"]) ?? 0,
        dayRangeMax: optionalInteger(t["dayRangeMax"]),
        percentageRefundable: optionalInteger(t["percentageRefundable"]) ?? 0,
      })),
  };
}

/**
 * The product's Viator destination refs, from `destinations: [{ ref }]`. The
 * import linker matches these against the curated-city registry. Order and
 * duplicates are preserved as the provider sends them (deduped downstream if
 * needed); non-string refs are dropped. Empty array when the payload has none.
 *
 * Exported (not just used internally) so `scope-filter.ts` can classify a
 * **raw** product's destination before normalization ever runs (BRI-170) —
 * without duplicating this extraction logic.
 */
export function extractDestinationRefs(raw: ViatorProduct): string[] {
  const destinations = raw["destinations"];
  if (!Array.isArray(destinations)) return [];
  const refs: string[] = [];
  for (const entry of destinations) {
    const ref = asRecord(entry)?.["ref"];
    // Refs arrive as strings ("343"), but coerce a numeric ref defensively.
    if (typeof ref === "string" && ref.length > 0) refs.push(ref);
    else if (typeof ref === "number" && Number.isFinite(ref)) {
      refs.push(String(ref));
    }
  }
  return refs;
}

/** The product's top-level `tags` array (opaque numeric IDs). Non-integers are
 * dropped and floats truncated; empty array when absent. */
function extractTags(raw: ViatorProduct): number[] {
  const tags = raw["tags"];
  if (!Array.isArray(tags)) return [];
  const out: number[] = [];
  for (const t of tags) {
    if (typeof t === "number" && Number.isFinite(t)) out.push(Math.trunc(t));
  }
  return out;
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
