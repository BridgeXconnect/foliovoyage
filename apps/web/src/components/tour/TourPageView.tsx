import { Suspense } from "react";
import Link from "next/link";
import type { ExperiencePage } from "@folio/shared";
import { formatDuration, formatPrice } from "@/canvas/format";
import { BookButton } from "@/components/tour/BookButton";
import { CityBackLink, TourBackLink } from "@/components/tour/TourBackLink";
import { TourPageViewed } from "@/components/tour/TourPageViewed";
import { TourRating } from "@/components/tour/TourRating";

/**
 * The tour page body (spec 0005, AC-4). Placeholder styling only; the designer's
 * work comes later. It receives no `affiliateUrl`: the page decides the button
 * label on the server and passes only that.
 */
export type TourPageViewProps = {
  tour: Omit<ExperiencePage, "affiliateUrl">;
  bookLabel: "Book on Viator" | "Search on Viator";
};

/** `from $35` becomes `From $35`. */
function fromPrice(amountMinor: number, currency: string): string {
  const text = formatPrice(amountMinor, currency);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Paragraphs split on blank lines; the text is rendered as text, never as HTML. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function TourPageView({ tour, bookLabel }: TourPageViewProps) {
  const { image, price, durationMin, cancellationDescription, summary } = tour;
  const duration = formatDuration(durationMin);

  return (
    <article className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:py-14">
      {/* The static HTML always has the city link; the client swaps in the canvas link (spec 0005, AC-13). */}
      <Suspense fallback={<CityBackLink citySlug={tour.city.slug} cityName={tour.city.name} />}>
        <TourBackLink citySlug={tour.city.slug} cityName={tour.city.name} />
      </Suspense>
      <Suspense fallback={null}>
        <TourPageViewed experienceId={tour.experienceId} tourId={tour.tourId} citySlug={tour.city.slug} />
      </Suspense>

      <h1 className="mt-4 text-[28px] font-semibold leading-tight sm:text-[36px]">{tour.title}</h1>

      <TourRating experienceId={tour.experienceId} />

      {image && (
        <div
          className="mt-6 overflow-hidden rounded-lg bg-surface"
          style={image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Viator's own image, used as is (spec 0005: no next/image) */}
          <img
            src={image.url}
            alt={image.alt}
            width={image.width ?? undefined}
            height={image.height ?? undefined}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="mt-6 space-y-1 text-[15px] text-ink-soft">
        {price && (
          <p>
            <span className="text-lg font-semibold text-ink">{fromPrice(price.amountMinor, price.currency)}</span>
            <span className="block text-sm text-muted">Final price shown by Viator at booking.</span>
          </p>
        )}
        {duration && <p>Duration: {duration}</p>}
      </div>

      {summary && (
        <div className="mt-6 space-y-4 text-[15px] leading-7 text-ink-soft">
          {paragraphs(summary.text).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      )}

      {cancellationDescription && (
        <section className="mt-6">
          <h2 className="text-base font-semibold">Cancellation</h2>
          <p className="mt-1 whitespace-pre-line text-[15px] leading-7 text-ink-soft">{cancellationDescription}</p>
        </section>
      )}

      <div className="mt-8">
        <BookButton
          experienceId={tour.experienceId}
          title={tour.title}
          citySlug={tour.city.slug}
          label={bookLabel}
        />
        <p className="mt-3 text-sm text-muted">
          We may earn a commission if you book.{" "}
          <Link href="/legal/disclosure" className="underline">
            Affiliate disclosure
          </Link>
        </p>
      </div>
    </article>
  );
}
