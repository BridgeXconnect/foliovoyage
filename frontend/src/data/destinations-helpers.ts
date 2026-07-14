import type { Destination } from "./types";
import { destinations } from "./destinations";

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
