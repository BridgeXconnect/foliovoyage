import { NextResponse } from "next/server";

import links from "@/data/viator-links.json";
import { buildFallbackSearchUrl } from "@/lib/affiliate-fallback";
import { findExperienceDetail } from "@/lib/experience-detail";

/**
 * `GET /go/:slug/:id` — first-party affiliate click redirect (ST-24 / BRI-136),
 * extended to resolve *any* real experience, not just matched ones (ST-26 /
 * BRI-138, FR-AFF-3).
 *
 * Logs the click **before** it 302s to the outbound target, so no click is
 * lost (FR-AFF-1) — even though Viator attributes commission via the target
 * URL itself (docs/06). This is our own click analytics, not a Viator
 * requirement.
 *
 * Resolution order:
 * 1. `:slug/:id` is a matched key in `viator-links.json` → 302 to the
 *    verbatim provider deep link (with `pid`/`mcid` intact, FR-AFF-2).
 * 2. `:slug/:id` is a real experience with no match → 302 to a constructed
 *    Viator search-results page for it (`buildFallbackSearchUrl`), and the
 *    click is logged with `providerId` suffixed `-fallback` (e.g.
 *    `"viator-fallback"`) so fallback traffic is queryable in the
 *    `AffiliateClick` ledger without any schema change — this is the
 *    "flags the tour" half of BRI-138's AC.
 * 3. `:slug/:id` doesn't resolve to a real experience at all → 404. This is
 *    actually a *stronger* open-redirect guard than before: previously only
 *    the `viator-links.json` key was checked, so any garbage key not in that
 *    file 404'd by omission. Now it's checked against the real destinations
 *    dataset, and every additionally-allowed target is either a verbatim
 *    Viator deep link or a `viator.com` URL Atlas constructs itself.
 *
 * Safety:
 * - **No open redirect.** Every possible 302 target is validated against
 *   `isAllowedTarget` (a Viator host) before use, regardless of which branch
 *   produced it.
 * - **Verbatim URL for matches.** The stored `affiliateUrl` is used as the
 *   302 target unchanged.
 * - `Cache-Control: no-store` + `X-Robots-Tag: noindex` so the hop is never
 *   cached or indexed.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const INTERNAL_CLICK_SECRET =
  process.env.INTERNAL_CLICK_SECRET ?? "dev-internal-click-secret";

type LinkEntry = { affiliateUrl?: string; provider?: string };
const registry = links as Record<string, LinkEntry>;

/** Only ever redirect to the provider's own host. */
function isAllowedTarget(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("viator.com");
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<NextResponse> {
  const { slug, id } = await params;
  const key = `${slug}/${id}`;
  const registryEntry = registry[key];

  const matchedTarget =
    registryEntry?.affiliateUrl && isAllowedTarget(registryEntry.affiliateUrl)
      ? registryEntry.affiliateUrl
      : undefined;

  const detail = matchedTarget ? undefined : findExperienceDetail(slug, id);

  if (!matchedTarget && !detail) {
    // Neither a matched link nor a real experience — never an open redirect.
    return new NextResponse("Unknown affiliate link.", { status: 404 });
  }

  const isFallback = !matchedTarget;
  const target = matchedTarget ?? buildFallbackSearchUrl(detail!.experience, detail!.destination);

  if (!isAllowedTarget(target)) {
    // Defensive: buildFallbackSearchUrl always emits a viator.com URL, so
    // this only guards against a future change to that function.
    return new NextResponse("Unable to resolve an outbound link.", { status: 404 });
  }

  const providerRaw = (matchedTarget ? registryEntry?.provider : detail!.experience.provider) ?? "Viator";
  const providerId = isFallback ? `${providerRaw.toLowerCase()}-fallback` : providerRaw.toLowerCase();

  // Log the click BEFORE redirecting. The API owns the DB write. A logging
  // failure must not cost the user their booking, so we log-and-continue
  // rather than block the redirect — the happy path still writes before the
  // 302.
  const forwardedFor = request.headers.get("x-forwarded-for");
  try {
    await fetch(`${API_BASE_URL}/v1/affiliate-clicks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_CLICK_SECRET,
      },
      body: JSON.stringify({
        tourId: key,
        providerId,
        referrer: request.headers.get("referer") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip: forwardedFor ? forwardedFor.split(",")[0]?.trim() : undefined,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[go] click log failed for ${key}:`, error);
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
