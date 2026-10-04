/**
 * `GET /go/tours/:experienceId` logic (spec 0005, AC-9 to AC-11), kept out of
 * `route.ts` because a Next route file may only export route handlers and the
 * dependencies here are injected for tests.
 */

import type { ExperiencePage } from "@folio/shared";
import links from "@/data/viator-links.json";
import { buildProviderFallbackUrl, extractAccountAffiliateParams } from "@/lib/affiliate-fallback";
import { fetchExperiencePage } from "@/lib/experience-api";
import { isViatorHost, withCampaign } from "@/lib/viator-url";

const CLICK_LOG_TIMEOUT_MS = 1500;
const CAMPAIGN = "canvas-tour";

type LinkEntry = { affiliateUrl?: string };
const registry = links as Record<string, LinkEntry>;

export type TourGoDeps = {
  fetchPage?: (experienceId: string) => Promise<ExperiencePage | null>;
  fetchImpl?: typeof fetch;
  /** Next's `after()`: lets the click POST finish once the response is sent. */
  after: (task: Promise<unknown>) => void;
  timeoutMs?: number;
};

export async function tourGo(
  request: Request,
  experienceId: string,
  deps: TourGoDeps,
): Promise<Response> {
  const fetchPage = deps.fetchPage ?? fetchExperiencePage;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CLICK_LOG_TIMEOUT_MS;

  // A malformed or unknown id is a 404 that logs nothing.
  const page = await fetchPage(experienceId);
  if (!page) return new Response("Unknown tour.", { status: 404 });

  let target: string;
  let providerId: string;
  if (isViatorHost(page.affiliateUrl)) {
    target = withCampaign(page.affiliateUrl, CAMPAIGN);
    providerId = "viator";
  } else {
    target = buildProviderFallbackUrl(page.city.slug, registry, extractAccountAffiliateParams(registry));
    providerId = "viator-search-fallback";
    console.error(
      `[go/tours] fallback event=tour_redirect_fallback experience_id=${experienceId} tour_id=${page.tourId} city=${page.city.slug}`,
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const post = postClick(
    {
      tourId: page.tourId,
      providerId,
      referrer: request.headers.get("referer") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip: forwardedFor ? forwardedFor.split(",")[0]?.trim() : undefined,
    },
    fetchImpl,
  );

  // One POST per click, never aborted. If it answers within the timeout the row
  // is written before the redirect; otherwise it finishes after the response.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), timeoutMs);
  });
  const winner = await Promise.race([post.then(() => "done" as const), slow]);
  clearTimeout(timer);
  if (winner === "slow") {
    // No server side PostHog client exists, so the slow case is a structured log line.
    console.error(
      `[go/tours] event=tour_click_log_slow experience_id=${experienceId} tour_id=${page.tourId} timeout_ms=${timeoutMs}`,
    );
    deps.after(post);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/** The single ledger POST. Never rejects: a failure goes to `console.error`. */
async function postClick(
  body: { tourId: string; providerId: string; referrer?: string; userAgent?: string; ip?: string },
  fetchImpl: typeof fetch,
): Promise<void> {
  const base = process.env.API_BASE_URL ?? "http://localhost:3001";
  const secret = process.env.INTERNAL_CLICK_SECRET ?? "dev-internal-click-secret";
  try {
    const res = await fetchImpl(`${base}/v1/affiliate-clicks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[go/tours] click log failed for ${body.tourId}: ${res.status}`);
  } catch (error) {
    console.error(`[go/tours] click log failed for ${body.tourId}:`, error);
  }
}
