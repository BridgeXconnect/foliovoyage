"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Persona } from "@/data/personas";

export type BlogCard = {
  slug: string;
  title: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  displayDate: string;
  category: string;
  personas: string[];
};

/**
 * "Browse the folio" grid with a persona filter chip row. Client-side so the
 * chips can filter without a round-trip; the page stays a server component.
 */
export function BlogPersonaGrid({
  cards,
  personas,
}: {
  cards: BlogCard[];
  personas: Persona[];
}) {
  const [active, setActive] = useState<string>("all");

  const filtered = useMemo(
    () =>
      active === "all"
        ? cards
        : cards.filter((c) => c.personas.includes(active)),
    [cards, active],
  );

  const chips = [{ id: "all", label: "All" }, ...personas];

  return (
    <div>
      <div className="flex items-center gap-5">
        <p className="eyebrow whitespace-nowrap">Recent posts</p>
        <span className="h-px flex-1 bg-line" />
      </div>
      <h2 className="mt-5 text-[32px] font-semibold leading-[1.1] md:text-[44px]">
        Browse the folio
      </h2>

      {/* Persona filter chips */}
      <div className="mt-8 flex flex-wrap gap-3">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActive(c.id)}
            className={cn(
              "rounded-full border px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] transition-colors",
              active === c.id
                ? "border-ink bg-ink text-white"
                : "border-line text-muted hover:border-ink hover:text-ink",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="group flex flex-col overflow-hidden rounded-[8px] border border-line bg-white"
          >
            <div className="relative aspect-[16/10] overflow-hidden">
              <Image
                src={p.image}
                alt={p.imageAlt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
                {p.displayDate} · {p.category}
              </p>
              <h3 className="mt-2 font-display text-[20px] font-medium leading-snug">
                {p.title}
              </h3>
              <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
                {p.excerpt}
              </p>
              <span className="mt-4 text-[12px] font-medium uppercase tracking-[0.16em] text-accent">
                Read more →
              </span>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-[15px] text-muted">
          No posts tagged for this traveller yet — more on the way.
        </p>
      )}
    </div>
  );
}
