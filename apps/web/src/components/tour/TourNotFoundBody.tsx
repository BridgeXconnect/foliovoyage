"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CANVAS_CITIES } from "@folio/shared";
import { useSearchParams } from "next/navigation";
import { trackTourPageNotFound } from "@/lib/analytics";
import { parseFrom } from "@/lib/tour-from";

/**
 * The body of the "no longer available" page (spec 0005, AC-8, AC-14). `from`
 * is read in the browser and validated against the shared lists, so the page
 * needs no request data on the server. A valid `from` adds a link to that
 * city's page; the fixed link goes to `/destinations`. The not found event carries only the validated parts; the reason
 * is logged on the server (see the tour page).
 */
export function TourNotFoundBody() {
  const raw = useSearchParams().get("from");
  const from = parseFrom(raw);
  const city = from && CANVAS_CITIES.find((c) => c.slug === from.citySlug);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackTourPageNotFound({
      city: from?.citySlug ?? null,
      category: from?.categorySlug ?? null,
      from: from?.key ?? null,
    });
  }, [from]);

  return (
    <>
      <p className="mt-4 text-[15px] text-ink-soft">
        <Link href="/destinations" className="underline">
          Browse all destinations
        </Link>
        {city && (
          <>
            {" · "}
            <Link href={`/destinations/${city.slug}`} className="underline">
              Explore {city.name}
            </Link>
          </>
        )}
      </p>
    </>
  );
}
