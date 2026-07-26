"use client";

import { useEffect, useState } from "react";
import { Instagram, Facebook, Linkedin } from "lucide-react";
import posthog from "posthog-js";
import { cn } from "@/lib/cn";

/**
 * Fixed left rail from Covilla: a vertical scroll-progress line at the top and
 * social icons at the bottom, pinned to the viewport edge. Hidden on small
 * screens. The line fills as the page scrolls. `tone="light"` renders it white
 * for pages whose left edge sits over a dark image (e.g. the split
 * destination page).
 */
export function FixedRail({ tone = "auto" }: { tone?: "auto" | "light" }) {
  const [progress, setProgress] = useState(0);
  const light = tone === "light";

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const socials = [
    { Icon: Instagram, href: "https://instagram.com", label: "Instagram" },
    { Icon: Facebook, href: "https://facebook.com", label: "Facebook" },
    { Icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
  ];

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center justify-between py-28 lg:flex">
      {/* scroll-progress line */}
      <div className={cn("relative h-40 w-px", light ? "bg-white/30" : "bg-line")}>
        <div
          className={cn(
            "absolute left-0 top-0 w-px transition-[height] duration-150",
            light ? "bg-white" : "bg-ink",
          )}
          style={{ height: `${progress * 100}%` }}
        />
      </div>

      <div className="pointer-events-auto flex flex-col items-center gap-5">
        {socials.map(({ Icon, href, label }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            onClick={() => posthog.capture("social_link_clicked", { platform: label })}
            className={cn(
              "transition-colors",
              light
                ? "text-white/70 hover:text-white"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon size={17} strokeWidth={1.6} />
          </a>
        ))}
      </div>
    </div>
  );
}
