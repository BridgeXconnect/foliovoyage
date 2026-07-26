"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import posthog from "posthog-js";

export type VacationItem = {
  id: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  priceBand: string;
  city: string;
  country: string;
  slug: string;
};

/**
 * "Popular Folio experiences" (Covilla "Popular Vacations" block): a row of
 * country tabs sitting above an animated timeline, with three experience cards
 * for the active country. Prices are shown as bands (no fake exact prices) and
 * each card's "Details" links to its destination guide — no fake booking links.
 *
 * Reused on the homepage and on /destinations, so the eyebrow/title are props.
 */
export function PopularVacations({
  items,
  eyebrow = "Popular Folio experiences",
  title = "Standout things to do, everywhere we cover",
  perCountry = 3,
}: {
  items: VacationItem[];
  eyebrow?: string;
  title?: string;
  perCountry?: number;
}) {
  // Preserve first-seen country order, then cap cards per country.
  const countries = useMemo(() => {
    const seen: string[] = [];
    for (const i of items) if (!seen.includes(i.country)) seen.push(i.country);
    return seen;
  }, [items]);

  const [active, setActive] = useState(0);
  const activeCountry = countries[active] ?? countries[0];

  const cards = useMemo(
    () =>
      items.filter((i) => i.country === activeCountry).slice(0, perCountry),
    [items, activeCountry, perCountry],
  );

  return (
    <section className="container-page py-24 md:py-32">
      <div className="max-w-xl">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-4 text-[34px] font-semibold leading-[1.1] md:text-[46px]">
          {title}
        </h2>
      </div>

      {/* Country tabs */}
      <div
        role="tablist"
        aria-label="Countries"
        className="mt-12 flex flex-wrap gap-x-10 gap-y-3"
      >
        {countries.map((c, i) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => {
              setActive(i);
              posthog.capture("destination_country_tab_changed", { country: c });
            }}
            className={cn(
              "text-[12px] font-medium uppercase tracking-[0.18em] transition-colors",
              active === i ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Animated timeline: a track with a node per country and a progress fill */}
      <div className="relative mt-6 h-4">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-ink transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            width:
              countries.length > 1
                ? `${(active / (countries.length - 1)) * 100}%`
                : "0%",
          }}
        />
        <div className="relative flex justify-between">
          {countries.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              tabIndex={-1}
              onClick={() => setActive(i)}
              className="flex h-4 w-4 items-center justify-center"
            >
              <span
                className={cn(
                  "block rounded-full transition-all duration-300",
                  active === i
                    ? "h-4 w-4 border-2 border-ink bg-white"
                    : "h-2 w-2 bg-line",
                )}
              >
                {active === i && (
                  <span className="block h-full w-full scale-[0.4] rounded-full bg-ink" />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Cards for the active country */}
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((v) => (
          <article
            key={v.id}
            className="group flex h-full flex-col overflow-hidden rounded-[8px] border border-line bg-white"
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image
                src={v.image}
                alt={v.imageAlt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
                {v.city}
              </p>
              <h3 className="mt-2 font-display text-[21px] font-medium leading-snug">
                {v.title}
              </h3>
              <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
                {v.description}
              </p>
              <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                    Rates from
                  </p>
                  <p className="text-[15px] font-medium text-ink">
                    {v.priceBand}
                  </p>
                </div>
                <Link
                  href={`/destinations/${v.slug}`}
                  onClick={() =>
                    posthog.capture("vacation_details_clicked", {
                      title: v.title,
                      city: v.city,
                      country: v.country,
                      destination_slug: v.slug,
                    })
                  }
                  className="inline-flex items-center gap-1.5 border border-line px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink transition-colors hover:border-ink"
                >
                  Details <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
