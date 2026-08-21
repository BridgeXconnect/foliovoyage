import posthog from "posthog-js";

/**
 * Analytics helpers for the affiliate money-click — the single most
 * revenue-relevant event on the site (BG-2 "first $1,000 commission";
 * FR-ANALYTICS-1 structured events).
 *
 * Centralised so every affiliate "Book on {provider}" CTA sends one identical,
 * joinable shape. Today only the live {@link ExperienceRowCard} fires it; the
 * DB-backed cards ({@link DbExperienceCard}, {@link ExperienceCard}) are dormant
 * (their route 308-redirects to the canonical page, BRI-166) and should call
 * this same helper when they regain a booking link, rather than re-inlining a
 * `posthog.capture` with a drifting payload.
 *
 * Note: this is behavioural capture only. It is deliberately NOT the durable,
 * blocker-proof server-side click ledger required by FR-AFF-1 / ST-24
 * (`/go/:tourId`), which stays a separate P1 story.
 */

/** The destination page an affiliate CTA sits within, for attribution. */
export type AffiliateClickContext = {
  city?: string;
  country?: string;
  destinationSlug?: string;
};

/**
 * Normalised affiliate-click payload: a stable identifier for *which*
 * experience plus the provider commerce signals, decoupled from any one card's
 * prop shape so `Experience`- and `ApiExperience`-based cards can share it.
 */
export type AffiliateClickInput = AffiliateClickContext & {
  /** Stable experience id — the join key back to a tour / destination. */
  experienceId: string;
  title: string;
  provider?: string;
  category?: string;
  priceBand?: string;
  hasRating?: boolean;
  freeCancel?: boolean;
};

/** Capture a click on a live affiliate booking link. */
export function trackAffiliateClick(input: AffiliateClickInput): void {
  posthog.capture("experience_booking_clicked", {
    experience_id: input.experienceId,
    experience_title: input.title,
    provider: input.provider,
    category: input.category,
    price_band: input.priceBand,
    has_rating: input.hasRating ?? false,
    free_cancel: input.freeCancel ?? false,
    city: input.city,
    country: input.country,
    destination_slug: input.destinationSlug,
  });
}

/** Capture a "compare tours" interaction (FR-ANALYTICS-1 structured events). */
export function trackToursCompared(input: {
  destinationSlug: string;
  city: string;
  country: string;
  experienceIds: string[];
}): void {
  posthog.capture("tours_compared", {
    destination_slug: input.destinationSlug,
    city: input.city,
    country: input.country,
    experience_ids: input.experienceIds,
    tour_count: input.experienceIds.length,
  });
}
