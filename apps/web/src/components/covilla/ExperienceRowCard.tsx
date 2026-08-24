"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Star, ShieldCheck, CheckSquare, Square } from "lucide-react";
import { trackAffiliateClick } from "@/lib/analytics";
import { experienceDetailPath, formatFromPrice } from "@/lib/experience-detail";
import type { Experience } from "@/data/types";

/**
 * Horizontal experience card in the Covilla "vacation" style (image left,
 * details right) for the destination page's right column. The booking CTA
 * always routes through the first-party `/go/:slug/:id` redirect (BRI-136):
 * a matched experience gets an accent "Book on {provider}" link to the real
 * product; an unmatched one gets a secondary "Search on {provider}" link to
 * a provider-search fallback (BRI-138 / ST-26) — never a dead end.
 *
 * When a card is matched to a real Viator product (BRI-168) it surfaces the
 * provider's commerce signals — "from" price, aggregate rating, free-cancellation
 * — as additive badges. These never replace the editorial `title`/`description`
 * ("match, don't overwrite", docs/07); an unmatched card renders exactly as before
 * apart from the CTA.
 */
export function ExperienceRowCard({
  experience: e,
  destination,
  compare,
}: {
  experience: Experience;
  /**
   * Destination page this card sits on — for affiliate-click attribution and as
   * the first path segment of the `/go` link key.
   */
  destination: { slug: string; city: string; country: string };
  /**
   * When present (ST-18), renders a "compare" checkbox. `disabled` is true when
   * the selection is at the cap and this card isn't already selected. Absent on
   * every other use of the card, which then renders exactly as before.
   */
  compare?: { selected: boolean; disabled: boolean; onToggle: () => void };
}) {
  const live = Boolean(e.affiliateUrl);
  const hasPrice = typeof e.fromPrice === "number" && e.fromPrice > 0;
  const hasRating = typeof e.rating === "number" && e.rating > 0;
  // Route the click through /go (log-before-redirect); the raw deep link (or
  // the BRI-138 fallback search page, for an unmatched experience) is the
  // 302 target resolved server-side, never the clicked href.
  const goHref = `/go/${destination.slug}/${e.id}`;

  return (
    <article className="flex flex-col overflow-hidden rounded-[3px] border border-line bg-white transition-shadow duration-300 hover:shadow-[0_18px_40px_-28px_rgba(15,19,38,0.45)] sm:flex-row">
      <div className="relative aspect-[16/10] sm:aspect-auto sm:w-[42%] sm:min-h-[230px]">
        <Image
          src={e.image}
          alt={e.imageAlt}
          fill
          sizes="(max-width: 640px) 100vw, 260px"
          className="object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        {compare && (
          <button
            type="button"
            role="checkbox"
            aria-checked={compare.selected}
            aria-label={
              compare.selected ? `Remove ${e.title} from comparison` : `Add ${e.title} to comparison`
            }
            disabled={compare.disabled && !compare.selected}
            onClick={compare.onToggle}
            title={
              compare.disabled && !compare.selected ? "You can compare up to 4 tours" : undefined
            }
            className="mb-3 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compare.selected ? (
              <CheckSquare size={16} className="text-accent" aria-hidden />
            ) : (
              <Square size={16} aria-hidden />
            )}
            Compare
          </button>
        )}
        <p className="eyebrow">{e.category}</p>
        <h3 className="mt-2 font-display text-[22px] font-medium leading-snug">
          <Link
            href={experienceDetailPath(destination.slug, e.id)}
            className="transition-colors hover:text-accent"
          >
            {e.title}
          </Link>
        </h3>
        <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
          {e.description}
        </p>

        {/* Provider signals (BRI-168) — only when matched to a real product. */}
        {(hasRating || e.freeCancel) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            {hasRating && (
              <span className="inline-flex items-center gap-1 text-ink">
                <Star size={14} className="fill-current text-amber-500" aria-hidden />
                <span className="font-medium">{e.rating!.toFixed(1)}</span>
                {typeof e.ratingCount === "number" && (
                  <span className="text-muted">
                    ({e.ratingCount.toLocaleString("en-US")})
                  </span>
                )}
                <span className="sr-only">average rating</span>
              </span>
            )}
            {e.freeCancel && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <ShieldCheck size={14} aria-hidden />
                Free cancellation
              </span>
            )}
          </div>
        )}

        <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
              {hasPrice ? "From" : "Price"}
            </p>
            <p className="text-[15px] font-medium text-ink">
              {hasPrice ? formatFromPrice(e.fromPrice!, e.currency) : e.priceBand}
              {e.duration && (
                <span className="ml-2 text-[13px] font-normal text-muted">
                  · {e.duration}
                </span>
              )}
            </p>
          </div>

          <a
            href={goHref}
            target="_blank"
            rel="sponsored nofollow noopener"
            onClick={() =>
              trackAffiliateClick({
                experienceId: e.id,
                title: e.title,
                provider: e.provider,
                category: e.category,
                priceBand: e.priceBand,
                hasRating: typeof e.rating === "number",
                freeCancel: Boolean(e.freeCancel),
                city: destination.city,
                country: destination.country,
                destinationSlug: destination.slug,
              })
            }
            className={
              live
                ? "inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
                : "inline-flex items-center gap-1.5 rounded-[2px] border border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-ink hover:text-ink"
            }
          >
            {live ? `Book on ${e.provider}` : `Search on ${e.provider ?? "Viator"}`}{" "}
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </article>
  );
}
