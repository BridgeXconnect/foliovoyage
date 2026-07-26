import { NextResponse } from "next/server";

import links from "@/data/viator-links.json";

/**
 * `GET /go/:slug/:id` — first-party affiliate click redirect (ST-24 / BRI-136).
 *
 * Logs the click **before** it 302s to the provider deep link, so no click is
 * lost (FR-AFF-1) — even though Viator attributes commission via the `productUrl`
 * itself (docs/06). This is our own click analytics, not a Viator requirement.
 *
 * Why this lives in `apps/web` and not the API: the live CTAs and the static
 * affiliate-link registry (`viator-links.json`) are here, so `/go` resolves the
 * verbatim deep link locally, then hands the DB write to the API
 * (`POST /v1/affiliate-clicks`, which owns Prisma) over a shared internal secret.
 *
 * Safety:
 * - **No open redirect.** `:slug/:id` is only ever a key into `viator-links.json`;
 *   an unknown key 404s. We additionally require the resolved URL to be a Viator
 *   host before redirecting.
 * - **Verbatim URL.** The stored `affiliateUrl` (with `pid`/`mcid` intact) is used
 *   as the 302 target unchanged (FR-AFF-2).
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
  const entry = registry[key];

  // Unknown link or non-Viator target → 404, never an open redirect.
  if (!entry?.affiliateUrl || !isAllowedTarget(entry.affiliateUrl)) {
    return new NextResponse("Unknown affiliate link.", { status: 404 });
  }
  const target = entry.affiliateUrl;
  const provider = (entry.provider ?? "Viator").toLowerCase();

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
        providerId: provider,
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
