"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Testimonial } from "@/data/testimonials";

/**
 * Full-bleed parallax testimonial band (Covilla): a fixed-feel background image
 * that drifts on scroll, with a numbered index (1..N) selecting the quote.
 */
export function TestimonialParallax({
  testimonials,
  image,
  imageAlt,
  eyebrow = "What travellers say",
}: {
  testimonials: Testimonial[];
  image: string;
  imageAlt: string;
  /** Section label. Defaults to a reviews framing; pass an honest editorial
   *  label (e.g. "What we stand for") when the quotes aren't customer reviews. */
  eyebrow?: string;
}) {
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
      setOffset((Math.min(1, Math.max(0, progress)) - 0.5) * 80);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-rotate quotes.
  useEffect(() => {
    const id = window.setInterval(
      () => setActive((a) => (a + 1) % testimonials.length),
      6000,
    );
    return () => window.clearInterval(id);
  }, [testimonials.length]);

  const t = testimonials[active];

  return (
    <section
      ref={ref}
      className="relative flex min-h-[560px] items-center overflow-hidden"
    >
      <div className="absolute inset-0" style={{ transform: `translateY(${offset}px) scale(1.12)` }}>
        <Image
          src={image}
          alt={imageAlt}
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div className="absolute inset-0 bg-overlay/60" />

      <div className="container-page relative z-10 flex flex-col items-center gap-10 py-24 text-center text-white lg:flex-row lg:items-center lg:gap-16 lg:text-left">
        {/* Numbered index */}
        <div className="flex gap-4 lg:flex-col">
          {testimonials.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Testimonial ${i + 1}`}
              className={
                "relative pl-0 text-[15px] font-medium transition-colors lg:pl-5 " +
                (i === active ? "text-white" : "text-white/45 hover:text-white/70")
              }
            >
              {i === active && (
                <span className="absolute left-0 top-1/2 hidden h-6 w-[3px] -translate-y-1/2 rounded bg-white lg:block" />
              )}
              {String(i + 1).padStart(2, "0")}
            </button>
          ))}
        </div>

        <div className="max-w-3xl">
          <p className="eyebrow !text-white/70">{eyebrow}</p>
          <blockquote className="mt-5 font-display text-[24px] font-medium leading-[1.4] md:text-[30px]">
            &ldquo;{t.quote}&rdquo;
          </blockquote>
          <p className="mt-6 text-[15px] text-white/80">
            <span className="font-medium text-white">{t.name}</span>
            <span className="mx-2">·</span>
            {t.location}
          </p>
        </div>
      </div>
    </section>
  );
}
