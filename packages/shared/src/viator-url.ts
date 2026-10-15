/**
 * The one definition of "a Viator URL" (spec 0005 AC-9, spec 0006 AC-M3).
 *
 * Shared so the web app's `/go/tours/:id` and `/go/:slug/:id` routes and the
 * API's SEO slice membership rule call the same function. Pure string
 * handling. `apps/web/src/lib/viator-url.ts` re-exports it.
 */

/**
 * True for an `https` URL whose host is exactly `viator.com` or a subdomain of
 * it. `evilviator.com`, `viator.com.evil.com`, `http://` and anything that does
 * not parse are all refused, so a bad value in the database can never become an
 * open redirect.
 */
export function isViatorHost(value: string | null | undefined): value is string {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return url.hostname === "viator.com" || url.hostname.endsWith(".viator.com");
}
