/** Helpers shared by the server detail page and browser experience cards. */
import type { Destination, Experience } from "@folio/shared";
import type { AffiliateClickInput } from "@/lib/analytics";

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
    return `${amount}`;
  }
}

/** Every experience, matched or not, clicks through the first-party /go route. */
export function experienceGoHref(destinationSlug: string, experience: Experience): string {
  return `/go/${destinationSlug}/${experience.id}`;
}

/** Affiliate-click context for the detail page and comparison dialog. */
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
    freeCancel: Boolean(experience.freeCancel),
    city: destination.city,
    country: destination.country,
    destinationSlug: destination.slug,
  };
}
