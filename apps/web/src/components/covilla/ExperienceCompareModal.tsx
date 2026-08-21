"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, ArrowUpRight } from "lucide-react";
import type { Destination } from "@folio/shared";
import { buildComparison } from "@/lib/experience-compare";
import {
  experienceGoHref,
  experienceDetailAffiliateInput,
} from "@/lib/experience-detail";
import { trackAffiliateClick } from "@/lib/analytics";

/**
 * Side-by-side comparison dialog for 2–4 selected tours (ST-18). Presentational:
 * it turns `selectedIds` into a `ComparisonModel` (pure) and lays the tours out
 * as columns with a sticky left label column. Facts a tour lacks render as "—"
 * (honest absence — see plan Findings §I/§II). Each column's booking CTA reuses
 * ST-17's `/go` seam and the shared `trackAffiliateClick` payload — no new link
 * logic. Itemized inclusions aren't in the dataset, so a footnote points to each
 * tour's provider page instead of fabricating a list.
 */
export function ExperienceCompareModal({
  destination,
  selectedIds,
  onClose,
}: {
  destination: Destination;
  selectedIds: string[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const model = buildComparison(destination, selectedIds);
  const byId = new Map(destination.experiences.map((e) => [e.id, e] as const));

  // Close on Escape; trap Tab within the dialog; focus the close button on
  // open; lock body scroll.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
        return;
      }
      if (ev.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (ev.shiftKey) {
        if (active === first || !panelRef.current?.contains(active)) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panelRef.current?.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const colWidth = "min-w-[220px] max-w-[280px]";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${model.tours.length} tours in ${destination.city}`}
    >
      {/* Backdrop — mouse-only close target; hidden from a11y tree and tab
          order so it doesn't duplicate the X button's "Close comparison" label. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/60"
      />

      <div
        ref={panelRef}
        className="relative z-10 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[4px] bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-[20px] font-medium">
            Compare tours — {destination.city}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto px-6 py-6">
          <table className="w-full border-collapse text-left align-top">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white" />
                {model.tours.map((t) => (
                  <th key={t.id} className={`${colWidth} px-3 pb-4 font-normal`}>
                    <div className="relative mb-3 aspect-[16/10] overflow-hidden rounded-[3px] bg-surface">
                      <Image
                        src={t.image}
                        alt={t.imageAlt}
                        fill
                        sizes="280px"
                        className="object-cover"
                      />
                    </div>
                    <p className="eyebrow">{t.category}</p>
                    <Link
                      href={t.detailPath}
                      className="mt-1 block font-display text-[16px] font-medium leading-snug transition-colors hover:text-accent"
                    >
                      {t.title}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-white py-3 pr-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted"
                  >
                    {row.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td key={model.tours[i].id} className="px-3 py-3 text-[14px] text-ink">
                      {v ?? <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Booking CTA row — reuses ST-17's /go seam per column. */}
              <tr className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-white py-4 pr-4" />
                {model.tours.map((t) => {
                  const e = byId.get(t.id)!;
                  const goHref = experienceGoHref(destination.slug, e);
                  const clickInput = experienceDetailAffiliateInput(destination, e);
                  return (
                    <td key={t.id} className="px-3 py-4">
                      {goHref ? (
                        <a
                          href={goHref}
                          target="_blank"
                          rel="sponsored nofollow noopener"
                          onClick={() => trackAffiliateClick(clickInput)}
                          className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white"
                        >
                          Book on {e.provider ?? "Viator"} <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        <span className="inline-flex cursor-default items-center rounded-[2px] border border-line px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                          Booking soon
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          <p className="mt-6 max-w-2xl text-[12px] leading-6 text-muted">
            Detailed inclusions (guide, transport, meals) vary by tour — open a
            tour to see its full details on the provider’s page. Hand-picked and
            independently written; see our{" "}
            <Link href="/legal/disclosure" className="text-accent underline">
              affiliate disclosure
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
