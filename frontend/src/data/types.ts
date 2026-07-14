/**
 * Content model for the placeholder editorial layer.
 *
 * This is the seam that makes the eventual Viator / GetYourGuide swap trivial:
 * an `Experience` is our curated concept; when real product data lands, each
 * card gains an `affiliateUrl` (and `provider`) and the CTA becomes live — a
 * one-line data change, not a component rebuild. Until then the CTA renders as
 * a non-functional "Coming soon" state (see ExperienceCard).
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
   * optionally `provider`. Presence flips the card CTA from "Coming soon" to a
   * live, disclosed booking link. This is the intended one-line swap.
   */
  affiliateUrl?: string;
  provider?: "Viator" | "GetYourGuide";
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
