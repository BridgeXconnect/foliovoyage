import type { Metadata } from "next";
import { CANVAS_CITIES, type CanvasBucketSummary } from "@folio/shared";
import DiscoverCanvas from "@/canvas/DiscoverCanvas";
import { fetchCanvasSummaries } from "@/lib/canvas-api";

/**
 * /discover — the discovery canvas (spec 0004), slice 1: Bangkok only.
 * Unlinked, `noindex`, left out of the sitemap, and not blocked in robots.txt
 * (a robots block would stop crawlers from ever seeing the noindex). The pan,
 * culler and tile code load only on this route (AC-L12).
 */
export const metadata: Metadata = {
  title: "Discover",
  robots: { index: false, follow: false },
};

// The summaries are read fresh per request, like the destination pages.
export const dynamic = "force-dynamic";

/** Slice 1 shows one city. */
const CITY = CANVAS_CITIES[0];

export default async function DiscoverPage() {
  let summaries: CanvasBucketSummary[] = [];
  try {
    summaries = (await fetchCanvasSummaries()).filter((s) => s.citySlug === CITY.slug);
  } catch (err) {
    // The canvas still renders its titles and exit tiles, and each bucket's
    // tiles are fetched on approach, so a summary failure is not a dead page.
    console.error("discover: canvas summaries unavailable", err);
  }

  return (
    <main className="canvas-root fixed inset-0 overflow-hidden bg-white">
      <h1 className="sr-only">Discover {CITY.name}</h1>
      <DiscoverCanvas city={CITY} summaries={summaries} />
    </main>
  );
}
