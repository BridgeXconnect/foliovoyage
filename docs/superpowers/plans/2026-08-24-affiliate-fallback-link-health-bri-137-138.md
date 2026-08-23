# BRI-137 + BRI-138 — Provider-Correct Deep Links + Fallback/Link-Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out BRI-137 (ST-25 · Provider-correct deep links) with the one real gap it still has, and build BRI-138 (ST-26 · Fallback + link-health) so that no affiliate CTA — matched or unmatched — is ever a dead end, and so a link-health check exists as real, tested code ready to be scheduled later.

**Architecture:** BRI-137's routing/coming-soon/pid-mcid work already shipped in ST-17/18/BRI-136; this plan adds one regression test to prove it, then moves on. BRI-138 makes `/go/[slug]/[id]/route.ts` resolve **any** real `(destinationSlug, experienceId)` pair — not just ones present in `viator-links.json` — by falling back to a constructed Viator search-results URL when there's no matched deep link, and "flags" that fallback by tagging the existing affiliate-click ledger row (`providerId` suffixed `-fallback`) rather than adding new schema. Separately, a pure, unit-tested link-health checker pings a sample of the *matched* URLs and reports failures; it's exposed as a standalone CLI script (mirroring `fetch-viator-links.mjs`), not wired to any scheduler.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript 5.9, jest 30 + ts-jest 29 (existing `apps/web` harness), plain Node `.mjs` CLI scripts (existing `apps/web/scripts/` convention).

**Spec:** `docs/03-engineering-specification.md` ST-25/ST-26 (EP-8, M4 — Affiliate); `docs/02-system-architecture-specification.md` §"10. Affiliate Engine" (FR-AFF-2, FR-AFF-3). Linear: BRI-137, BRI-138.

## Global Constraints

- **Node 22, pnpm 11 via corepack.** Run commands from repo root unless noted.
- **Do not deploy. Do not touch Render.** Build/verify locally only (CLAUDE.md; user's explicit instruction this round).
- **No Prisma/DB schema changes.** The "flag" mechanism must reuse the existing `AffiliateClick` ledger via `providerId` tagging — no migration.
- **No cron/scheduler wiring.** The link-health checker is real, tested code; it is never invoked automatically in this plan.
- **No Linear updates.** Reporting happens outside this plan.
- **Two content systems must not be conflated** (CLAUDE.md). Everything here is the **static** system (`apps/web/src/data/destinations.ts` + `viator-links.json`) — the one the live site actually runs on.
- **Verbatim provider URLs only for matched links** (FR-AFF-2, docs/06): never rewrite, reorder, or strip `pid`/`mcid`/`medium` on a real `productUrl`. The fallback URL is a URL Atlas constructs itself (a search page, not a specific product), so this rule doesn't constrain its shape — but it must still carry the account's own `pid`/`mcid` so fallback traffic remains attributable.
- Every new pure module lives in `apps/web/src/lib/` and imports **no** `next/*` and **no** client-only modules, so ts-jest runs it in a node env with no transform of React/Next (existing project convention — see `apps/web/src/lib/experience-detail.ts`).

---

## Key Decision (read before implementing — flagged explicitly per this round's brief)

BRI-137's AC literally asks for unmatched experiences to show a **non-CTA** ("coming soon"). BRI-138's AC asks for missing/expired links to **redirect to provider search** — an actual working CTA. Applied to the same 29 currently-unmatched experiences, these describe different end states, and BRI-138 is the newer, more specific instruction (M4, same milestone, sequenced right after BRI-137).

**Decision made in this plan:** BRI-138 supersedes the interim "coming soon" state. Every experience — matched or not — gets a real, clickable CTA:
- Matched (`affiliateUrl` set) → same as today: `/go/:slug/:id` → verbatim provider deep link. Label: **"Book on {provider}"**, accent/primary styling.
- Unmatched (`affiliateUrl` unset) → **new**: `/go/:slug/:id` → constructed Viator search-results URL for that experience. Label: **"Search on {provider}"**, secondary/muted styling (visually distinct from a real booking link — this keeps the "explicit, honest state" spirit of BRI-137's AC even though it's no longer a dead `<span>`).

Consequence: the "Booking coming soon" / "Booking soon" non-CTA branches in `ExperienceRowCard`, `ExperienceDetailCta`, and `ExperienceCompareModal` become unreachable and are removed (repo convention: no dead code, per CLAUDE.md-adjacent session norms). The existing test `experienceGoHref` → `"returns undefined when there is no affiliate link"` (`apps/web/src/lib/experience-detail.spec.ts:103-106`) is replaced with a test asserting a fallback href is always returned.

If, after seeing this diff, the "coming soon" wording is preferred to stay literally dead-end for unmatched cards, that's a one-file revert of Task 5 — everything else (the `/go` fallback + flag + link-health check) stands on its own regardless.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/viator-links.spec.ts` (new) | BRI-137's missing regression test: every matched link has `pid`+`mcid`+a `viator.com` host and points at a real `(slug, id)` pair. |
| `apps/web/src/lib/affiliate-fallback.ts` (new) | Pure `buildFallbackSearchUrl(experience, destination)` — constructs a Viator search-results URL carrying the account's `pid`/`mcid`. |
| `apps/web/src/lib/affiliate-fallback.spec.ts` (new) | Unit tests for the above. |
| `apps/web/src/lib/experience-detail.ts` (modify) | `experienceGoHref` always returns a string (drops `| undefined`); doc comment updated. |
| `apps/web/src/lib/experience-detail.spec.ts` (modify) | Updates the now-stale "returns undefined" test. |
| `apps/web/src/app/go/[slug]/[id]/route.ts` (modify) | Resolves matched links as today; falls back to `buildFallbackSearchUrl` for any real-but-unmatched pair; tags the click ledger's `providerId` with `-fallback` when it does; 404 only for a pair that isn't real. |
| `apps/web/src/components/covilla/ExperienceRowCard.tsx` (modify) | Always renders a CTA; label/style branches on `Boolean(e.affiliateUrl)` instead of gating the CTA's existence. |
| `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx` (modify) | Passes a new `isLive` prop to `ExperienceDetailCta`. |
| `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/ExperienceDetailCta.tsx` (modify) | Same always-a-CTA treatment as the row card. |
| `apps/web/src/components/covilla/ExperienceCompareModal.tsx` (modify) | Same always-a-CTA treatment in the comparison table's CTA row. |
| `packages/shared/src/index.ts` (modify) | Updates `Experience.affiliateUrl`'s stale doc comment (it currently claims presence flips coming-soon↔live, which is no longer true). |
| `apps/web/src/lib/link-health.ts` (new) | Pure `checkLinkHealth(links, options)` — samples + pings matched URLs, returns per-entry ok/fail. |
| `apps/web/src/lib/link-health.spec.ts` (new) | Unit tests: success, HTTP failure, network error, timeout/abort, HEAD→GET fallback, sampling. |
| `apps/web/scripts/check-link-health.mjs` (new) | Standalone CLI mirroring `fetch-viator-links.mjs`'s conventions; runs the same algorithm as `link-health.ts` (plain JS, no TS import — see note in Task 7) against the real `viator-links.json` and prints a report. Not wired to any scheduler. |
| `apps/web/.env.example` (modify) | Documents `VIATOR_AFFILIATE_PID` / `VIATOR_AFFILIATE_MCID`. |

---

## Task 1: BRI-137's missing regression test

**Files:**
- Create: `apps/web/src/lib/viator-links.spec.ts`
- Test: same file (this task is pure test-writing against existing, unchanged code)

**Interfaces:**
- Consumes: `viatorLinks` from `apps/web/src/data/viator-links.json` (already `{ "<slug>/<experienceId>": { affiliateUrl, provider, ... } }`), `findExperienceDetail` from `apps/web/src/lib/experience-detail.ts` (`(slug: string, experienceId: string) => { destination, experience } | undefined`).
- Produces: nothing consumed by later tasks — this is a standalone regression test.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/viator-links.spec.ts
import { describe, expect, it } from "@jest/globals";
import viatorLinks from "@/data/viator-links.json";
import { findExperienceDetail } from "@/lib/experience-detail";

type LinkEntry = { affiliateUrl?: string; provider?: string };
const links = viatorLinks as Record<string, LinkEntry>;

describe("viator-links.json (BRI-137 regression)", () => {
  it("has at least one matched link (data file isn't accidentally empty)", () => {
    expect(Object.keys(links).length).toBeGreaterThan(0);
  });

  it("every entry's affiliateUrl carries pid and mcid params on a viator.com host", () => {
    for (const [key, entry] of Object.entries(links)) {
      if (!entry.affiliateUrl) throw new Error(`${key} has no affiliateUrl`);
      const url = new URL(entry.affiliateUrl);
      expect(url.hostname.endsWith("viator.com")).toBe(true);
      expect(url.searchParams.get("pid")).toBeTruthy();
      expect(url.searchParams.get("mcid")).toBeTruthy();
    }
  });

  it("every registry key resolves to a real (destination, experience) pair", () => {
    for (const key of Object.keys(links)) {
      const [slug, experienceId] = key.split("/");
      expect(findExperienceDetail(slug!, experienceId!)).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes correctly against real data**

Run: `pnpm --filter @folio/web exec jest src/lib/viator-links.spec.ts -v`
Expected: **PASS** immediately — this is a regression test over already-shipped, correct data (Step 1's audit confirmed all 19 entries already satisfy it). If it fails, that's a real, previously-undetected data problem in `viator-links.json` — stop and investigate before continuing to Task 2.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/viator-links.spec.ts
git commit -m "test(web): add BRI-137 regression coverage for viator-links.json"
```

---

## Task 2: Fallback search-URL builder

**Files:**
- Create: `apps/web/src/lib/affiliate-fallback.ts`
- Test: `apps/web/src/lib/affiliate-fallback.spec.ts`

**Interfaces:**
- Consumes: `Experience`, `Destination` types from `@folio/shared`.
- Produces: `buildFallbackSearchUrl(experience: Experience, destination: Destination): string` — consumed by Task 4 (`/go` route).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/lib/affiliate-fallback.spec.ts
import { describe, expect, it, afterEach } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import { buildFallbackSearchUrl } from "@/lib/affiliate-fallback";

const experience: Experience = {
  id: "grand-palace-wat-phra-kaew",
  title: "Grand Palace & Wat Phra Kaew Tour",
  description: "d",
  image: "https://example.test/i.jpg",
  imageAlt: "alt",
  category: "Culture & History",
  priceBand: "$$",
};

const destination: Destination = {
  slug: "bangkok",
  city: "Bangkok",
  country: "Thailand",
  tagline: "t",
  heroImage: "https://example.test/h.jpg",
  heroImageAlt: "h",
  intro: ["p"],
  knownFor: ["k"],
  bestTime: "Nov–Feb",
  fromPrice: 100,
  experiences: [],
  lat: 13.75,
  lng: 100.5,
};

describe("buildFallbackSearchUrl", () => {
  afterEach(() => {
    delete process.env.VIATOR_AFFILIATE_PID;
    delete process.env.VIATOR_AFFILIATE_MCID;
  });

  it("builds a viator.com search-results URL", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.hostname).toBe("www.viator.com");
    expect(url.pathname).toBe("/searchResults/all");
  });

  it("includes the experience title and destination city in the search text", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    const text = url.searchParams.get("text");
    expect(text).toContain("Grand Palace & Wat Phra Kaew Tour");
    expect(text).toContain("Bangkok");
  });

  it("carries the account's pid/mcid so fallback clicks stay attributable", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("pid")).toBe("P00309945");
    expect(url.searchParams.get("mcid")).toBe("42383");
  });

  it("tags the campaign so fallback traffic is distinguishable in reporting", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("campaign")).toBe("fallback-bangkok");
  });

  it("honors VIATOR_AFFILIATE_PID / VIATOR_AFFILIATE_MCID env overrides", () => {
    process.env.VIATOR_AFFILIATE_PID = "P00000001";
    process.env.VIATOR_AFFILIATE_MCID = "99999";
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("pid")).toBe("P00000001");
    expect(url.searchParams.get("mcid")).toBe("99999");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @folio/web exec jest src/lib/affiliate-fallback.spec.ts -v`
Expected: FAIL — `Cannot find module '@/lib/affiliate-fallback'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/lib/affiliate-fallback.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @folio/web exec jest src/lib/affiliate-fallback.spec.ts -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/affiliate-fallback.ts apps/web/src/lib/affiliate-fallback.spec.ts
git commit -m "feat(web): add Viator search fallback URL builder for unmatched experiences"
```

---

## Task 3: `experienceGoHref` always resolves — no more `undefined`

**Files:**
- Modify: `apps/web/src/lib/experience-detail.ts:63-68`
- Modify: `apps/web/src/lib/experience-detail.spec.ts:97-107`

**Interfaces:**
- Consumes: nothing new.
- Produces: `experienceGoHref(destinationSlug: string, experience: Experience): string` (return type changes from `string | undefined` to `string`) — consumed by Task 5 (compare modal + detail page already call this; row card will keep its own inline `goHref` construction, unchanged, since it never called this function).

- [ ] **Step 1: Update the test first**

Replace lines 97-107 of `apps/web/src/lib/experience-detail.spec.ts`:

```typescript
describe("experienceGoHref", () => {
  it("routes a live experience through /go/:slug/:id (never the raw affiliateUrl)", () => {
    const live = { ...baseExperience, id: "x1", affiliateUrl: "https://www.viator.com/tours/abc" };
    expect(experienceGoHref("bangkok", live)).toBe("/go/bangkok/x1");
  });

  it("still returns a /go href when there is no affiliate link (BRI-138 fallback lives behind /go)", () => {
    const notLive = { ...baseExperience, id: "x1", affiliateUrl: undefined };
    expect(experienceGoHref("bangkok", notLive)).toBe("/go/bangkok/x1");
  });
});
```

- [ ] **Step 2: Run test to verify the second case now fails**

Run: `pnpm --filter @folio/web exec jest src/lib/experience-detail.spec.ts -v`
Expected: FAIL on `"still returns a /go href when there is no affiliate link"` — current implementation returns `undefined`.

- [ ] **Step 3: Update the implementation**

Replace `apps/web/src/lib/experience-detail.ts:56-68`:

```typescript
/**
 * CTA href for the detail page. Always routes through the first-party
 * `/go/:slug/:id` redirect (BRI-136) — never the raw `affiliateUrl` — for
 * every real experience, whether or not it has a matched Viator product.
 * `/go` itself decides the 302 target: the verbatim deep link when matched,
 * or a constructed provider-search fallback when not (BRI-138 / ST-26,
 * FR-AFF-3) — see `apps/web/src/app/go/[slug]/[id]/route.ts`. This is
 * deliberately the same seam `ExperienceRowCard` and `ExperienceCompareModal`
 * use.
 */
export function experienceGoHref(destinationSlug: string, experience: Experience): string {
  return `/go/${destinationSlug}/${experience.id}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @folio/web exec jest src/lib/experience-detail.spec.ts -v`
Expected: PASS (all tests, including the updated `experienceGoHref` pair)

- [ ] **Step 5: Typecheck** (return-type change may surface call-site errors before Task 5 fixes them — expected, confirm the errors are exactly the two known call sites)

Run: `pnpm --filter @folio/web typecheck`
Expected: no errors from `experience-detail.ts` itself; `ExperienceCompareModal.tsx` and the detail `page.tsx` may now show unused-optional-narrowing warnings if any — note them, Task 5 addresses the UI.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/experience-detail.ts apps/web/src/lib/experience-detail.spec.ts
git commit -m "feat(web): experienceGoHref always resolves to /go (fallback lives server-side)"
```

---

## Task 4: `/go` route resolves any real experience, flags fallback clicks

**Files:**
- Modify: `apps/web/src/app/go/[slug]/[id]/route.ts`

**Interfaces:**
- Consumes: `buildFallbackSearchUrl` from `@/lib/affiliate-fallback` (Task 2), `findExperienceDetail` from `@/lib/experience-detail` (existing, `(slug, id) => { destination, experience } | undefined`).
- Produces: no new exports — this is the terminal consumer for this plan's "flag" mechanism (tags `providerId` with a `-fallback` suffix in the `POST /v1/affiliate-clicks` body it already sends).

- [ ] **Step 1: Replace the route handler**

This route is a Next.js route handler (uses `NextResponse`, runs under the Next runtime) — it is not unit-testable under the existing ts-jest config (no next runtime; the existing route has no spec file today for the same reason). Verification for this task is the manual dev-server check in Step 2, plus the unit coverage already on `buildFallbackSearchUrl` (Task 2) and `findExperienceDetail` (pre-existing).

Replace the full body of `apps/web/src/app/go/[slug]/[id]/route.ts`:

```typescript
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

  const providerRaw = (
    matchedTarget ? registryEntry?.provider : detail!.experience.provider
  ) ?? "Viator";
  const providerId = isFallback
    ? `${providerRaw.toLowerCase()}-fallback`
    : providerRaw.toLowerCase();

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
```

- [ ] **Step 2: Manual verification against the dev server**

Run: `pnpm --filter @folio/web dev` (in one terminal), then from another:

```bash
# Matched key — expect 302 to the real Viator productUrl (unchanged behavior)
curl -sI http://localhost:3000/go/bangkok/grand-palace-wat-phra-kaew | grep -i location

# Real but unmatched key — expect 302 to a viator.com/searchResults/all URL
# (pick any experience id from destinations.ts NOT present in viator-links.json,
# e.g. check `apps/web/src/data/destinations.ts` for a bangkok id absent from
# `apps/web/src/data/viator-links.json`'s "bangkok/..." keys)
curl -sI http://localhost:3000/go/bangkok/<an-unmatched-id> | grep -i location

# Garbage key — expect 404
curl -sI http://localhost:3000/go/bangkok/does-not-exist
```

Expected: first two return `302` with a `Location: https://www.viator.com/...` header (the second one's path is `/searchResults/all`, not `/tours/...`); the third returns `404`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/go/[slug]/[id]/route.ts
git commit -m "feat(web): /go falls back to provider search + flags the click for unmatched experiences"
```

---

## Task 5: UI — every experience gets a real CTA

**Files:**
- Modify: `apps/web/src/components/covilla/ExperienceRowCard.tsx`
- Modify: `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx`
- Modify: `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/ExperienceDetailCta.tsx`
- Modify: `apps/web/src/components/covilla/ExperienceCompareModal.tsx`
- Modify: `packages/shared/src/index.ts` (doc comment only)

**Interfaces:**
- Consumes: `experienceGoHref` (Task 3, now always returns `string`).
- Produces: no new exports; this is UI-only.

- [ ] **Step 1: Update the stale doc comment on `Experience.affiliateUrl`**

In `packages/shared/src/index.ts`, replace the comment above `affiliateUrl?: string;` (currently lines 44-48):

```typescript
  /**
   * When an affiliate program is approved, set this to the deep link and
   * optionally `provider`. Presence determines the CTA's outbound target and
   * label: set → a live "Book on {provider}" link to the matched product;
   * unset → a "Search on {provider}" link to a constructed provider-search
   * fallback (BRI-138 / ST-26). Both routes exist for every experience — see
   * `apps/web/src/app/go/[slug]/[id]/route.ts`.
   */
```

- [ ] **Step 2: `ExperienceRowCard` — always render a CTA**

In `apps/web/src/components/covilla/ExperienceRowCard.tsx`, replace lines 43-48:

```typescript
  const live = Boolean(e.affiliateUrl);
  const hasPrice = typeof e.fromPrice === "number" && e.fromPrice > 0;
  const hasRating = typeof e.rating === "number" && e.rating > 0;
  // Route the click through /go (log-before-redirect); the raw deep link (or
  // the BRI-138 fallback search page, for an unmatched experience) is the
  // 302 target resolved server-side, never the clicked href.
  const goHref = `/go/${destination.slug}/${e.id}`;
```

Then replace the CTA block, lines 138-168:

```typescript
          <a
            href={goHref}
            target="_blank"
            rel="sponsored nofollow noopener"
            onClick={() =>
              trackAffiliateClick({
                experienceId: e.id,
                title: e.title,
                provider: e.provider,
                category: e.category,
                priceBand: e.priceBand,
                hasRating: typeof e.rating === "number",
                freeCancel: Boolean(e.freeCancel),
                city: destination.city,
                country: destination.country,
                destinationSlug: destination.slug,
              })
            }
            className={
              live
                ? "inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
                : "inline-flex items-center gap-1.5 rounded-[2px] border border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-ink hover:text-ink"
            }
          >
            {live ? `Book on ${e.provider}` : `Search on ${e.provider ?? "Viator"}`}{" "}
            <ArrowUpRight size={14} />
          </a>
```

Also update the file's top doc comment (lines 10-24) to drop the "otherwise a clearly non-functional 'Booking coming soon' state" line — replace with:

```typescript
/**
 * Horizontal experience card in the Covilla "vacation" style (image left,
 * details right) for the destination page's right column. The booking CTA
 * always routes through the first-party `/go/:slug/:id` redirect (BRI-136):
 * a matched experience gets an accent "Book on {provider}" link to the real
 * product; an unmatched one gets a secondary "Search on {provider}" link to
 * a provider-search fallback (BRI-138 / ST-26) — never a dead end.
 *
 * When a card is matched to a real Viator product (BRI-168) it surfaces the
 * provider's commerce signals — "from" price, aggregate rating, free-cancellation
 * — as additive badges. These never replace the editorial `title`/`description`
 * ("match, don't overwrite", docs/07); an unmatched card renders exactly as before
 * apart from the CTA.
 */
```

- [ ] **Step 3: `ExperienceDetailCta` — same treatment, with an `isLive` prop**

In `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx`, find the line calling `<ExperienceDetailCta`:

```typescript
<ExperienceDetailCta goHref={goHref} provider={e.provider} clickInput={clickInput} />
```

Replace with:

```typescript
<ExperienceDetailCta
  goHref={goHref}
  isLive={Boolean(e.affiliateUrl)}
  provider={e.provider}
  clickInput={clickInput}
/>
```

Replace the full contents of `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/ExperienceDetailCta.tsx`:

```typescript
"use client";

import { ArrowUpRight } from "lucide-react";
import { trackAffiliateClick, type AffiliateClickInput } from "@/lib/analytics";

/**
 * Detail-page booking CTA. Mirrors ExperienceRowCard's affiliate seam: a
 * matched experience gets an accent "Book on {provider}" link; an unmatched
 * one gets a secondary "Search on {provider}" link to a provider-search
 * fallback (BRI-138 / ST-26) — never a dead end. Both route through `/go`
 * (`goHref`, resolved server-side by `experienceGoHref`); this component only
 * renders + fires the click event.
 */
export function ExperienceDetailCta({
  goHref,
  isLive,
  provider,
  clickInput,
}: {
  goHref: string;
  isLive: boolean;
  provider?: string;
  clickInput: AffiliateClickInput;
}) {
  return (
    <a
      href={goHref}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={() => trackAffiliateClick(clickInput)}
      className={
        isLive
          ? "inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
          : "inline-flex items-center gap-1.5 rounded-[2px] border border-line px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-ink hover:text-ink"
      }
    >
      {isLive ? `Book on ${provider ?? "Viator"}` : `Search on ${provider ?? "Viator"}`}{" "}
      <ArrowUpRight size={15} />
    </a>
  );
}
```

- [ ] **Step 4: `ExperienceCompareModal` — same treatment in the CTA row**

In `apps/web/src/components/covilla/ExperienceCompareModal.tsx`, replace the CTA-row `<td>` block (lines 168-186):

```typescript
                {model.tours.map((t) => {
                  const e = byId.get(t.id)!;
                  const isLive = Boolean(e.affiliateUrl);
                  const goHref = experienceGoHref(destination.slug, e);
                  const clickInput = experienceDetailAffiliateInput(destination, e);
                  return (
                    <td key={t.id} className="px-3 py-4">
                      <a
                        href={goHref}
                        target="_blank"
                        rel="sponsored nofollow noopener"
                        onClick={() => trackAffiliateClick(clickInput)}
                        className={
                          isLive
                            ? "inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white"
                            : "inline-flex items-center gap-1.5 rounded-[2px] border border-line px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:border-ink hover:text-ink"
                        }
                      >
                        {isLive ? `Book on ${e.provider ?? "Viator"}` : `Search on ${e.provider ?? "Viator"}`}{" "}
                        <ArrowUpRight size={13} />
                      </a>
                    </td>
                  );
                })}
```

Also update the file's top doc comment (line 21) — replace "Facts a tour lacks render as '—'" paragraph's CTA sentence to note the fallback:

```typescript
 * tour lacks render as "—" (honest absence — see plan Findings §I/§II). Each
 * column's booking CTA reuses ST-17's `/go` seam and the shared
 * `trackAffiliateClick` payload: a matched tour gets a live booking link, an
 * unmatched one a provider-search fallback (BRI-138 / ST-26) — no new link
 * logic, no dead-end CTA.
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: no errors. This confirms `ExperienceDetailCta`'s now-required `goHref`/`isLive` props are satisfied at its one call site, and no other caller of `experienceGoHref` still expects `undefined`.

- [ ] **Step 6: Run the full web jest suite**

Run: `pnpm --filter @folio/web test`
Expected: PASS — including the Task 1/2/3 specs and the pre-existing `experience-compare.spec.ts` / `experience-detail-seo.spec.ts` (neither touches CTA rendering, so they should be unaffected).

- [ ] **Step 7: Manual visual check (dev server)**

Run: `pnpm --filter @folio/web dev`, open `http://localhost:3000/destinations/bangkok` in a browser.
Expected: every experience card shows a CTA button — accent-colored "Book on Viator" for matched ones, muted-outline "Search on Viator" for unmatched ones — and no card shows a disabled "Booking soon" span. Click one of each kind and confirm it opens a new tab that lands on Viator (a product page for a matched one, a search-results page for an unmatched one).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/covilla/ExperienceRowCard.tsx \
        apps/web/src/app/destinations/\[slug\]/experiences/\[experienceId\]/page.tsx \
        apps/web/src/app/destinations/\[slug\]/experiences/\[experienceId\]/ExperienceDetailCta.tsx \
        apps/web/src/components/covilla/ExperienceCompareModal.tsx \
        packages/shared/src/index.ts
git commit -m "feat(web): replace dead-end 'coming soon' CTAs with a provider-search fallback"
```

---

## Task 6: Link-health checker (pure, unit-tested)

**Files:**
- Create: `apps/web/src/lib/link-health.ts`
- Test: `apps/web/src/lib/link-health.spec.ts`

**Interfaces:**
- Consumes: nothing project-specific — takes a `Record<string, { affiliateUrl?: string }>` (the same shape as `viator-links.json`) and an injectable `fetch`.
- Produces: `checkLinkHealth(links, options?): Promise<LinkHealthResult[]>` — consumed by Task 7's CLI script (reimplemented there in plain JS, not imported — see Task 7's note) and available for a future scheduler to call directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/lib/link-health.spec.ts
import { describe, expect, it, jest } from "@jest/globals";
import { checkLinkHealth } from "@/lib/link-health";

function fakeFetch(
  responder: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>,
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const { ok, status } = await responder(url, init);
    return { ok, status } as Response;
  }) as typeof fetch;
}

describe("checkLinkHealth", () => {
  it("reports ok:true for a link that responds 200", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: true, status: 200 },
    ]);
  });

  it("reports ok:false with the status for a 404", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: false, status: 404 }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: false, status: 404 },
    ]);
  });

  it("reports ok:false with an error message on a network failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      {
        key: "bangkok/a",
        url: "https://www.viator.com/tours/a",
        ok: false,
        error: "getaddrinfo ENOTFOUND",
      },
    ]);
  });

  it("retries with GET when HEAD isn't allowed (405)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "HEAD") return { ok: false, status: 405 } as Response;
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(calls).toEqual(["HEAD", "GET"]);
    expect(results[0]).toMatchObject({ ok: true, status: 200 });
  });

  it("skips entries with no affiliateUrl", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const results = await checkLinkHealth(
      { "bangkok/unmatched": {}, "bangkok/matched": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe("bangkok/matched");
  });

  it("pings only sampleSize entries when the registry is larger", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const links = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`d/${i}`, { affiliateUrl: `https://www.viator.com/tours/${i}` }]),
    );
    let call = 0;
    const random = () => {
      // Deterministic sequence so the test doesn't depend on Math.random.
      const seq = [0.9, 0.1];
      return seq[call++ % seq.length]!;
    };
    const results = await checkLinkHealth(links, { fetchImpl, sampleSize: 2, random });
    expect(results).toHaveLength(2);
    const keys = new Set(results.map((r) => r.key));
    expect(keys.size).toBe(2);
  });

  it("times out a hung request and reports it as a failure", async () => {
    jest.useFakeTimers();
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as unknown as typeof fetch;

    const promise = checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl, timeoutMs: 5000 },
    );
    await jest.advanceTimersByTimeAsync(5000);
    const results = await promise;

    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toMatch(/abort/i);
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @folio/web exec jest src/lib/link-health.spec.ts -v`
Expected: FAIL — `Cannot find module '@/lib/link-health'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/lib/link-health.ts
/**
 * Link-health checker for matched Viator affiliate links (BRI-138 / ST-26,
 * FR-AFF-3: "a scheduled job pings a sample and flags failures in a
 * report"). This module is the pure, testable core; it is NOT wired to any
 * scheduler here — Render is currently suspended and scheduling is
 * deliberately deferred. `apps/web/scripts/check-link-health.mjs` runs the
 * same algorithm as a manually-invoked CLI, ready for a future cron (Vercel
 * Cron, a GitHub Action, or the API's `ImportScheduler` pattern) to call.
 */

export interface LinkHealthResult {
  /** Registry key, e.g. "bangkok/grand-palace-wat-phra-kaew". */
  key: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface CheckLinkHealthOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Ping at most this many entries (a random subset). Default: all. */
  sampleSize?: number;
  /** Per-request timeout before treating a link as failed. Default: 8000ms. */
  timeoutMs?: number;
  /** Injectable RNG for deterministic sampling in tests. Default: Math.random. */
  random?: () => number;
}

interface Entry {
  key: string;
  url: string;
}

/** Pings a sample of `links`' matched `affiliateUrl`s and reports failures. */
export async function checkLinkHealth(
  links: Record<string, { affiliateUrl?: string }>,
  options: CheckLinkHealthOptions = {},
): Promise<LinkHealthResult[]> {
  const { fetchImpl = fetch, sampleSize, timeoutMs = 8000, random = Math.random } = options;

  const entries: Entry[] = Object.entries(links)
    .filter((pair): pair is [string, { affiliateUrl: string }] => Boolean(pair[1]?.affiliateUrl))
    .map(([key, value]) => ({ key, url: value.affiliateUrl! }));

  const sample = sampleEntries(entries, sampleSize, random);

  return Promise.all(sample.map((entry) => pingOne(entry, fetchImpl, timeoutMs)));
}

/** Picks `sampleSize` entries at random (or all of them if unset/too large). */
function sampleEntries(entries: Entry[], sampleSize: number | undefined, random: () => number): Entry[] {
  if (sampleSize === undefined || sampleSize >= entries.length) return entries;
  const pool = [...entries];
  const picked: Entry[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** HEAD first (cheaper); falls back to GET if the server rejects HEAD. */
async function pingOne(entry: Entry, fetchImpl: typeof fetch, timeoutMs: number): Promise<LinkHealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(entry.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(entry.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    }
    return { key: entry.key, url: entry.url, ok: response.ok, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { key: entry.key, url: entry.url, ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @folio/web exec jest src/lib/link-health.spec.ts -v`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/link-health.ts apps/web/src/lib/link-health.spec.ts
git commit -m "feat(web): add pure link-health checker for matched affiliate URLs"
```

---

## Task 7: Standalone link-health CLI script

**Files:**
- Create: `apps/web/scripts/check-link-health.mjs`

**Interfaces:**
- Consumes: `apps/web/src/data/viator-links.json` directly (read via `fs`).
- Produces: a printed report; no exports consumed elsewhere.

**Note on why this duplicates Task 6's logic instead of importing it:** `apps/web/scripts/*.mjs` are plain Node scripts run directly (`node scripts/....mjs`), the same way `fetch-viator-links.mjs` already works — none of them import TypeScript from `src/`, because that would need a TS runtime loader (`tsx`/`ts-node`) that isn't a dependency here today. Adding one is a real option but a separate decision (new dependency, new run path) — out of scope for this plan. This script therefore reimplements the same small algorithm as `link-health.ts` in plain JS; `link-health.ts` stays the unit-tested source of truth for the logic, and this script is verified manually (Step 2), matching `fetch-viator-links.mjs`'s existing bar (which also has no test file).

- [ ] **Step 1: Write the script**

```javascript
// apps/web/scripts/check-link-health.mjs
// Pings a sample of the matched Viator affiliate links in viator-links.json
// and prints a pass/fail report (BRI-138 / ST-26, FR-AFF-3: "a scheduled job
// pings a sample and flags failures in a report").
//
// This is a manually-invoked CLI, mirroring fetch-viator-links.mjs's
// conventions. It is deliberately NOT wired to a cron/scheduler — that's
// left for when Render is back. The algorithm matches
// apps/web/src/lib/link-health.ts (unit-tested); this file duplicates it in
// plain JS since scripts here don't import TypeScript from src/ (see the
// plan note in Task 7 for why).
//
// Usage:
//   From apps/web/:  node scripts/check-link-health.mjs
//   Sample size:     SAMPLE_SIZE=5 node scripts/check-link-health.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const linksPath = join(__dirname, "..", "src", "data", "viator-links.json");
const links = JSON.parse(readFileSync(linksPath, "utf8"));

const TIMEOUT_MS = 8000;
const sampleSize = process.env.SAMPLE_SIZE ? Number(process.env.SAMPLE_SIZE) : undefined;

function sampleEntries(entries, size) {
  if (size === undefined || size >= entries.length) return entries;
  const pool = [...entries];
  const picked = [];
  for (let i = 0; i < size; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

async function pingOne({ key, url }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { key, url, ok: response.ok, status: response.status };
  } catch (error) {
    return { key, url, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const entries = Object.entries(links)
    .filter(([, v]) => Boolean(v?.affiliateUrl))
    .map(([key, v]) => ({ key, url: v.affiliateUrl }));

  const sample = sampleEntries(entries, sampleSize);
  console.log(`Checking ${sample.length} of ${entries.length} matched links...\n`);

  const results = await Promise.all(sample.map(pingOne));
  const failures = results.filter((r) => !r.ok);

  for (const r of results) {
    const status = r.ok ? `OK (${r.status})` : `FAIL (${r.status ?? r.error})`;
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.key} — ${status}`);
  }

  console.log(`\n${results.length - failures.length}/${results.length} healthy.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    console.log(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
}

main();
```

- [ ] **Step 2: Manual verification**

Run (from `apps/web/`): `node scripts/check-link-health.mjs`
Expected: prints a per-link OK/FAIL line for all 19 matched links, a summary count, and exits `0` (or `1` with a JSON failure list, if a real link happens to be dead — either is a correct result, not a bug). Also try `SAMPLE_SIZE=5 node scripts/check-link-health.mjs` and confirm only 5 are checked.

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/check-link-health.mjs
git commit -m "feat(web): add manually-invoked link-health CLI (not scheduled)"
```

---

## Task 8: Document the new env vars

**Files:**
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Add the new section**

Append to `apps/web/.env.example`, after the existing `VIATOR_API_KEY` block:

```bash
# Viator affiliate account identifiers, used to build the BRI-138 fallback
# search-results link for experiences with no matched product. SERVER-SIDE
# ONLY. These are not secrets — the same values already appear verbatim in
# every matched src/data/viator-links.json entry's affiliateUrl — but are
# overridable here for a different Viator partner account without a code
# change. Defaults (used when unset) match the account already live in
# viator-links.json.
VIATOR_AFFILIATE_PID=P00309945
VIATOR_AFFILIATE_MCID=42383
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/.env.example
git commit -m "docs(web): document VIATOR_AFFILIATE_PID/MCID fallback env vars"
```

---

## Task 9: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full monorepo typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean across all workspaces.

- [ ] **Step 2: Full test suite**

Run: `pnpm --filter @folio/web test && pnpm --filter @folio/api test`
Expected: PASS. (The API suite isn't touched by this plan — this just confirms no regression from the `packages/shared` doc-comment-only change.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: succeeds for `apps/web` (confirms the route handler and all edited components compile under `next build`, including RSC boundaries).

- [ ] **Step 4: Re-run the manual dev-server checks from Tasks 4 and 5**

Confirm once more against a running `pnpm --filter @folio/web dev`: matched-link redirect, unmatched-link fallback redirect, garbage-key 404, and the visual check of both CTA styles on `/destinations/bangkok`.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "BRI-137/138: close provider-correct deep links, add fallback + link-health" --body "$(cat <<'EOF'
## Summary
- BRI-137 (ST-25): adds the one missing regression test proving every matched
  affiliate link carries pid/mcid on a viator.com host and resolves to a real
  experience — the routing/coming-soon work was already shipped in ST-17/18/BRI-136.
- BRI-138 (ST-26): `/go/:slug/:id` now resolves every real experience, not
  just matched ones — unmatched experiences fall back to a constructed Viator
  search-results link (still carrying the account's pid/mcid) instead of a
  dead "coming soon" state. Fallback clicks are flagged in the existing
  `AffiliateClick` ledger via a `-fallback` providerId suffix — no schema
  change. A pure, unit-tested link-health checker (`link-health.ts` +
  `check-link-health.mjs`) pings a sample of matched links and reports
  failures; it is NOT wired to any scheduler (Render is suspended).

## Test plan
- [x] `pnpm typecheck && pnpm lint` clean
- [x] `pnpm --filter @folio/web test` — new specs (viator-links, affiliate-fallback,
      link-health, updated experience-detail) all pass
- [x] `pnpm build` succeeds
- [x] Manual: `/go/bangkok/grand-palace-wat-phra-kaew` → 302 to real Viator product
- [x] Manual: `/go/bangkok/<unmatched-id>` → 302 to Viator search results
- [x] Manual: `/go/bangkok/does-not-exist` → 404
- [x] Manual: `/destinations/bangkok` shows both CTA styles, no dead-end cards
- [x] Manual: `node scripts/check-link-health.mjs` reports on all 19 matched links

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** BRI-137's three ACs — verbatim URL ✓ (unchanged, Task 1 proves it), coming-soon state ✓→superseded by design (Key Decision, Task 5), pid/mcid present ✓ (Task 1). BRI-138's two ACs — fallback + flag ✓ (Tasks 2–5), scheduled-job-shaped health check ✓ minus the actual scheduling (explicitly deferred per this round's brief, Task 6–7).
- **Placeholder scan:** no TBD/TODO; every step has real, complete code.
- **Type consistency:** `experienceGoHref` return type (`string`, Task 3) matches its one remaining direct caller (`ExperienceCompareModal`, Task 5) and the detail `page.tsx` call site; `ExperienceDetailCta`'s new `isLive: boolean` prop is supplied at its only call site in the same task. `checkLinkHealth`'s `LinkHealthResult` shape (Task 6) is self-contained (no downstream TS consumer — Task 7's script is intentionally a separate plain-JS implementation, noted explicitly).
- **Known open call for Roy:** the Key Decision section above (removing "coming soon" in favor of a labeled fallback CTA) is the one thing in this plan that reverses part of BRI-137's literal AC wording. Everything else is additive.
