"use client";

import { ArrowUpRight } from "lucide-react";
import { trackAffiliateClick, type AffiliateClickInput } from "@/lib/analytics";

/**
 * Detail-page booking CTA. Mirrors ExperienceRowCard's affiliate seam: a
 * matched experience gets an accent "Book on {provider}" link; an unmatched
 * one gets a secondary "Search on {provider}" link to a provider-search
 * fallback (BRI-138 / ST-26) — never a dead end. Both route through `/go`
 * (`goHref`, resolved server-side by `experienceGoHref`); this component only
 * renders + fires the click event.
 */
export function ExperienceDetailCta({
  goHref,
  isLive,
  provider,
  clickInput,
}: {
  goHref: string;
  isLive: boolean;
  provider?: string;
  clickInput: AffiliateClickInput;
}) {
  return (
    <a
      href={goHref}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={() => trackAffiliateClick(clickInput)}
      className={
        isLive
          ? "inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
          : "inline-flex items-center gap-1.5 rounded-[2px] border border-line px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-ink hover:text-ink"
      }
    >
      {isLive ? `Book on ${provider ?? "Viator"}` : `Search on ${provider ?? "Viator"}`}{" "}
      <ArrowUpRight size={15} />
    </a>
  );
}
