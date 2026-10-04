"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseFromForTour } from "@/lib/tour-from";

const linkClass = "inline-block text-sm text-ink-soft underline-offset-2 hover:underline";

/**
 * The server rendered back link, and the `Suspense` fallback for the client
 * one: it always goes to the tour's city page, so the static HTML is the same
 * for every `?from=` value (spec 0005, AC-13, AC-15).
 */
export function CityBackLink({ citySlug, cityName }: { citySlug: string; cityName: string }) {
  return (
    <Link href={`/destinations/${encodeURIComponent(citySlug)}`} className={linkClass}>
      ← Back to {cityName}
    </Link>
  );
}

/**
 * Reads `from` in the browser (`useSearchParams` under `Suspense`, so the page
 * stays ISR). A valid `from` for this tour's own city links back to the canvas
 * bucket; anything else keeps the city link. `?at=` is ignored by `/discover`
 * until the canvas position URL ships, so it opens at the canvas's default spot.
 */
export function TourBackLink({ citySlug, cityName }: { citySlug: string; cityName: string }) {
  const from = parseFromForTour(useSearchParams().get("from"), citySlug);
  if (!from) return <CityBackLink citySlug={citySlug} cityName={cityName} />;
  return (
    <Link href={`/discover?at=${from.key}`} className={linkClass}>
      ← Back to {cityName} · {from.categoryLabel}
    </Link>
  );
}
