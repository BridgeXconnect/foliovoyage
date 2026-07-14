"use client";

import { useEffect, useState } from "react";

/**
 * The destination page's sticky left panel. On landing the image is full-bleed
 * to the top (square). Once scrolled it eases into a floating card below the
 * header with its two right corners rounded — the Covilla location-page effect.
 *
 * The scroll-dependent values are applied as inline styles (which reliably win
 * over the base `lg:` classes) and only on desktop, so the mobile stacked layout
 * is untouched.
 */
export function StickyFeaturedPanel({
  children,
}: {
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onResize = () => setDesktop(mq.matches);
    const onScroll = () => setScrolled(window.scrollY > 40);

    onResize();
    onScroll();
    mq.addEventListener("change", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mq.removeEventListener("change", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const insetStyle =
    scrolled && desktop
      ? {
          top: 92,
          height: "calc(100vh - 116px)",
          borderTopRightRadius: 24,
          borderBottomRightRadius: 24,
        }
      : undefined;

  return (
    <div
      className="relative flex min-h-[80vh] flex-col justify-end overflow-hidden text-white transition-[top,height,border-radius] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:sticky lg:top-0 lg:h-screen"
      style={insetStyle}
    >
      {children}
    </div>
  );
}
