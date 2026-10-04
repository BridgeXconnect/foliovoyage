"use client";

import { trackAffiliateClick } from "@/lib/analytics";

/**
 * The "Book on Viator" button (spec 0005, AC-4, AC-14). A thin client wrapper so
 * the click can fire `experience_booking_clicked`. It is given no affiliate URL:
 * the `href` is our own `/go/tours/:id` redirect, which logs the click on the
 * server before sending the visitor to Viator.
 */
export function BookButton({
  experienceId,
  title,
  citySlug,
  label,
}: {
  experienceId: string;
  title: string;
  citySlug: string;
  label: "Book on Viator" | "Search on Viator";
}) {
  return (
    <a
      href={`/go/tours/${encodeURIComponent(experienceId)}`}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={() =>
        trackAffiliateClick({ experienceId, title, provider: "viator", city: citySlug, source: "tour_page" })
      }
      className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-ink"
    >
      {label}
    </a>
  );
}
