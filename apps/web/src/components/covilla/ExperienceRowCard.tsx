"use client";

import Image from "next/image";
import { ArrowUpRight, Star, ShieldCheck } from "lucide-react";
import posthog from "posthog-js";
import type { Experience } from "@/data/types";

/** Format a provider "from" price as e.g. "From $28" (no fake precision). */
function formatFromPrice(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain amount.
    return `${amount}`;
  }
}

/**
 * Horizontal experience card in the Covilla "vacation" style (image left,
 * details right) for the destination page's right column. Keeps the affiliate
 * seam: a live `sponsored nofollow` booking link when `affiliateUrl` is set,
 * otherwise a clearly non-functional "Booking coming soon" state.
 *
 * When a card is matched to a real Viator product (BRI-168) it surfaces the
 * provider's commerce signals — "from" price, aggregate rating, free-cancellation
 * — as additive badges. These never replace the editorial `title`/`description`
 * ("match, don't overwrite", docs/07); an unmatched card renders exactly as before.
 */
export function ExperienceRowCard({ experience: e }: { experience: Experience }) {
  const live = Boolean(e.affiliateUrl);
  const hasPrice = typeof e.fromPrice === "number" && e.fromPrice > 0;
  const hasRating = typeof e.rating === "number" && e.rating > 0;

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
        <p className="eyebrow">{e.category}</p>
        <h3 className="mt-2 font-display text-[22px] font-medium leading-snug">
          {e.title}
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

          {live ? (
            <a
              href={e.affiliateUrl}
              target="_blank"
              rel="sponsored nofollow noopener"
              onClick={() =>
                posthog.capture("experience_booking_clicked", {
                  experience_title: e.title,
                  category: e.category,
                  provider: e.provider,
                  price_band: e.priceBand,
                  has_rating: typeof e.rating === "number",
                  free_cancel: Boolean(e.freeCancel),
                })
              }
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
            >
              Book on {e.provider} <ArrowUpRight size={14} />
            </a>
          ) : (
            <span
              aria-disabled
              className="inline-flex cursor-default items-center rounded-[2px] border border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted"
            >
              Booking soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
