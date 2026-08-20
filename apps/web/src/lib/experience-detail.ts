/**
 * Pure lookup + routing helpers for experience detail pages (ST-17).
 *
 * Built on the static content system (the live, indexed surface) via
 * `destinations-helpers` — see the ST-17 plan's Findings §2/§5 for why the
 * static system, not the DB one, is the source here. No `next`/client imports,
 * so this runs under ts-jest in a node env.
 */
import type { Destination, Experience } from "@folio/shared";
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
