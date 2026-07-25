import type { Destination, Experience } from "./types";
import { destinations as rawDestinations } from "./destinations";
import viatorLinks from "./viator-links.json";

/**
 * Viator affiliate enrichment, produced by `scripts/fetch-viator-links.mjs`
 * (see docs/07). Keyed by `"<destinationSlug>/<experienceId>"`.
 *
 * This is the "cache, don't ingest" layer for Basic Access: rather than a
 * database pipeline (which needs `/products/modified-since`, gated to Full
 * Access), the script matches each hand-written Experience to a real Viator
 * product once and writes the deep link here. Merging is a pure enrichment —
 * the original `title`/`description` are never touched (match, don't overwrite).
 *
 * Until the script runs with a real VIATOR_API_KEY the file is `{}`, so this
 * merge is a no-op and every card renders its "Booking coming soon" state.
 */
type ViatorEnrichment = {
  /** Verbatim Viator `productUrl` (pid/mcid/medium intact) + our `&campaign=`. */
  affiliateUrl: string;
  provider: "Viator" | "GetYourGuide";
  /** Optional overrides when the real product data differs meaningfully. */
  priceBand?: Experience["priceBand"];
  duration?: string;
  /** Provider commerce signals from the matched product summary (BRI-168). */
  fromPrice?: number;
  currency?: string;
  rating?: number;
  ratingCount?: number;
  freeCancel?: boolean;
};

const links = viatorLinks as Record<string, ViatorEnrichment>;

function enrichExperience(slug: string, e: Experience): Experience {
  const hit = links[`${slug}/${e.id}`];
  if (!hit?.affiliateUrl) return e;
  return {
    ...e,
    affiliateUrl: hit.affiliateUrl,
    provider: hit.provider ?? "Viator",
    ...(hit.priceBand ? { priceBand: hit.priceBand } : {}),
    ...(hit.duration ? { duration: hit.duration } : {}),
    // Provider commerce signals (BRI-168) — additive; editorial fields untouched.
    ...(typeof hit.fromPrice === "number" ? { fromPrice: hit.fromPrice } : {}),
    ...(hit.currency ? { currency: hit.currency } : {}),
    ...(typeof hit.rating === "number" ? { rating: hit.rating } : {}),
    ...(typeof hit.ratingCount === "number"
      ? { ratingCount: hit.ratingCount }
      : {}),
    ...(hit.freeCancel ? { freeCancel: true } : {}),
  };
}

function enrichDestination(d: Destination): Destination {
  return {
    ...d,
    experiences: d.experiences.map((e) => enrichExperience(d.slug, e)),
  };
}

/**
 * Destinations with Viator affiliate links merged in. Computed once at module
 * load; when the enrichment file is empty this is referentially the same shape
 * as the raw data.
 */
const destinations: Destination[] =
  Object.keys(links).length === 0
    ? rawDestinations
    : rawDestinations.map(enrichDestination);

export function getAllDestinations(): Destination[] {
  return destinations;
}

export function getDestination(slug: string): Destination | undefined {
  return destinations.find((d) => d.slug === slug);
}

export function getDestinationSlugs(): string[] {
  return destinations.map((d) => d.slug);
}

/** Lightweight destination list for nav/header/sliders (no heavy fields dropped). */
export function getNavDestinations() {
  return destinations.map((d) => ({
    slug: d.slug,
    city: d.city,
    country: d.country,
    count: d.experiences.length,
    heroImage: d.heroImage,
    heroImageAlt: d.heroImageAlt,
    fromPrice: d.fromPrice,
  }));
}
