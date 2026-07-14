import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { Experience } from "@/data/types";
import { cn } from "@/lib/cn";

/** Colour accent per intent category — subtle, editorial, not garish. */
const categoryClass: Record<Experience["category"], string> = {
  "Culture & History": "bg-[#eef2fb] text-[#1e5bd6]",
  "Food & Drink": "bg-[#fbeeef] text-[#b23a48]",
  "Nature & Outdoors": "bg-[#eaf4ee] text-[#2f7a4d]",
  Landmarks: "bg-[#f2eefb] text-[#6b3fbf]",
  Neighbourhoods: "bg-[#fbf3ea] text-[#b26a1e]",
  Nightlife: "bg-[#efeefb] text-[#4b3fbf]",
  "Day Trips": "bg-[#eef7fb] text-[#1e86d6]",
  Wellness: "bg-[#eefbf6] text-[#1e9c78]",
  "Water & Coast": "bg-[#eaf3fb] text-[#1e6bd6]",
};

/**
 * A single curated Experience.
 *
 * CTA logic is the affiliate seam: with `affiliateUrl` set the card renders a
 * real, disclosed, `sponsored nofollow` booking link; without it, a clearly
 * non-functional "Coming soon" state. No fake booking links are ever rendered.
 */
export function ExperienceCard({ experience }: { experience: Experience }) {
  const { title, description, image, imageAlt, category, priceBand, duration } =
    experience;
  const live = Boolean(experience.affiliateUrl);

  return (
    <article className="group flex flex-col overflow-hidden rounded-card border border-line bg-white transition-shadow duration-300 hover:shadow-[0_18px_40px_-24px_rgba(15,19,38,0.45)]">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={image}
          alt={imageAlt}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span
          className={cn(
            "absolute left-3 top-3 rounded-full px-3 py-1 text-[11px] font-medium",
            categoryClass[category],
          )}
        >
          {category}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span
            aria-label={`Price band ${priceBand}`}
            className="font-medium text-ink"
          >
            {priceBand}
          </span>
          {duration && (
            <>
              <span aria-hidden>·</span>
              <span>{duration}</span>
            </>
          )}
        </div>

        <h3 className="mt-2 text-[19px] font-display font-medium leading-snug">
          {title}
        </h3>
        <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
          {description}
        </p>

        <div className="mt-5">
          {live ? (
            <a
              href={experience.affiliateUrl}
              target="_blank"
              rel="sponsored nofollow noopener"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
            >
              Book on {experience.provider}
              <ArrowUpRight size={15} />
            </a>
          ) : (
            <span
              aria-disabled
              className="inline-flex cursor-default items-center gap-1.5 rounded-card border border-line px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted"
            >
              Booking coming soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
