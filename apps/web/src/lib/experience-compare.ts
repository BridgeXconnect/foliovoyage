/**
 * Pure selection rule + comparison model for "compare 2–4 tours" (ST-18).
 *
 * Built on the static content system via ST-17's pure helpers (`formatFromPrice`,
 * `experienceDetailPath`) — no `next`/`posthog` runtime imports, so ts-jest runs
 * this in a node env. The presentation (picker + modal) is a thin client layer
 * over this module; all the branching that needs testing lives here.
 *
 * "Inclusions" (guide/transport/meals) is not in the static dataset, so there is
 * no inclusions row; the nearest real policy signal — free cancellation — is the
 * compared cancellation row, and the modal footnotes the gap (plan Findings §I).
 * Any fact a tour lacks is `null` here and an em-dash in the UI — never invented.
 */
import type { Destination, Experience } from "@folio/shared";
import { formatFromPrice, experienceDetailPath } from "@/lib/experience-detail";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/**
 * Toggle an experience id in/out of the compare selection. Removing an already-
 * selected id always works; adding a new id past `max` is a no-op (the cap that
 * enforces "up to 4"). Returns a new array — never mutates `current`.
 */
export function toggleCompareSelection(
  current: readonly string[],
  id: string,
  max: number = MAX_COMPARE,
): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= max) return [...current];
  return [...current, id];
}

/** Whether the current selection is comparable (between min and max inclusive). */
export function canCompare(
  selected: readonly string[],
  min: number = MIN_COMPARE,
  max: number = MAX_COMPARE,
): boolean {
  return selected.length >= min && selected.length <= max;
}

export interface CompareTour {
  id: string;
  title: string;
  image: string;
  imageAlt: string;
  category: string;
  /** ST-17 canonical detail path — the column title links here. */
  detailPath: string;
}

export interface CompareRow {
  key: "price" | "duration" | "rating" | "provider" | "freeCancel";
  label: string;
  /** One cell per tour, in the same order as `tours`. `null` = not available. */
  values: (string | null)[];
}

export interface ComparisonModel {
  tours: CompareTour[];
  rows: CompareRow[];
}

function priceOf(e: Experience): string {
  return typeof e.fromPrice === "number" && e.fromPrice > 0
    ? `From ${formatFromPrice(e.fromPrice, e.currency)}`
    : e.priceBand;
}

function ratingOf(e: Experience): string | null {
  if (typeof e.rating !== "number" || e.rating <= 0) return null;
  const count =
    typeof e.ratingCount === "number"
      ? ` (${e.ratingCount.toLocaleString("en-US")})`
      : "";
  return `${e.rating.toFixed(1)}${count}`;
}

/**
 * Build a side-by-side comparison for `ids` within one destination. Order
 * follows `ids`; ids not present in the destination are skipped.
 */
export function buildComparison(
  destination: Destination,
  ids: readonly string[],
): ComparisonModel {
  const byId = new Map(destination.experiences.map((e) => [e.id, e] as const));
  const picked: Experience[] = ids
    .map((id) => byId.get(id))
    .filter((e): e is Experience => Boolean(e));

  const tours: CompareTour[] = picked.map((e) => ({
    id: e.id,
    title: e.title,
    image: e.image,
    imageAlt: e.imageAlt,
    category: e.category,
    detailPath: experienceDetailPath(destination.slug, e.id),
  }));

  const rows: CompareRow[] = [
    { key: "price", label: "Price", values: picked.map(priceOf) },
    { key: "duration", label: "Duration", values: picked.map((e) => e.duration ?? null) },
    { key: "rating", label: "Rating", values: picked.map(ratingOf) },
    { key: "provider", label: "Provider", values: picked.map((e) => e.provider ?? null) },
    {
      key: "freeCancel",
      label: "Free cancellation",
      // Only assert free cancellation when the data says so; unknown → null.
      values: picked.map((e) => (e.freeCancel === true ? "Yes" : null)),
    },
  ];

  return { tours, rows };
}
