import { NextResponse } from "next/server";

import links from "@/data/viator-links.json";
import healthReport from "@/data/link-health-report.json";
import { findExperienceDetail } from "@/lib/experience-detail";
import { isFlaggedUnhealthy, type LinkHealthReport } from "@/lib/link-health";
import {
  extractAccountAffiliateParams,
  buildProviderFallbackUrl,
} from "@/lib/affiliate-fallback";

/**
 * `GET /go/:slug/:id` — first-party affiliate click redirect (ST-24 / BRI-136),
 * extended with a graceful fallback (BRI-138 / ST-26).
 *
 * A key with no matched link, a non-Viator target, or a link the last
 * `check-link-health` run flagged unhealthy all fall through to a Viator
 * destination-page URL (or, if no destination ID can be derived, the bare
 * account-root URL) instead of 404ing — but ONLY when `:slug/:id` resolves to
 * a real Experience in the static content system (`findExperienceDetail`); a
 * truly unknown key still 404s, so this never becomes an open redirect for
 * arbitrary input. The fallback click is logged with `providerId:
 * "viator-search-fallback"` — a distinct, unvalidated string value (the
 * `AffiliateClick.providerId` column has no enum/allowlist) — so it's flagged
 * apart from a real direct-link click with zero schema/API changes.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const INTERNAL_CLICK_SECRET =
  process.env.INTERNAL_CLICK_SECRET ?? "dev-internal-click-secret";

type LinkEntry = { affiliateUrl?: string; provider?: string };
const registry = links as Record<string, LinkEntry>;
const report = healthReport as LinkHealthReport;

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
  const entry = registry[key];
  const directUrl = entry?.affiliateUrl;

  let target: string;
  let providerId: string;

  if (directUrl && isAllowedTarget(directUrl) && !isFlaggedUnhealthy(key, report)) {
    target = directUrl;
    providerId = (entry?.provider ?? "Viator").toLowerCase();
  } else {
    const detail = findExperienceDetail(slug, id);
    // Not a real Experience at all → never fabricate a redirect for arbitrary input.
    if (!detail) {
      return new NextResponse("Unknown affiliate link.", { status: 404 });
    }
    const account = extractAccountAffiliateParams(registry);
    target = buildProviderFallbackUrl(slug, registry, account);
    providerId = "viator-search-fallback";
  }

  // Log the click BEFORE redirecting. The API owns the DB write. A logging
  // failure must not cost the user their booking, so we log-and-continue rather
  // than block the redirect — the happy path still writes before the 302.
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
