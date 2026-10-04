"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { trackTourPageViewed } from "@/lib/analytics";
import { parseFromForTour } from "@/lib/tour-from";

/**
 * Fires `tour_page_viewed` once per mount (spec 0005, AC-14). The ref guards the
 * strict mode mount, unmount, mount double run, and is keyed on the experience
 * id so a client side navigation to a second tour fires again. `category` and
 * `from` are sent only when `from` validates against this tour's city.
 */
export function TourPageViewed({
  experienceId,
  tourId,
  citySlug,
}: {
  experienceId: string;
  tourId: string;
  citySlug: string;
}) {
  const raw = useSearchParams().get("from");
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (fired.current === experienceId) return;
    fired.current = experienceId;
    const from = parseFromForTour(raw, citySlug);
    trackTourPageViewed({
      experienceId,
      tourId,
      city: citySlug,
      category: from?.categorySlug ?? null,
      from: from?.key ?? null,
    });
  }, [experienceId, tourId, citySlug, raw]);

  return null;
}
