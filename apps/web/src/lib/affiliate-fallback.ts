/**
 * Fallback affiliate link for experiences with no matched Viator product
 * (BRI-138 / ST-26, FR-AFF-3). Rather than a dead end, an unmatched
 * experience's CTA routes to a Viator search-results page for that
 * experience, carrying the account's own `pid`/`mcid` so the click still
 * attributes to Atlas even though it isn't a specific product deep link.
 *
 * The pid/mcid defaults below are the same account identifiers already
 * shipped verbatim in every matched `viator-links.json` entry (not secret —
 * they appear in plain outbound URLs today). Override via env for a
 * different Viator partner account without a code change.
 */
import type { Destination, Experience } from "@folio/shared";

const DEFAULT_PID = "P00309945";
const DEFAULT_MCID = "42383";

function affiliatePid(): string {
  return process.env.VIATOR_AFFILIATE_PID ?? DEFAULT_PID;
}

function affiliateMcid(): string {
  return process.env.VIATOR_AFFILIATE_MCID ?? DEFAULT_MCID;
}

/** A Viator search-results URL for `experience`, scoped by destination city. */
export function buildFallbackSearchUrl(experience: Experience, destination: Destination): string {
  const params = new URLSearchParams({
    text: `${experience.title} ${destination.city}`,
    pid: affiliatePid(),
    mcid: affiliateMcid(),
    medium: "api",
    api_version: "2.0",
    campaign: `fallback-${destination.slug}`,
  });
  return `https://www.viator.com/searchResults/all?${params.toString()}`;
}
