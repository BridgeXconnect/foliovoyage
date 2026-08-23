/**
 * Provider-search fallback for missing/expired affiliate links (BRI-138 / ST-26).
 *
 * When an Experience has no matched Viator product (or a previously-matched one
 * is later flagged unhealthy by `link-health.ts`), `/go` routes here instead of
 * 404ing. Viator issues one `pid`/`mcid` pair per affiliate account, not per
 * product — every entry in `viator-links.json` already carries the same pair —
 * so the fallback reuses it directly rather than requiring a live API call.
 *
 * The exact search-URL template (`/searchResults/all?text=...`) is NOT confirmed
 * against Viator's API documentation (docs/06, docs/13 only document
 * product-detail `productUrl`s) — flagged for Roy to verify before this fallback
 * carries real attributed revenue. Only this file's internals need to change if
 * the template turns out wrong; the route/flagging logic around it does not.
 */

export interface AffiliateAccountParams {
  pid: string;
  mcid: string;
}

type LinkEntry = { affiliateUrl?: string };

/** Scans the enrichment registry for the account's static pid/mcid. */
export function extractAccountAffiliateParams(
  links: Record<string, LinkEntry>,
): AffiliateAccountParams | undefined {
  for (const entry of Object.values(links)) {
    if (!entry.affiliateUrl) continue;
    let parsed: URL;
    try {
      parsed = new URL(entry.affiliateUrl);
    } catch {
      continue;
    }
    const pid = parsed.searchParams.get("pid");
    const mcid = parsed.searchParams.get("mcid");
    if (pid && mcid) return { pid, mcid };
  }
  return undefined;
}

/** Builds a Viator search-results URL for a missing/expired/unhealthy Experience link. */
export function buildProviderSearchFallbackUrl(
  query: string,
  account?: AffiliateAccountParams,
): string {
  const url = new URL("https://www.viator.com/searchResults/all");
  url.searchParams.set("text", query);
  if (account) {
    url.searchParams.set("pid", account.pid);
    url.searchParams.set("mcid", account.mcid);
    url.searchParams.set("medium", "api");
  }
  url.searchParams.set("campaign", "affiliate-fallback");
  return url.toString();
}
