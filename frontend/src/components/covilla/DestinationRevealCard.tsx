"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type RevealDestination = {
  slug: string;
  city: string;
  country: string;
  count: number;
  heroImage: string;
  heroImageAlt: string;
};

const GRADIENT =
  "linear-gradient(90deg, rgba(15,19,38,0.78) 0%, rgba(15,19,38,0.45) 45%, rgba(15,19,38,0.2) 100%)";

/**
 * Destination card that reveals its hero image when `active`. Shared by the
 * hamburger flyout (`variant="row"`) and the header's DESTINATIONS dropdown
 * (`variant="tile"`) so the two can't drift apart. The parent owns the active
 * index; hovering/focusing a card calls `onActivate`.
 */
export function DestinationRevealCard({
  destination: d,
  active,
  onActivate,
  onClick,
  variant,
}: {
  destination: RevealDestination;
  active: boolean;
  onActivate: () => void;
  onClick?: () => void;
  variant: "row" | "tile";
}) {
  const isRow = variant === "row";

  return (
    <Link
      href={`/destinations/${d.slug}`}
      onClick={onClick}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className={cn(
        "group relative flex overflow-hidden rounded-[3px] border transition-colors duration-300",
        isRow
          ? "h-[92px] items-center justify-between px-6"
          : "h-[150px] flex-col justify-center px-6",
        active ? "border-transparent" : "border-line",
      )}
    >
      <Image
        src={d.heroImage}
        alt={d.heroImageAlt}
        fill
        sizes={isRow ? "420px" : "340px"}
        style={{ objectPosition: "center 60%" }}
        className={cn(
          "object-cover transition-opacity duration-500",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500",
          active ? "opacity-100" : "opacity-0",
        )}
        style={{ backgroundImage: GRADIENT }}
      />

      <div className="relative z-10">
        <p
          className={cn(
            "font-display font-semibold transition-colors duration-300",
            isRow ? "text-[22px]" : "text-[24px]",
            active ? "text-white" : "text-ink",
          )}
        >
          {d.city}
        </p>
        <p
          className={cn(
            "text-[11px] uppercase tracking-[0.16em] transition-colors duration-300",
            isRow ? "" : "mt-1",
            active ? "text-white/80" : "text-muted",
          )}
        >
          {d.count} experiences
        </p>
      </div>

      <span
        className={cn(
          "relative z-10 flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300",
          !isRow && "absolute right-6 top-1/2 -translate-y-1/2",
          active ? "border-white/70 text-white" : "border-line text-muted",
        )}
      >
        <ArrowRight size={16} />
      </span>
    </Link>
  );
}
