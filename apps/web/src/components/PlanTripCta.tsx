"use client";

import Link from "next/link";
import posthog from "posthog-js";

export function PlanTripCta({
  city,
  destinationSlug,
}: {
  city: string;
  destinationSlug: string;
}) {
  return (
    <Link
      href="/legal/contact"
      onClick={() =>
        posthog.capture("plan_trip_cta_clicked", {
          city,
          destination_slug: destinationSlug,
        })
      }
      className="mt-8 inline-flex items-center bg-white px-9 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-ink transition-transform hover:-translate-y-0.5"
    >
      Plan your trip
    </Link>
  );
}
