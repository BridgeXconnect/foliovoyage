/**
 * The `from` query value on a tour page URL (spec 0005, AC-13, AC-14). The
 * canvas links to `/tours/:id?from=<citySlug>.<categorySlug>`; the value is read
 * in the browser only, so the page stays static. It is untrusted input: it is
 * split on the first dot and accepted only when both parts are in the shared
 * canvas lists. The raw string is never rendered, linked or logged, only the
 * validated slugs and the key rebuilt from them.
 */

import { CANVAS_CATEGORIES, CANVAS_CITIES } from "@folio/shared";

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
