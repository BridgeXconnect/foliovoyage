/**
 * Pure lookup + routing helpers for experience detail pages (ST-17).
 *
 * Built on the static content system (the live, indexed surface) via
 * `destinations-helpers` — see the ST-17 plan's Findings §2/§5 for why the
 * static system, not the DB one, is the source here. No `next`/client imports,
 * so this runs under ts-jest in a node env.
 */
import type { Destination, Experience } from "@folio/shared";
import type { AffiliateClickInput } from "@/lib/analytics";
import { getAllDestinations, getDestination } from "@/data/destinations-helpers";

export interface ExperienceDetail {
  destination: Destination;
  experience: Experience;
}

/** Resolve a (destinationSlug, experienceId) pair to its destination + experience. */
export function findExperienceDetail(
  slug: string,
  experienceId: string,
): ExperienceDetail | undefined {
  const destination = getDestination(slug);
  if (!destination) return undefined;
  const experience = destination.experiences.find((e) => e.id === experienceId);
  if (!experience) return undefined;
  return { destination, experience };
}

/** Every (slug, experienceId) pair, for `generateStaticParams`. */
export function listExperienceDetailParams(): { slug: string; experienceId: string }[] {
  return getAllDestinations().flatMap((d) =>
    d.experiences.map((e) => ({ slug: d.slug, experienceId: e.id })),
  );
}

/** Canonical in-app path for a detail page. */
export function experienceDetailPath(slug: string, experienceId: string): string {
  return `/destinations/${slug}/experiences/${experienceId}`;
}

/** Format a provider "from" price as e.g. "$28" (no fake precision). */
export function formatFromPrice(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain amount.
    return `${amount}`;
  }
}

/**
 * CTA href for the detail page. Always routes through the first-party
 * `/go/:slug/:id` redirect (BRI-136) — never the raw `affiliateUrl` — for
 * every real experience, whether or not it has a matched Viator product.
 * `/go` itself decides the 302 target: the verbatim deep link when matched,
 * or a constructed provider-search fallback when not (BRI-138 / ST-26,
 * FR-AFF-3) — see `apps/web/src/app/go/[slug]/[id]/route.ts`. This is
 * deliberately the same seam `ExperienceRowCard` and `ExperienceCompareModal`
 * use.
 */
export function experienceGoHref(destinationSlug: string, experience: Experience): string {
  return `/go/${destinationSlug}/${experience.id}`;
}

/** The affiliate-click payload for the detail-page CTA — identical shape to the card's. */
export function experienceDetailAffiliateInput(
  destination: Destination,
  experience: Experience,
): AffiliateClickInput {
  return {
    experienceId: experience.id,
    title: experience.title,
    provider: experience.provider,
    category: experience.category,
    priceBand: experience.priceBand,
    hasRating: typeof experience.rating === "number",
    freeCancel: Boolean(experience.freeCancel),
    city: destination.city,
    country: destination.country,
    destinationSlug: destination.slug,
  };
}
