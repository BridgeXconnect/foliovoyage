/**
 * Provider fallback for missing/expired affiliate links (BRI-138 / ST-26,
 * corrected per Roy's follow-up research against Viator's own partner docs).
 *
 * When an Experience has no matched Viator product (or a previously-matched one
 * is later flagged unhealthy by `link-health.ts`), `/go` routes here instead of
 * 404ing. Viator issues one `pid`/`mcid` pair per affiliate account, not per
 * product — every entry in `viator-links.json` already carries the same pair —
 * so the fallback reuses it directly rather than requiring a live API call.
 *
 * Two things about the original BRI-138 implementation were wrong, confirmed
 * against Viator partner-resource docs (not assumption):
 *  - `medium=api` is only for URLs the content API returns verbatim (the real
 *    `productUrl`s already in `viator-links.json`). Viator's own worked example
 *    for a manually-constructed link uses `medium=link`
 *    (partnerresources.viator.com/travel-commerce/affiliate/attribution/:
 *    "https://www.viator.com?pid=P00049694&mcid=12345&medium=link&campaign=example").
 *  - `/searchResults/all?text=...` was never a documented deep-link target.
 *    Destination pages are: partnerresources.viator.com's link-creation guide
 *    names `viator.com/Bali/d98-ttd` as an example, and a live example page
 *    confirms the full pattern with tracking params —
 *    `https://www.viator.com/New-York-City/d687-ttd?pid=...&mcid=42383&medium=link`.
 *
 * So the fallback now targets the Experience's own destination page
 * (`/<City>/d<id>-ttd`), with the destination ID parsed from an existing
 * matched `productUrl` for that same destination in `viator-links.json` — never
 * hardcoded. If a destination has zero matched products (so no ID can be
 * derived), it falls through one more tier to the bare account-root URL, which
 * is Viator's exact documented example above — guaranteeing every fallback path
 * lands on something explicitly confirmed safe, never an unconfirmed guess.
 */

export interface AffiliateAccountParams {
  pid: string;
  mcid: string;
}

export interface DestinationPageParams {
  citySlug: string;
  destinationId: string;
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

/**
 * Parses a real Viator `productUrl` (`.../tours/<City>/<name>/d<id>-<code>`)
 * for the city slug + destination ID its destination page would use.
 */
function parseDestinationPageParams(affiliateUrl: string): DestinationPageParams | undefined {
  let parsed: URL;
  try {
    parsed = new URL(affiliateUrl);
  } catch {
    return undefined;
  }
  const match = parsed.pathname.match(/^\/tours\/([^/]+)\/[^/]+\/d(\d+)-/);
  if (!match) return undefined;
  return { citySlug: match[1], destinationId: match[2] };
}

/**
 * Finds destination-page params by scanning the registry for a matched
 * product under the given destination slug (e.g. "bali" for keys like
 * "bali/tanah-lot"). Returns undefined if that destination has no matched
 * product to derive a real destination ID from.
 */
export function extractDestinationPageParams(
  links: Record<string, LinkEntry>,
  destinationSlug: string,
): DestinationPageParams | undefined {
  const prefix = `${destinationSlug}/`;
  for (const [key, entry] of Object.entries(links)) {
    if (!key.startsWith(prefix) || !entry.affiliateUrl) continue;
    const params = parseDestinationPageParams(entry.affiliateUrl);
    if (params) return params;
  }
  return undefined;
}

/** Builds Viator's documented bare account-root fallback URL (`medium=link`). */
export function buildAccountRootFallbackUrl(account?: AffiliateAccountParams): string {
  const url = new URL("https://www.viator.com");
  if (account) {
    url.searchParams.set("pid", account.pid);
    url.searchParams.set("mcid", account.mcid);
    url.searchParams.set("medium", "link");
  }
  url.searchParams.set("campaign", "affiliate-fallback");
  return url.toString();
}

/**
 * Builds the fallback URL for a missing/expired/unhealthy Experience link:
 * the destination page for `destinationSlug` when a destination ID can be
 * derived from an existing matched product, else the account-root fallback.
 */
export function buildProviderFallbackUrl(
  destinationSlug: string,
  links: Record<string, LinkEntry>,
  account?: AffiliateAccountParams,
): string {
  const dest = extractDestinationPageParams(links, destinationSlug);
  if (!dest) return buildAccountRootFallbackUrl(account);

  const url = new URL(`https://www.viator.com/${dest.citySlug}/d${dest.destinationId}-ttd`);
  if (account) {
    url.searchParams.set("pid", account.pid);
    url.searchParams.set("mcid", account.mcid);
    url.searchParams.set("medium", "link");
  }
  url.searchParams.set("campaign", "affiliate-fallback");
  return url.toString();
}
