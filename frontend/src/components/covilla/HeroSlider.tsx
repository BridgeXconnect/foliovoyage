"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight, ChevronRight, Play, X } from "lucide-react";

export type HeroSlide = {
  slug: string;
  city: string;
  country: string;
  heroImage: string;
  heroImageAlt: string;
  count: number;
  fromPrice: number;
};

/**
 * Full-bleed hero slider (Covilla hero): the background image slides between
 * destinations while the eyebrow / headline / CTA stay fixed. A "popular
 * location" card (bottom-right) reflects the active slide, with prev/next
 * arrows and a decorative video-play accent.
 */
export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const [emblaRef, embla] = useEmblaCarousel({ loop: true, duration: 30 });
  const [selected, setSelected] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setSelected(embla.selectedScrollSnap());
    embla.on("select", onSelect);
    onSelect();
    return () => {
      embla.off("select", onSelect);
    };
  }, [embla]);

  // Gentle auto-advance.
  useEffect(() => {
    if (!embla) return;
    const id = window.setInterval(() => embla.scrollNext(), 6500);
    return () => window.clearInterval(id);
  }, [embla]);

  const scrollPrev = useCallback(() => embla?.scrollPrev(), [embla]);
  const scrollNext = useCallback(() => embla?.scrollNext(), [embla]);
  const active = slides[selected] ?? slides[0];

  return (
    <section className="relative h-[92vh] min-h-[620px] w-full overflow-hidden">
      {/* Slides */}
      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex h-full">
          {slides.map((s, i) => (
            <div key={s.slug} className="relative h-full min-w-0 flex-[0_0_100%]">
              <Image
                src={s.heroImage}
                alt={s.heroImageAlt}
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, rgba(15,19,38,0.72) 0%, rgba(15,19,38,0.5) 40%, rgba(15,19,38,0.35) 100%)",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Fixed overlay content */}
      <div className="pointer-events-none absolute inset-0">
        <div className="container-page flex h-full flex-col justify-center pt-20 lg:pl-24">
          <p className="eyebrow pointer-events-auto !text-white/80">
            A curated travel folio
          </p>
          <h1 className="pointer-events-auto mt-5 max-w-3xl text-[44px] font-semibold leading-[1.02] text-white md:text-[76px]">
            Let&apos;s plan your next voyage
          </h1>
          <div className="pointer-events-auto mt-9">
            <Link
              href="/legal/contact"
              className="inline-flex items-center bg-white px-10 py-5 text-[11px] font-medium uppercase tracking-[0.22em] text-ink transition-transform hover:-translate-y-0.5"
            >
              Contact us
            </Link>
          </div>
        </div>

        {/* Video-play accent */}
        <button
          type="button"
          onClick={() => setVideoOpen(true)}
          aria-label="Play destination film"
          className="pointer-events-auto absolute right-[8%] top-1/2 hidden h-40 w-40 -translate-y-1/2 items-center justify-center lg:flex"
        >
          <span className="absolute inset-0 rounded-full border border-dashed border-white/50 animate-spin-slow" />
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-colors hover:bg-white/25">
            <Play size={24} className="ml-1 text-white" fill="white" />
          </span>
        </button>

        {/* Popular-location card (with integrated prev/next + guide chevron) */}
        <div className="pointer-events-auto absolute bottom-0 right-0 hidden flex-col items-end md:flex">
          <p className="eyebrow mb-3 mr-6 !text-white/80">Popular location</p>
          <div className="flex items-stretch bg-white">
            {/* slider controls */}
            <div className="flex flex-col">
              <button
                type="button"
                onClick={scrollNext}
                aria-label="Next destination"
                className="flex h-1/2 w-14 items-center justify-center border-b border-r border-line text-ink transition-colors hover:bg-surface"
              >
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                onClick={scrollPrev}
                aria-label="Previous destination"
                className="flex h-1/2 w-14 items-center justify-center border-r border-line text-ink transition-colors hover:bg-surface"
              >
                <ArrowLeft size={18} />
              </button>
            </div>
            {/* location + price */}
            <div className="px-8 py-7">
              <p className="font-display text-[22px] font-medium text-ink">
                {active.city},{" "}
                <span className="text-muted">{active.country}</span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                Starting at{" "}
                <span className="text-ink">
                  ${active.fromPrice.toLocaleString("en-US")}
                </span>
              </p>
            </div>
            {/* open guide */}
            <Link
              href={`/destinations/${active.slug}`}
              aria-label={`Open the ${active.city} guide`}
              className="flex w-16 items-center justify-center border-l border-line text-ink transition-colors hover:bg-accent hover:text-white"
            >
              <ChevronRight size={22} />
            </Link>
          </div>
        </div>
      </div>

      {videoOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-overlay/85 p-6"
          onClick={() => setVideoOpen(false)}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-white/40 text-white"
          >
            <X size={20} />
          </button>
          <div
            className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-[3px]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={active.heroImage}
              alt={active.heroImageAlt}
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-overlay/50 text-center text-white">
              <p className="eyebrow !text-white/80">{active.city}</p>
              <p className="mt-3 max-w-md px-6 text-[18px]">
                Destination films are coming soon. For now, explore the full
                written guide.
              </p>
              <Link
                href={`/destinations/${active.slug}`}
                className="mt-6 inline-flex items-center bg-white px-8 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-ink"
              >
                Open {active.city} guide
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
