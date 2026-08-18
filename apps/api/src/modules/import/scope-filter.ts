import type { ViatorProduct } from "./clients/viator.types";
import { curatedCityForRefs } from "./curated-cities";
import { extractDestinationRefs } from "./normalizer";

/**
 * Ingest-scope filter (BRI-170 / BRI-171).
 *
 * Runs on a **raw** Viator product, immediately after a page is fetched and
 * before normalization, location-resolution, or price-resolution ever touch
 * it. Three independent reasons a product is out of scope, checked cheapest /
 * most-exclusionary first:
 *
 * 1. **Not a curated destination** (BRI-170). Atlas ingests 6 curated cities
 *    out of Viator's entire global catalog; `/products/modified-since` has no
 *    server-side destination filter (confirmed live — docs/13), so filtering
 *    is entirely the partner's responsibility. This is BRI-170's actual fix:
 *    applying the filter here, before normalize/geo-resolve/price-resolve,
 *    means those stages — in particular the live per-product
 *    `/availability/schedules` call in `price-resolver.ts` — only ever run
 *    against the curated set (~90 products), never the full global catalog.
 *    Previously this filter ran last, inside `ExperienceLinker`, after every
 *    other stage had already processed the entire catalog — the mechanism
 *    behind BRI-170's OOM.
 * 2. **Inactive** (BRI-171). Per Viator's docs, an `INACTIVE` product's
 *    payload is empty apart from `status`/`productCode` — "all other requests
 *    for this product should be avoided". Previously this was skipped only by
 *    accident (the normalizer's required-`title` check happened to throw for
 *    it, since `INACTIVE` payloads carry no title); this makes the skip
 *    deliberate and explicit instead of relying on that side effect.
 * 3. **Manual confirmation** (BRI-171). Per Viator's docs, a partner that
 *    hasn't built support for the async pending-confirmation flow should
 *    exclude `MANUAL`/`INSTANT_THEN_MANUAL` products. Atlas is a Full-Access
 *    Affiliate — it has no access to any `/bookings/*` endpoint and never
 *    processes a booking itself, so this is plausibly a no-op in practice, but
 *    is implemented for correctness per the docs regardless of how many
 *    products it actually excludes (docs/13).
 *
 * All three are **scope** exclusions, not data-quality problems — unlike
 * `validator.ts`'s `validateTour`, a scoped-out product is not "bad data"
 * worth quarantining for review; it's Viator inventory Atlas never intended to
 * carry. So these are silently discarded (counted for observability, never
 * persisted anywhere) rather than quarantined.
 */

export type ScopeSkipReason =
  | "NOT_CURATED_DESTINATION"
  | "INACTIVE"
  | "MANUAL_CONFIRMATION";

/** Outcome of scoping one raw product: proceed to normalization, or skip why. */
export type ScopeDecision =
  | { readonly ingest: true }
  | { readonly ingest: false; readonly reason: ScopeSkipReason };

/** Confirmation types Viator's docs say to exclude absent a booking flow. */
const EXCLUDED_CONFIRMATION_TYPES = new Set(["MANUAL", "INSTANT_THEN_MANUAL"]);

/**
 * Decide whether a raw Viator product should proceed to normalization.
 * **Pure** — no DB, no network, no clock — so it is cheap to run on every
 * product in every page and unit-testable in isolation.
 */
export function decideIngestScope(raw: ViatorProduct): ScopeDecision {
  // Cheapest, most-exclusionary check first: this rejects 99%+ of the crawl
  // before anything else is even inspected.
  const refs = extractDestinationRefs(raw);
  if (!curatedCityForRefs(refs)) {
    return { ingest: false, reason: "NOT_CURATED_DESTINATION" };
  }

  // INACTIVE products carry almost no fields (docs/13) — check status before
  // reaching for anything that would be absent on one.
  if (raw["status"] !== "ACTIVE") {
    return { ingest: false, reason: "INACTIVE" };
  }

  const confirmationType = readConfirmationType(raw);
  if (confirmationType && EXCLUDED_CONFIRMATION_TYPES.has(confirmationType)) {
    return { ingest: false, reason: "MANUAL_CONFIRMATION" };
  }

  return { ingest: true };
}

/** `bookingConfirmationSettings.confirmationType`, or `undefined` if absent/malformed. */
function readConfirmationType(raw: ViatorProduct): string | undefined {
  const settings = raw["bookingConfirmationSettings"];
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return undefined;
  }
  const value = (settings as Record<string, unknown>)["confirmationType"];
  return typeof value === "string" ? value : undefined;
}
