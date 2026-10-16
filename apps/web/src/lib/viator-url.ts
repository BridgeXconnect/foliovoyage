/**
 * Viator URL helpers for the affiliate redirects (spec 0005, AC-9).
 *
 * Pure string handling. Both helpers are shared by `/go/tours/:id` and the
 * older `/go/:slug/:id` so there is one definition of "a Viator URL".
 */

/**
 * `isViatorHost` lives in `@folio/shared` so the API's SEO slice membership
 * rule (spec 0006 AC-M3) uses the same check. Re-exported here so both `/go`
 * routes keep this import.
 */
export { isViatorHost } from "@folio/shared";

/**
 * Sets `campaign` on an affiliate URL by string handling, never through
 * `URL.searchParams.set` (which re-serializes the whole query and can re-encode
 * other parameters). An existing `campaign=` has only its value replaced.
 * Otherwise `campaign=<value>` is appended with `?` when there is no query
 * string or `&` when there is one, before any `#` fragment. Every other byte,
 * percent encoding and `+` included, stays as stored.
 */
export function withCampaign(url: string, campaign: string): string {
  const hashAt = url.indexOf("#");
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeFragment = hashAt === -1 ? url : url.slice(0, hashAt);

  const queryAt = beforeFragment.indexOf("?");
  if (queryAt === -1) return `${beforeFragment}?campaign=${campaign}${fragment}`;

  const path = beforeFragment.slice(0, queryAt);
  const query = beforeFragment.slice(queryAt + 1);
  if (query === "") return `${path}?campaign=${campaign}${fragment}`;

  const existing = /(^|&)campaign=[^&]*/g;
  const next = existing.test(query)
    ? query.replace(/(^|&)campaign=[^&]*/g, (_, lead: string) => `${lead}campaign=${campaign}`)
    : `${query}&campaign=${campaign}`;
  return `${path}?${next}${fragment}`;
}
