"use client";

import { useEffect, useState } from "react";

/**
 * Brief intro preloader (Covilla-style): a full-screen wordmark curtain that
 * lifts once the page is ready. Purely decorative; disappears fast and never
 * blocks content for users with reduced-motion preferences.
 */
export function Preloader() {
  const [gone, setGone] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t1 = window.setTimeout(() => setGone(true), reduce ? 0 : 700);
    const t2 = window.setTimeout(() => setHidden(true), reduce ? 0 : 1400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[200] flex items-center justify-center bg-white transition-transform duration-700 ease-[cubic-bezier(0.76,0,0.24,1)]"
      style={{ transform: gone ? "translateY(-100%)" : "translateY(0)" }}
    >
      <span className="flex items-baseline gap-[5px] text-[26px]">
        <span className="font-serif font-semibold text-ink">Folio</span>
        <span className="font-sans font-light tracking-[0.5px] text-ink">
          Voyage
        </span>
      </span>
    </div>
  );
}
