/**
 * The `from` query value on a tour page URL (spec 0005, AC-13, AC-14). The
 * bucket links write `/tours/:id?from=<citySlug>.<categorySlug>` (`tourHref`); the value is read
 * in the browser only, so the page stays static. It is untrusted input: it is
 * split on the first dot and accepted only when both parts are in the shared
 * canvas lists. The raw string is never rendered, linked or logged, only the
 * validated slugs and the key rebuilt from them.
 */

import { CANVAS_CATEGORIES, CANVAS_CITIES, type CanvasTile } from "@folio/shared";

/** A tile plus the city and category of its bucket. */
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

export type ValidFrom = {
  citySlug: string;
  categorySlug: string;
  categoryLabel: string;
  /** Rebuilt from the validated parts, never the raw input. */
  key: string;
};

export function parseFrom(raw: string | null | undefined): ValidFrom | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const citySlug = raw.slice(0, dot);
  const categorySlug = raw.slice(dot + 1);
  const city = CANVAS_CITIES.find((c) => c.slug === citySlug);
  const category = CANVAS_CATEGORIES.find((c) => c.slug === categorySlug);
  if (!city || !category) return null;
  return { citySlug: city.slug, categorySlug: category.slug, categoryLabel: category.label, key: `${city.slug}.${category.slug}` };
}

/** `from` for the tour page itself: valid only when its city is the tour's own. */
export function parseFromForTour(raw: string | null | undefined, tourCitySlug: string): ValidFrom | null {
  const from = parseFrom(raw);
  return from && from.citySlug === tourCitySlug ? from : null;
}
