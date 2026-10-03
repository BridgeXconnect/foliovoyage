/**
 * @folio/shared — cross-cutting domain types shared by the web app and API.
 *
 * These types began life in `apps/web/src/data/types.ts` (the placeholder
 * editorial layer) and were lifted here so both `apps/web` and `apps/api`
 * depend on a single source of truth. `apps/web/src/data/types.ts` now
 * re-exports from this package, so existing `@/data/types` imports keep working.
 *
 * This is also the seam that makes the eventual Viator / GetYourGuide swap
 * trivial: an `Experience` is our curated concept; when real product data
 * lands, each card gains an `affiliateUrl` (and `provider`) and the CTA becomes
 * live — a one-line data change, not a component rebuild.
 */

/** Rough price signal, shown as a band rather than a fake exact price. */
export type PriceBand = "$" | "$$" | "$$$" | "$$$$";

/** Intent / category tag used for the coloured chip on each card. */
export type ExperienceCategory =
  | "Culture & History"
  | "Food & Drink"
  | "Nature & Outdoors"
  | "Landmarks"
  | "Neighbourhoods"
  | "Nightlife"
  | "Day Trips"
  | "Wellness"
  | "Water & Coast";

export interface Experience {
  /** Stable slug-like id, unique within a destination. */
  id: string;
  title: string;
  /** Original, specific one–two sentence description. */
  description: string;
  /** Absolute image URL (Wikimedia Commons placeholder for now). */
  image: string;
  /** Descriptive alt text for accessibility + SEO. */
  imageAlt: string;
  category: ExperienceCategory;
  priceBand: PriceBand;
  /** Rough typical duration, e.g. "Half day". */
  duration?: string;
  /**
   * When an affiliate program is approved, set this to the deep link and
   * optionally `provider`. Presence determines the CTA's outbound target and
   * label: set → a live "Book on {provider}" link to the matched product;
   * unset → a "Search on {provider}" link to a constructed provider-search
   * fallback (BRI-138 / ST-26). Both routes exist for every experience — see
   * `apps/web/src/app/go/[slug]/[id]/route.ts`.
   */
  affiliateUrl?: string;
  provider?: "Viator" | "GetYourGuide";
  /**
   * Provider-sourced commerce signals, merged in from the matched OTA product
   * summary (BRI-168, "match don't overwrite" — docs/07). All optional: absent
   * until a card is matched, and never a substitute for the editorial
   * `title`/`description`/`priceBand`, which the enrichment layer never touches.
   */
  /** Real "from" price in major currency units (e.g. 28 = $28), when matched. */
  fromPrice?: number;
  /** ISO-4217 currency for {@link fromPrice} (e.g. "USD"). */
  currency?: string;
  /** Aggregate rating (Viator + TripAdvisor), 0–5, one decimal. */
  rating?: number;
  /** Aggregate review count backing {@link rating}. */
  ratingCount?: number;
  /** True when the matched product carries Viator's FREE_CANCELLATION flag. */
  freeCancel?: boolean;
}

export interface Destination {
  /** URL slug: /destinations/<slug>. Stable once published. */
  slug: string;
  city: string;
  country: string;
  /** Short evocative line under the H1. */
  tagline: string;
  /** Hero background image (absolute URL). */
  heroImage: string;
  heroImageAlt: string;
  /** 1–3 paragraphs of original editorial intro. */
  intro: string[];
  /** Quick-fact chips shown near the top. */
  knownFor: string[];
  bestTime: string;
  /**
   * Representative "from" price (USD) shown on the hero's popular-location card.
   * Placeholder only — replaced by real Viator/GetYourGuide pricing later.
   */
  fromPrice: number;
  /** Optional neighbourhood notes — used for Bangkok's local detail. */
  neighbourhoods?: { name: string; note: string }[];
  experiences: Experience[];
  /** Approximate coordinates for JSON-LD / future map. */
  lat: number;
  lng: number;
}
export * from "./api";
export * from "./canvas/geometry";
