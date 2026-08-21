"use client";

import { useState } from "react";
import { Scale, X } from "lucide-react";
import type { Destination } from "@folio/shared";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
import { ExperienceCompareModal } from "@/components/covilla/ExperienceCompareModal";
import {
  MAX_COMPARE,
  toggleCompareSelection,
  canCompare,
} from "@/lib/experience-compare";
import { trackToursCompared } from "@/lib/analytics";

/**
 * Client island (ST-18) that replaces the destination page's inline experience
 * list. It owns the compare selection (2–4 within this one destination), renders
 * each `ExperienceRowCard` with a compare checkbox, shows a sticky tray once
 * anything is selected, and opens `ExperienceCompareModal`. Selection is in-
 * memory per page visit (no URL param — plan Findings §IV). The RSC page passes
 * the whole `Destination`; nothing here needs the network.
 */
export function ExperienceComparePicker({ destination }: { destination: Destination }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const atMax = selected.length >= MAX_COMPARE;
  const ready = canCompare(selected);

  function toggle(id: string) {
    setSelected((cur) => toggleCompareSelection(cur, id));
  }

  function openCompare() {
    if (!ready) return;
    trackToursCompared({
      destinationSlug: destination.slug,
      city: destination.city,
      country: destination.country,
      experienceIds: selected,
    });
    setOpen(true);
  }

  return (
    <>
      <div className="mt-8 space-y-6">
        {destination.experiences.map((e) => (
          <ExperienceRowCard
            key={e.id}
            experience={e}
            destination={{ slug: destination.slug, city: destination.city, country: destination.country }}
            compare={{
              selected: selected.includes(e.id),
              disabled: atMax,
              onToggle: () => toggle(e.id),
            }}
          />
        ))}
      </div>

      {/* Sticky compare tray — appears once anything is selected. */}
      {selected.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-5">
          <div className="pointer-events-auto flex w-full max-w-2xl items-center justify-between gap-4 rounded-full border border-line bg-white px-5 py-3 shadow-[0_18px_40px_-20px_rgba(15,19,38,0.5)]">
            <p className="text-[13px] text-ink-soft">
              <span className="font-medium text-ink">{selected.length}</span> selected
              <span className="text-muted"> · pick 2–{MAX_COMPARE}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
              >
                <X size={14} /> Clear
              </button>
              <button
                type="button"
                onClick={openCompare}
                disabled={!ready}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Scale size={14} /> Compare ({selected.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <ExperienceCompareModal
          destination={destination}
          selectedIds={selected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
