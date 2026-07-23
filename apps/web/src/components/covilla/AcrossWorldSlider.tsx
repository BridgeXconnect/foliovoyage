"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type WorldSlide = {
  slug: string;
  city: string;
  country: string;
  heroImage: string;
  heroImageAlt: string;
  count: number;
};

/**
 * Centered "coverflow" destination slider (Covilla "Across the world"): the
 * active slide is full-size and centered, neighbours peek and sit slightly
 * scaled-down. Prev/next arrows plus a "slide x of y" indicator.
 */
export function AcrossWorldSlider({ slides }: { slides: WorldSlide[] }) {
  const [emblaRef, embla] = useEmblaCarousel({
    loop: true,
    align: "center",
    containScroll: false,
  });
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setSelected(embla.selectedScrollSnap());
    embla.on("select", onSelect);
    onSelect();
    return () => {
      embla.off("select", onSelect);
    };
  }, [embla]);

  const scrollPrev = useCallback(() => embla?.scrollPrev(), [embla]);
  const scrollNext = useCallback(() => embla?.scrollNext(), [embla]);

  return (
    <div>
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex touch-pan-y">
          {slides.map((s, i) => {
            const activeSlide = i === selected;
            return (
              <div
                key={s.slug}
                className="min-w-0 flex-[0_0_82%] px-3 sm:flex-[0_0_62%] lg:flex-[0_0_52%]"
              >
                <Link
                  href={`/destinations/${s.slug}`}
                  className={cn(
                    "group relative flex aspect-[16/11] flex-col justify-end overflow-hidden rounded-[3px] text-white transition-[transform,opacity] duration-500",
                    activeSlide
                      ? "scale-100 opacity-100"
                      : "scale-[0.9] opacity-70",
                  )}
                >
                  <Image
                    src={s.heroImage}
                    alt={s.heroImageAlt}
                    fill
                    sizes="(max-width: 640px) 82vw, 52vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        "linear-gradient(rgba(15,19,38,0) 35%, rgba(15,19,38,0.8))",
                    }}
                  />
                  <div className="relative z-10 p-8 text-center">
                    <p className="eyebrow !text-white/80">
                      {s.count} experiences
                    </p>
                    <h3 className="mt-2 font-display text-[32px] font-semibold text-white md:text-[40px]">
                      {s.city}
                    </h3>
                    <p className="text-[14px] text-white/80">{s.country}</p>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      <div className="container-page mt-10 flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={scrollPrev}
          aria-label="Previous destination"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-surface"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[12px] uppercase tracking-[0.18em] text-muted">
          {String(selected + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={scrollNext}
          aria-label="Next destination"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-surface"
        >
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
