/**
 * The only two places that build a canvas link target (spec 0004, AC-L13).
 * A tour tile opens the database tour page (spec 0005, AC-16); the exit tile
 * stays on the city page.
 */

import type { CanvasCity, CanvasTile } from "@folio/shared";

/** A tile plus the city its bucket belongs to. */
export type TileRef = Pick<CanvasTile, "id"> & {
  readonly citySlug: string;
  readonly categorySlug: string;
};

/**
 * A tile opens `/tours/:experienceId?from=<city>.<category>`. Both slugs are
 * the tile's bucket keys from the shared lists, never free text. A tile with no
 * Experience id throws, so a bad tile fails loudly instead of linking to
 * `/tours/undefined`.
 */
export function tourHref(tile: TileRef): string {
  if (!tile.id) throw new Error("tourHref: tile has no Experience id");
  return `/tours/${encodeURIComponent(tile.id)}?from=${tile.citySlug}.${tile.categorySlug}`;
}

/** The exit tile opens the city's destination page. */
export function exitHref(city: Pick<CanvasCity, "slug">): string {
  return `/destinations/${city.slug}`;
}

/** The exit tile's copy, one constant so the designer can change it (AC-T6). */
export const exitTileCopy = (cityName: string): string => `Explore ${cityName} →`;
