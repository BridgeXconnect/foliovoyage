# BRI-137 + BRI-138 — Affiliate Fallback & Link-Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close BRI-138's real gap — the `/go/:slug/:id` redirect currently 404s for any experience without a matched Viator link (or one later flagged unhealthy) instead of degrading gracefully — by adding a provider-search fallback (flagged in the click log) and a real, tested link-health checker; and record that BRI-137's acceptance criteria are already satisfied by existing code, with no BRI-137 code changes needed.

**Architecture:** Two new pure, unit-tested `apps/web/src/lib/*.ts` modules — `affiliate-fallback.ts` (builds a provider-search URL, reusing the account's existing static `pid`/`mcid`) and `link-health.ts` (samples a subset of live `productUrl`s, pings them via an injected function, and classifies pass/fail) — plumbed into the existing `/go/:slug/:id` route handler exactly where it currently 404s. A companion CLI (`apps/web/scripts/check-link-health.ts`, run via `ts-node`, mirroring `apps/api`'s existing `trigger-import.cli.ts` pattern) does the real network pinging and writes `apps/web/src/data/link-health-report.json`, which the route reads (statically imported, same as `viator-links.json`) to also fall back on previously-flagged-unhealthy links. No cron/scheduler is registered — the CLI is callable today, schedulable later, exactly as instructed.

**Tech Stack:** Next.js 15 (App Router route handler), TypeScript 5.9, jest 30 + ts-jest 29 (existing `apps/web` harness), `ts-node` (new devDependency, mirroring `apps/api`'s existing use for `trigger-import.cli.ts`).

**Spec:** `docs/03-engineering-specification.md` ST-25/ST-26 (EP-8/M4), traced to `docs/02-system-architecture-specification.md` FR-AFF-2/FR-AFF-3. Linear: BRI-137 ("ST-25 · Provider-correct deep links"), BRI-138 ("ST-26 · Fallback + link-health"). BRI-137 AC verbatim: _"Every published CTA resolves to a valid Viator product URL with affiliate params. Unmatched experiences show explicit non-CTA / coming-soon state. Outbound URL is verbatim provider URL."_ BRI-138 AC verbatim: _"Missing/expired affiliate_url redirects to provider search for the Experience and flags the tour. A scheduled job pings a sample and flags failures in a report."_

## Global Constraints

- **Node 22, pnpm 11 via corepack.** Run commands from repo root unless noted.
- **Do not deploy.** Build/verify locally only (CLAUDE.md; no Render/Vercel triggers).
- **Do not wire an actual cron/scheduled job.** Render is suspended; the health-check CLI must be real and callable, but no scheduler registration.
- **Do not touch Linear.** Roy updates BRI-137/138 himself after this report.
- **Two content systems must not be conflated** (CLAUDE.md). This work is entirely in the **static** content system (`destinations.ts` + `viator-links.json` + `/go`) — the DB ingest pipeline in `apps/api` is untouched.
- **No fake data / no fabricated attribution.** The fallback URL only carries `pid`/`mcid` when they can be read from real data (`viator-links.json`); it never hardcodes them.
- Every new pure module lives in `apps/web/src/lib/`, imports no `next/*`, and is unit-tested with jest — matching the ST-17/18 precedent (RSC/route-handler code itself is verified by `next build` + manual `/go` checks, not jest, since `Request`/`NextResponse` aren't polyfilled in the node-env jest harness).

---

## Key Findings (read before implementing)

### §1 — BRI-137 is already satisfied; no code change needed
All three live CTA surfaces — `ExperienceRowCard` (destination pages), `ExperienceDetailCta` (detail pages), `ExperienceCompareModal` (compare) — already route through `/go/:slug/:id`, never the raw `affiliateUrl`, and already render an explicit disabled "Booking coming soon"/"Booking soon" state when unmatched. `pid`/`mcid` are present on all 19/48 matched entries in `viator-links.json` (verified programmatically: `pid=P00309945`, `mcid=42383`, constant across every entry — these are per-account values, not per-product). The 19/48 split is unchanged. Two other components — `apps/web/src/components/ExperienceCard.tsx` and `DbExperienceCard.tsx` — still link to the raw `affiliateUrl`, but both are confirmed dead code (zero importers / only reachable via a route that 308-redirects and renders nothing), so they don't violate BRI-137's AC on any live surface. This plan makes **no changes** for BRI-137; Task 5 documents this finding in the final report so Roy can close the ticket.

### §2 — The real gap is `/go`'s blunt 404
`apps/web/src/app/go/[slug]/[id]/route.ts` returns a bare 404 for any `:slug/:id` not in `viator-links.json`, or whose stored URL isn't on a `viator.com` host. There is no fallback path and no link-health code anywhere in the repo today.

### §3 — The account's `pid`/`mcid` are static, so a fallback URL needs no live API call
Every entry in `viator-links.json` carries the same `pid=P00309945&mcid=42383` (verified programmatically). A fallback search URL can reuse these directly from the already-loaded registry — no new Viator credentials or API calls needed to attribute the fallback click.

### §4 — "Flagging" the fallback needs zero schema/API changes
`AffiliateClick.providerId` (Prisma) is stored and validated as a **plain string** end-to-end — `affiliate.controller.ts`'s DTO has no enum/allowlist. A fallback click can be flagged for free by posting a distinct `providerId` (`"viator-search-fallback"`) through the exact same `/go` → `POST /v1/affiliate-clicks` path already in use. No apps/api change is needed.

### §5 — Provider-search URL format is an assumption, flagged for Roy
Neither `docs/06` nor `docs/13` documents a Viator search-results URL with `pid`/`mcid` passthrough (only product-detail `productUrl`s are documented/confirmed). This plan proposes `https://www.viator.com/searchResults/all?text=<query>&pid=<pid>&mcid=<mcid>&medium=api&campaign=affiliate-fallback`, built from the same static `pid`/`mcid` already embedded in `viator-links.json`. **This URL template is an assumption, not a confirmed API contract** — flag it to Roy before relying on it for real attributed revenue. The plumbing (route logic, flagging, tests) is unaffected if the exact template needs to change later — only `buildProviderSearchFallbackUrl`'s internals would need an edit.

### §6 — Testability requires splitting pure logic from I/O, same as `normalizer.ts`/`import.pipeline.ts`
`route.ts` (Next.js route handler) isn't unit-testable under the existing node-env jest harness (no `Request`/`NextResponse` polyfills — same reason ST-17 left RSC/route code to `next build` verification). So both new behaviors — fallback URL building and health-report flagging — are pure, injectable-dependency modules under `src/lib/`, fully covered by jest; `route.ts` only wires them together, and is verified by a manual `/go` check against `next dev`/`next build`, not a spec file.

### §7 — The CLI needs `ts-node`, mirroring `apps/api`'s own precedent
`apps/web`'s `tsconfig.json` targets `"module": "esnext"` / `"moduleResolution": "bundler"` (Next 15's default), which plain `ts-node` can't run directly. `apps/api` already solves an analogous problem by depending on `ts-node` for `trigger-import.cli.ts` (`"import:run": "ts-node src/modules/import/trigger-import.cli.ts"`). This plan adds the same devDependency to `apps/web`, with a small dedicated `scripts/tsconfig.json` (CommonJS override) so the CLI can run independently of the Next app's own bundler config — no Next build changes, no impact on `next dev`/`next build`.

---

## File Structure

**New (source):**
- `apps/web/src/lib/affiliate-fallback.ts` — pure: `extractAccountAffiliateParams`, `buildProviderSearchFallbackUrl`.
- `apps/web/src/lib/link-health.ts` — pure: `sampleLinkKeys`, `checkLinkHealth`, `isFlaggedUnhealthy`, plus the `LinkHealthReport`/`LinkCheckResult`/`Pinger` types.
- `apps/web/src/data/link-health-report.json` — checked-in placeholder report (`{ "checkedAt": null, "failingKeys": [] }`), refreshed by the CLI, read by `/go`.
- `apps/web/scripts/check-link-health.ts` — thin CLI: samples real links, pings with real `fetch`, writes the report file, prints a summary. Not scheduled.
- `apps/web/scripts/tsconfig.json` — CommonJS `ts-node` override so the CLI can run standalone.

**New (tests):**
- `apps/web/src/lib/affiliate-fallback.spec.ts`
- `apps/web/src/lib/link-health.spec.ts`

**Modified:**
- `apps/web/src/app/go/[slug]/[id]/route.ts` — falls back instead of 404ing when a direct link is missing, disallowed, or health-flagged; flags the click.
- `apps/web/package.json` — add `ts-node` devDependency + `"link-health:check"` script.

**Read-only references (do not modify):** `apps/web/src/data/viator-links.json`, `apps/web/src/lib/experience-detail.ts` (`findExperienceDetail`), `apps/web/src/data/destinations-helpers.ts`, `apps/api/src/modules/import/trigger-import.cli.ts` (pattern reference only).

---

### Task 1: Provider-search fallback URL builder

**Files:**
- Create: `apps/web/src/lib/affiliate-fallback.ts`
- Test: `apps/web/src/lib/affiliate-fallback.spec.ts`

**Interfaces:**
- Produces: `extractAccountAffiliateParams(links: Record<string, { affiliateUrl?: string }>): { pid: string; mcid: string } | undefined` and `buildProviderSearchFallbackUrl(query: string, account?: { pid: string; mcid: string }): string`. Task 3 (route) and Task 2 (n/a) rely on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/affiliate-fallback.spec.ts
import { describe, expect, it } from "@jest/globals";
import {
  extractAccountAffiliateParams,
  buildProviderSearchFallbackUrl,
} from "@/lib/affiliate-fallback";

describe("extractAccountAffiliateParams", () => {
  it("reads pid/mcid from the first entry that has them", () => {
    const links = {
      "bangkok/a": {
        affiliateUrl:
          "https://www.viator.com/tours/Bangkok/x/d1-1P1?mcid=42383&pid=P00309945&medium=api",
      },
    };
    expect(extractAccountAffiliateParams(links)).toEqual({
      pid: "P00309945",
      mcid: "42383",
    });
  });

  it("returns undefined for an empty registry", () => {
    expect(extractAccountAffiliateParams({})).toBeUndefined();
  });

  it("returns undefined when no entry has a parseable pid/mcid", () => {
    const links = { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/x/d1-1P1" } };
    expect(extractAccountAffiliateParams(links)).toBeUndefined();
  });

  it("skips an entry with no affiliateUrl and finds the next one", () => {
    const links = {
      "bangkok/a": {},
      "bangkok/b": {
        affiliateUrl: "https://www.viator.com/tours/x/d1-1P1?mcid=42383&pid=P00309945",
      },
    };
    expect(extractAccountAffiliateParams(links)).toEqual({
      pid: "P00309945",
      mcid: "42383",
    });
  });
});

describe("buildProviderSearchFallbackUrl", () => {
  it("builds a viator.com search URL carrying the query and account params", () => {
    const url = buildProviderSearchFallbackUrl("Grand Palace Bangkok", {
      pid: "P00309945",
      mcid: "42383",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.pathname).toBe("/searchResults/all");
    expect(parsed.searchParams.get("text")).toBe("Grand Palace Bangkok");
    expect(parsed.searchParams.get("pid")).toBe("P00309945");
    expect(parsed.searchParams.get("mcid")).toBe("42383");
    expect(parsed.searchParams.get("medium")).toBe("api");
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("omits pid/mcid/medium when no account params are available, but still returns a usable search URL", () => {
    const url = buildProviderSearchFallbackUrl("Grand Palace Bangkok");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe("Grand Palace Bangkok");
    expect(parsed.searchParams.has("pid")).toBe(false);
    expect(parsed.searchParams.has("mcid")).toBe(false);
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @folio/web exec jest src/lib/affiliate-fallback.spec.ts`
Expected: FAIL — `Cannot find module '@/lib/affiliate-fallback'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/affiliate-fallback.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @folio/web exec jest src/lib/affiliate-fallback.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/affiliate-fallback.ts apps/web/src/lib/affiliate-fallback.spec.ts
git commit -m "feat(web): add provider-search fallback URL builder (BRI-138)"
```

---

### Task 2: Link-health core logic

**Files:**
- Create: `apps/web/src/lib/link-health.ts`
- Test: `apps/web/src/lib/link-health.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `LinkCheckResult`, `LinkHealthReport` types; `sampleLinkKeys(links, sampleSize, random?): string[]`; `checkLinkHealth(links, keys, ping): Promise<{ checkedAt: string; results: LinkCheckResult[]; failingKeys: string[] }>`; `isFlaggedUnhealthy(key, report): boolean`. Task 3 (route) relies on `isFlaggedUnhealthy` + `LinkHealthReport`; Task 4 (CLI) relies on `sampleLinkKeys` + `checkLinkHealth`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/link-health.spec.ts
import { describe, expect, it } from "@jest/globals";
import {
  sampleLinkKeys,
  checkLinkHealth,
  isFlaggedUnhealthy,
  type LinkHealthReport,
} from "@/lib/link-health";

const links = {
  "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" },
  "bangkok/b": { affiliateUrl: "https://www.viator.com/tours/b" },
  "kyoto/c": { affiliateUrl: "https://www.viator.com/tours/c" },
  "kyoto/d": {}, // no affiliateUrl — must never be sampled
};

describe("sampleLinkKeys", () => {
  it("only samples keys that actually have an affiliateUrl", () => {
    const keys = sampleLinkKeys(links, 10);
    expect(keys.sort()).toEqual(["bangkok/a", "bangkok/b", "kyoto/c"]);
  });

  it("caps the sample at sampleSize", () => {
    const keys = sampleLinkKeys(links, 2, () => 0);
    expect(keys.length).toBe(2);
  });

  it("is deterministic given an injected random function", () => {
    const a = sampleLinkKeys(links, 2, () => 0.1);
    const b = sampleLinkKeys(links, 2, () => 0.1);
    expect(a).toEqual(b);
  });
});

describe("checkLinkHealth", () => {
  it("classifies each key as passing or failing per the ping result", async () => {
    const ping = async (url: string) =>
      url.endsWith("/b") ? { ok: false, status: 404 } : { ok: true, status: 200 };

    const report = await checkLinkHealth(links, ["bangkok/a", "bangkok/b"], ping);
    expect(report.failingKeys).toEqual(["bangkok/b"]);
    expect(report.results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: true, status: 200 },
      { key: "bangkok/b", url: "https://www.viator.com/tours/b", ok: false, status: 404 },
    ]);
    expect(typeof report.checkedAt).toBe("string");
    expect(() => new Date(report.checkedAt)).not.toThrow();
  });

  it("records a ping rejection as a failure with the error message, not a crash", async () => {
    const ping = async () => {
      throw new Error("timeout");
    };
    const report = await checkLinkHealth(links, ["bangkok/a"], ping);
    expect(report.failingKeys).toEqual(["bangkok/a"]);
    expect(report.results[0]).toEqual({
      key: "bangkok/a",
      url: "https://www.viator.com/tours/a",
      ok: false,
      error: "timeout",
    });
  });

  it("skips a sampled key that has no affiliateUrl rather than pinging undefined", async () => {
    const ping = async () => ({ ok: true, status: 200 });
    const report = await checkLinkHealth(links, ["kyoto/d"], ping);
    expect(report.results).toEqual([]);
    expect(report.failingKeys).toEqual([]);
  });
});

describe("isFlaggedUnhealthy", () => {
  const report: LinkHealthReport = { checkedAt: "2026-08-24T00:00:00.000Z", failingKeys: ["bangkok/b"] };

  it("is true for a key present in failingKeys", () => {
    expect(isFlaggedUnhealthy("bangkok/b", report)).toBe(true);
  });

  it("is false for a key not present in failingKeys", () => {
    expect(isFlaggedUnhealthy("bangkok/a", report)).toBe(false);
  });

  it("is false against an empty/placeholder report", () => {
    expect(isFlaggedUnhealthy("bangkok/a", { checkedAt: null, failingKeys: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @folio/web exec jest src/lib/link-health.spec.ts`
Expected: FAIL — `Cannot find module '@/lib/link-health'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/link-health.ts
/**
 * Link-health sampling for the affiliate registry (BRI-138 / ST-26).
 *
 * Pure and I/O-free: the actual network ping is injected as `Pinger`, so this
 * module is fully unit-testable with no live HTTP calls. `scripts/check-link-health.ts`
 * is the thin, I/O-owning wrapper that supplies a real `fetch`-based pinger and
 * writes the resulting report to `src/data/link-health-report.json`. `/go`
 * (`app/go/[slug]/[id]/route.ts`) reads that report via `isFlaggedUnhealthy` to
 * treat a previously-good link that has since gone bad the same as a missing one.
 *
 * Deliberately NOT wired to any scheduler — Render is suspended. This mirrors
 * `apps/api`'s `ImportScheduler`/`trigger-import.cli.ts` split (pure trigger
 * logic vs. cron registration) so wiring a schedule later is a small, isolated
 * change, not a rewrite.
 */

export interface LinkCheckResult {
  key: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface LinkHealthReport {
  /** ISO timestamp of the last real run, or null for the untouched placeholder report. */
  checkedAt: string | null;
  failingKeys: string[];
}

export type Pinger = (url: string) => Promise<{ ok: boolean; status?: number }>;

type LinkEntry = { affiliateUrl?: string };

/** Picks up to `sampleSize` keys, restricted to entries that actually have a link. */
export function sampleLinkKeys(
  links: Record<string, LinkEntry>,
  sampleSize: number,
  random: () => number = Math.random,
): string[] {
  const eligible = Object.entries(links)
    .filter(([, entry]) => Boolean(entry.affiliateUrl))
    .map(([key]) => key);

  // Fisher-Yates using the injected `random`, so a fixed function gives a
  // reproducible sample in tests without needing a real seeded RNG dependency.
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, sampleSize);
}

/** Pings each sampled key's URL and classifies pass/fail. Never throws on a ping failure. */
export async function checkLinkHealth(
  links: Record<string, LinkEntry>,
  keys: string[],
  ping: Pinger,
): Promise<{ checkedAt: string; results: LinkCheckResult[]; failingKeys: string[] }> {
  const results: LinkCheckResult[] = [];

  for (const key of keys) {
    const url = links[key]?.affiliateUrl;
    if (!url) continue; // sampled key lost its link between sampling and checking — skip, don't crash

    try {
      const outcome = await ping(url);
      results.push({ key, url, ok: outcome.ok, status: outcome.status });
    } catch (error) {
      results.push({
        key,
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    results,
    failingKeys: results.filter((r) => !r.ok).map((r) => r.key),
  };
}

/** Whether a link previously matched to a key has since been flagged unhealthy. */
export function isFlaggedUnhealthy(key: string, report: LinkHealthReport): boolean {
  return report.failingKeys.includes(key);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @folio/web exec jest src/lib/link-health.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/link-health.ts apps/web/src/lib/link-health.spec.ts
git commit -m "feat(web): add link-health sampling + classification core (BRI-138)"
```

---

### Task 3: Wire the fallback + health-flag into `/go`

**Files:**
- Create: `apps/web/src/data/link-health-report.json`
- Modify: `apps/web/src/app/go/[slug]/[id]/route.ts`

**Interfaces:**
- Consumes: `extractAccountAffiliateParams`, `buildProviderSearchFallbackUrl` (Task 1); `isFlaggedUnhealthy`, `LinkHealthReport` (Task 2); `findExperienceDetail` (existing, `@/lib/experience-detail`).
- Produces: `/go/:slug/:id` now degrades to a fallback (and flags the click) instead of 404ing whenever `:slug/:id` resolves to a real Experience with no healthy direct link; still 404s when `:slug/:id` isn't a real Experience at all.

- [ ] **Step 1: Write the placeholder report file**

```json
{
  "checkedAt": null,
  "failingKeys": []
}
```

Save as `apps/web/src/data/link-health-report.json`.

- [ ] **Step 2: Modify the route handler**

In `apps/web/src/app/go/[slug]/[id]/route.ts`, replace the imports and the 404-on-missing-link block:

```ts
import { NextResponse } from "next/server";

import links from "@/data/viator-links.json";
import healthReport from "@/data/link-health-report.json";
import { findExperienceDetail } from "@/lib/experience-detail";
import { isFlaggedUnhealthy, type LinkHealthReport } from "@/lib/link-health";
import {
  extractAccountAffiliateParams,
  buildProviderSearchFallbackUrl,
} from "@/lib/affiliate-fallback";

/**
 * `GET /go/:slug/:id` — first-party affiliate click redirect (ST-24 / BRI-136),
 * extended with a graceful fallback (BRI-138 / ST-26).
 *
 * A key with no matched link, a non-Viator target, or a link the last
 * `check-link-health` run flagged unhealthy all fall through to a Viator
 * provider-search URL instead of 404ing — but ONLY when `:slug/:id` resolves to
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
    target = buildProviderSearchFallbackUrl(
      `${detail.experience.title} ${detail.destination.city}`,
      account,
    );
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @folio/web typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification against `next dev`**

Run: `pnpm --filter @folio/web dev` (from repo root), then in another terminal:

```bash
curl -sI http://localhost:3000/go/bangkok/grand-palace-wat-phra-kaew | head -5
curl -sI http://localhost:3000/go/kyoto/some-unmatched-experience-id | head -5
curl -s http://localhost:3000/go/atlantis/nonexistent -o /dev/null -w "%{http_code}\n"
```

Expected: the first (a matched key) 302s to a `viator.com/tours/...` URL as before; the second (a real but unmatched experience id — substitute a genuine unmatched id from `destinations.ts`) 302s to a `viator.com/searchResults/all?...` URL; the third (not a real destination/experience at all) returns `404`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/go/[slug]/[id]/route.ts apps/web/src/data/link-health-report.json
git commit -m "feat(web): fall back to provider search instead of 404 in /go (BRI-138)"
```

---

### Task 4: Link-health CLI (callable now, schedulable later — no cron wired)

**Files:**
- Create: `apps/web/scripts/check-link-health.ts`
- Create: `apps/web/scripts/tsconfig.json`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `sampleLinkKeys`, `checkLinkHealth` (Task 2, via relative import `../src/lib/link-health` — the CLI's own `tsconfig.json` uses CommonJS so it doesn't inherit the app's bundler-mode resolution).
- Produces: `apps/web/src/data/link-health-report.json` refreshed with real ping results; `pnpm --filter @folio/web run link-health:check` as the manual entry point.

- [ ] **Step 1: Add the `ts-node` devDependency + script**

In `apps/web/package.json`, add to `"scripts"`:

```json
"link-health:check": "ts-node --project scripts/tsconfig.json scripts/check-link-health.ts"
```

Add to `"devDependencies"` (matching `apps/api`'s pinned version):

```json
"ts-node": "^10.9.2"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `ts-node` present under `apps/web`.

- [ ] **Step 3: Write the CLI's own `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2020",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": false
  },
  "include": ["*.ts", "../src/lib/link-health.ts"]
}
```

Save as `apps/web/scripts/tsconfig.json`. This overrides the app's own `"module": "esnext"` / `"moduleResolution": "bundler"` (Next 15 default, which plain `ts-node` can't run) so the CLI runs standalone — no change to `apps/web/tsconfig.json` or the Next build.

- [ ] **Step 4: Write the CLI**

```ts
// apps/web/scripts/check-link-health.ts
// Manually-run link-health check for the Viator affiliate registry (BRI-138 /
// ST-26). Samples a subset of live productUrls, pings each with a real HEAD
// request (falling back to GET on a 405, since some hosts reject HEAD), and
// writes the pass/fail report `/go` reads to decide whether a previously-good
// link should now fall back to provider search.
//
// This is deliberately NOT registered on any cron/scheduler — Render is
// suspended. It mirrors apps/api's ImportScheduler/trigger-import.cli.ts split:
// pure check logic (src/lib/link-health.ts, unit-tested) vs. this thin,
// I/O-owning trigger — so wiring a real schedule later only touches this file's
// caller, not the tested logic.
//
// Usage (from apps/web/): pnpm run link-health:check
//   Optional: LINK_HEALTH_SAMPLE_SIZE=10 pnpm run link-health:check

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleLinkKeys, checkLinkHealth, type Pinger } from "../src/lib/link-health";

const dataDir = join(__dirname, "..", "src", "data");
const linksPath = join(dataDir, "viator-links.json");
const reportPath = join(dataDir, "link-health-report.json");

const SAMPLE_SIZE = Number(process.env.LINK_HEALTH_SAMPLE_SIZE ?? "10");
const TIMEOUT_MS = 8000;

type LinkEntry = { affiliateUrl?: string };

/** HEAD first (cheaper); a 405 means the host doesn't support it, so retry with GET. */
const ping: Pinger = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.status === 405) {
      res = await fetch(url, { method: "GET", signal: controller.signal });
    }
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
};

async function main() {
  const links: Record<string, LinkEntry> = JSON.parse(readFileSync(linksPath, "utf8"));
  const keys = sampleLinkKeys(links, SAMPLE_SIZE);

  if (keys.length === 0) {
    console.log("No matched links to check (viator-links.json has no affiliateUrl entries).");
    return;
  }

  console.log(`Checking ${keys.length} of ${Object.keys(links).length} links...`);
  const { checkedAt, results, failingKeys } = await checkLinkHealth(links, keys, ping);

  for (const r of results) {
    const label = r.ok ? "OK" : `FAIL${r.status ? ` (${r.status})` : r.error ? ` (${r.error})` : ""}`;
    console.log(`  [${label}] ${r.key}`);
  }

  writeFileSync(reportPath, JSON.stringify({ checkedAt, failingKeys }, null, 2) + "\n");
  console.log(
    `\n${failingKeys.length}/${results.length} sampled links failing. Report written to ${reportPath}.`,
  );
  console.log("Rebuild the app for /go to pick up the refreshed report.");
}

main().catch((error) => {
  console.error("check-link-health failed:", error);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Verify the CLI runs standalone (dry run against real Viator hosts)**

Run: `pnpm --filter @folio/web run link-health:check`
Expected: prints a per-key OK/FAIL line for each sampled key, writes `apps/web/src/data/link-health-report.json` with a real `checkedAt` timestamp, exits 0. (Network access required — if sandboxed/offline, confirm instead that it fails with a clear fetch/network error rather than a TypeScript/module-resolution error, then revert the report file: `git checkout apps/web/src/data/link-health-report.json`.)

- [ ] **Step 6: Restore the placeholder report if the dry run wrote real results**

Run: `git diff apps/web/src/data/link-health-report.json`
If the dry run in Step 5 modified it: `git checkout apps/web/src/data/link-health-report.json` — the placeholder ships in this PR; a real run is Roy's call, not this task's.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/scripts/check-link-health.ts apps/web/scripts/tsconfig.json pnpm-lock.yaml
git commit -m "feat(web): add link-health CLI, not scheduled (BRI-138)"
```

---

### Task 5: Full verification + final report

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @folio/web test`
Expected: all specs pass, including the two new ones from Tasks 1–2.

- [ ] **Step 2: Run lint + typecheck across affected workspaces**

Run: `pnpm --filter @folio/web lint && pnpm --filter @folio/web typecheck`
Expected: clean.

- [ ] **Step 3: Run a full build**

Run: `pnpm --filter @folio/web build`
Expected: succeeds (confirms `link-health-report.json` imports fine as a static JSON module and the route handler compiles under the real Next config, not just the CLI's standalone one).

- [ ] **Step 4: Re-run the manual `/go` checks from Task 3 Step 4 against the production build**

Run: `pnpm --filter @folio/web start` (after the Task 5 Step 3 build), repeat the three `curl` checks.
Expected: same three outcomes (direct 302 / fallback 302 / 404) as the dev-mode check.

- [ ] **Step 5: Prepare the final report for Roy**

No commit for this step — compose the summary covering: BRI-137 requires no code change (cite §1); BRI-138's fallback + health-check are implemented and tested; the provider-search URL template (§5) is an unverified assumption Roy should confirm; the two dead-code components (`ExperienceCard.tsx`, `DbExperienceCard.tsx`) are a separate, optional cleanup not done here; no cron was wired (per instruction); Linear was not touched (per instruction).

---

## Self-Review

**1. Spec coverage.**
- BRI-137 AC 1–3 (valid product URL + params, coming-soon state, verbatim outbound URL): already satisfied by existing code — no task changes this, Task 5 reports it. ✓.
- BRI-138 AC 1 ("Missing/expired `affiliate_url` redirects to provider search... and flags the tour"): Task 3 — missing (`directUrl` falsy) and expired (`isFlaggedUnhealthy` true) both fall through to the same branch; flagged via distinct `providerId`. ✓.
- BRI-138 AC 2 ("A scheduled job pings a sample and flags failures in a report"): Task 2 (`sampleLinkKeys`/`checkLinkHealth`, tested) + Task 4 (real CLI that pings and writes the report) implement the "pings a sample and flags failures in a report" half in full; the "scheduled" half is explicitly deferred per instruction, called out in Task 5's report. ✓ (with the deferral flagged, not silently dropped).

**2. Placeholder scan.** No TBD/"add error handling"/"similar to Task N" patterns — every step has literal code or a literal command. Task 4 Step 5's "if offline" branch is a genuine fork in a manual verification step, not a placeholder — it says exactly what to check on either branch.

**3. Type consistency.**
- `AffiliateAccountParams` (Task 1) is consumed as `account?: AffiliateAccountParams` by `buildProviderSearchFallbackUrl` and produced by `extractAccountAffiliateParams` — same shape (`{ pid: string; mcid: string }`) in both.
- `LinkHealthReport` (Task 2: `{ checkedAt: string | null; failingKeys: string[] }`) matches the placeholder JSON shape written in Task 3 Step 1 and the shape `checkLinkHealth`/the CLI (Task 4) writes (`{ checkedAt, failingKeys }` — note `checkLinkHealth`'s return also carries `results`, which the CLI logs but deliberately does NOT persist to the report file, keeping the on-disk/imported shape exactly `LinkHealthReport` with no drift).
- `isFlaggedUnhealthy(key: string, report: LinkHealthReport): boolean` — Task 2 signature matches Task 3's call site (`isFlaggedUnhealthy(key, report)` where `report` is the statically-imported, cast `LinkHealthReport`).
- `findExperienceDetail(slug, id)` — Task 3 uses the existing signature verbatim from `experience-detail.ts` (confirmed via the audit read, not assumed).
- `Pinger = (url: string) => Promise<{ ok: boolean; status?: number }>` — Task 2's type, Task 4's `ping` implementation, and both spec files' fake pingers all conform to this exact shape.

No gaps found.
