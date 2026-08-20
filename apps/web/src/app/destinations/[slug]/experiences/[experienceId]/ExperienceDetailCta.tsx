"use client";

import { ArrowUpRight } from "lucide-react";
import { trackAffiliateClick, type AffiliateClickInput } from "@/lib/analytics";

/**
 * Detail-page booking CTA. Mirrors ExperienceRowCard's affiliate seam: a live
 * `sponsored nofollow` link routed through `/go` (passed as `goHref`), or a
 * clearly non-functional "coming soon" state. The href is resolved server-side
 * (`experienceGoHref`); this component only renders + fires the click event.
 */
export function ExperienceDetailCta({
  goHref,
  provider,
  clickInput,
}: {
  goHref?: string;
  provider?: string;
  clickInput: AffiliateClickInput;
}) {
  if (!goHref) {
    return (
      <span
        aria-disabled
        className="inline-flex cursor-default items-center rounded-[2px] border border-line px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted"
      >
        Booking coming soon
      </span>
    );
  }
  return (
    <a
      href={goHref}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={() => trackAffiliateClick(clickInput)}
      className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
    >
      Book on {provider ?? "Viator"} <ArrowUpRight size={15} />
    </a>
  );
}
