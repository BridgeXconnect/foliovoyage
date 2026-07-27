"use client";

/**
 * Load-on-interaction gate for the 3D map (ST-MAP-POC / BRI-167, docs/11 §3).
 *
 * The heavy scene (`DestinationMap3D` → maplibre-gl + three) is code-split via
 * `next/dynamic({ ssr: false })` and only imported once the user clicks "View in 3D",
 * so the SSR/indexable destination page stays CWV-fast and ships none of the map JS
 * in its initial bundle.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import type { CuratedTour } from "@/data/map-poc/bangkok-tour";

const DestinationMap3D = dynamic(() => import("./DestinationMap3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] min-h-[420px] w-full items-center justify-center rounded-xl border border-black/10 bg-gray-50 text-sm text-gray-500">
      Loading the 3D map…
    </div>
  ),
});

export function View3DButton({ tour }: { tour: CuratedTour }) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <section aria-label={`3D map: ${tour.title}`} className="mt-6">
        <DestinationMap3D tour={tour} onClose={() => setOpen(false)} />
      </section>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-black/10 bg-gradient-to-br from-orange-50 to-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">See it in 3D</p>
        <p className="text-sm text-gray-600">
          Fly through the {tour.title.toLowerCase()} — terrain, buildings and a mapped route.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-orange-800"
      >
        View this tour in 3D
      </button>
    </div>
  );
}
