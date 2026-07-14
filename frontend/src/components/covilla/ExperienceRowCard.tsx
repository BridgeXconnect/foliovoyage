import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { Experience } from "@/data/types";

/**
 * Horizontal experience card in the Covilla "vacation" style (image left,
 * details right) for the destination page's right column. Keeps the affiliate
 * seam: a live `sponsored nofollow` booking link when `affiliateUrl` is set,
 * otherwise a clearly non-functional "Booking coming soon" state.
 */
export function ExperienceRowCard({ experience: e }: { experience: Experience }) {
  const live = Boolean(e.affiliateUrl);

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

        <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
              Price
            </p>
            <p className="text-[15px] font-medium text-ink">
              {e.priceBand}
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
