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

/**
 * CTA href for the detail page. A live experience routes through the first-party
 * `/go/:slug/:id` redirect (BRI-136) — which logs the click then 302s to the
 * verbatim provider deep link — never the raw `affiliateUrl`. Undefined when the
 * experience has no live link (→ "booking coming soon"). This is deliberately the
 * same seam `ExperienceRowCard` uses; expected to be revisited under BRI-137/138.
 */
export function experienceGoHref(
  destinationSlug: string,
  experience: Experience,
): string | undefined {
  return experience.affiliateUrl ? `/go/${destinationSlug}/${experience.id}` : undefined;
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
