import type { CanvasImage } from "@folio/shared";

/**
 * Picks a tile's picture from `Tour.images` and `Tour.imageUrl` (AC-F7). Done in
 * code, not SQL, so the feed stays one query per request (AC-F10).
 *
 * The entry is the one flagged `isCover`, else the first. Within it the pick is
 * the smallest variant at least `minWidth` wide, else the widest, skipping
 * variants of width 0 (the normalizer's "unknown"), else `imageUrl`.
 *
 * `minWidth` is 480 for an `sm` tile (rank 21 to 50) and 640 for `md` and `lg`.
 * These are source image widths, not slot geometry, so they live here and not in
 * `@folio/shared`; the rank where `sm` starts is pinned to the shared tier
 * boundary by `canvas-categories.spec.ts`.
 */
export const SM_FIRST_RANK = 21;
export const MIN_WIDTH_SM = 480;
export const MIN_WIDTH_MD_LG = 640;

interface Variant {
  url: string;
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Variants of one entry that carry a url. Width and height 0 or missing mean "unknown". */
function variantsOf(entry: unknown): Variant[] {
  if (!isRecord(entry) || !Array.isArray(entry.variants)) return [];
  const out: Variant[] = [];
  for (const v of entry.variants) {
    if (!isRecord(v) || typeof v.url !== "string" || v.url === "") continue;
    const width = typeof v.width === "number" && Number.isFinite(v.width) && v.width > 0 ? Math.round(v.width) : 0;
    const height = typeof v.height === "number" && Number.isFinite(v.height) && v.height > 0 ? Math.round(v.height) : 0;
    out.push({ url: v.url, width, height });
  }
  return out;
}

function toImage(v: Variant): CanvasImage {
  return { url: v.url, width: v.width > 0 ? v.width : null, height: v.height > 0 ? v.height : null };
}

export function minWidthForRank(rank: number): number {
  return rank >= SM_FIRST_RANK ? MIN_WIDTH_SM : MIN_WIDTH_MD_LG;
}

/**
 * The image for a tile of this 1-based rank, or null when the tour has no usable
 * image at all. The SQL eligibility filter already guarantees a url somewhere,
 * so null is not expected for a feed row.
 */
export function pickImage(images: unknown, imageUrl: string | null, rank: number): CanvasImage | null {
  const entries = Array.isArray(images) ? images : [];
  const entry = entries.find((e) => isRecord(e) && e.isCover === true) ?? entries[0];

  const sized = variantsOf(entry).filter((v) => v.width > 0);
  const minWidth = minWidthForRank(rank);
  const wideEnough = sized.filter((v) => v.width >= minWidth);
  if (wideEnough.length > 0) {
    return toImage(wideEnough.reduce((best, v) => (v.width < best.width ? v : best)));
  }
  if (sized.length > 0) {
    return toImage(sized.reduce((best, v) => (v.width > best.width ? v : best)));
  }

  if (imageUrl) return { url: imageUrl, width: null, height: null };

  // Last resort, so a tour the SQL filter let through is never dropped: any
  // variant url on any entry, size unknown.
  for (const e of entries) {
    const [first] = variantsOf(e);
    if (first) return { url: first.url, width: null, height: null };
  }
  return null;
}
