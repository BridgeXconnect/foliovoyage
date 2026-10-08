import Link from "next/link";

/**
 * The tour page's back link. It always goes to the tour's city page, so the
 * static HTML is the same for every `?from=` value (spec 0005, AC-13, AC-15).
 */
export function CityBackLink({ citySlug, cityName }: { citySlug: string; cityName: string }) {
  return (
    <Link
      href={`/destinations/${encodeURIComponent(citySlug)}`}
      className="inline-block text-sm text-ink-soft underline-offset-2 hover:underline"
    >
      ← Back to {cityName}
    </Link>
  );
}
