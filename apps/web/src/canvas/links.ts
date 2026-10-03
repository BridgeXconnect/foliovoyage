/**
 * The only two places that build a canvas link target (spec 0004, AC-L13).
 * When the tour page exists, `tourHref` changes here and nowhere else.
 */

import type { CanvasCity, CanvasTile } from "@folio/shared";

/** A tile plus the city its bucket belongs to. */
export type TileRef = Pick<CanvasTile, "id" | "tourId"> & { readonly citySlug: string };

/** Until the tour page exists, a tile opens its city's destination page. */
export function tourHref(tile: TileRef): string {
  return `/destinations/${tile.citySlug}`;
}

/** The exit tile opens the city's destination page. */
export function exitHref(city: Pick<CanvasCity, "slug">): string {
  return `/destinations/${city.slug}`;
}

/** The exit tile's copy, one constant so the designer can change it (AC-T6). */
export const exitTileCopy = (cityName: string): string => `Explore ${cityName} →`;
