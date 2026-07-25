import Image from "next/image";
import { ArrowUpRight, Star } from "lucide-react";

import type { ApiExperience } from "@/lib/api";

/**
 * Experience card for the DB-backed destination page (ST-11 / BRI-164).
 *
 * Renders a *published* Experience read from the API (with its linked Tour's
 * image + price). It mirrors the exact affiliate seam of the static
 * {@link ExperienceRowCard} — `live = Boolean(affiliateUrl)` flips a
 * `sponsored nofollow` booking link vs. a non-functional "coming soon"
 * placeholder — but is a separate component so the OTA-approved static card is
 * never touched, and it tolerates the fields an auto-created import doesn't have
 * yet: a null image (neutral placeholder), a null price band (hidden), a null
 * editor rating (hidden), and empty tags.
 */
export function DbExperienceCard({ experience: e }: { experience: ApiExperience }) {
  const live = Boolean(e.affiliateUrl);

  return (
    <article className="flex flex-col overflow-hidden rounded-[3px] border border-line bg-white transition-shadow duration-300 hover:shadow-[0_18px_40px_-28px_rgba(15,19,38,0.45)] sm:flex-row">
      <div className="relative aspect-[16/10] bg-surface sm:aspect-auto sm:w-[42%] sm:min-h-[230px]">
        {e.imageUrl ? (
          <Image
            src={e.imageUrl}
            alt={e.imageAlt ?? e.title}
            fill
            sizes="(max-width: 640px) 100vw, 260px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.16em] text-muted">
            No image yet
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        {e.tags.length > 0 && (
          <p className="eyebrow">{e.tags.join(" · ")}</p>
        )}
        <h3 className="mt-2 font-display text-[22px] font-medium leading-snug">
          {e.title}
        </h3>
        <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
          {e.description}
        </p>

        <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
          <div className="flex flex-col gap-1">
            {e.editorRating !== null && (
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-ink">
                <Star size={13} className="fill-current text-accent" />
                {e.editorRating.toFixed(1)}
              </span>
            )}
            {e.priceBand && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                  Price
                </p>
                <p className="text-[15px] font-medium text-ink">{e.priceBand}</p>
              </div>
            )}
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
