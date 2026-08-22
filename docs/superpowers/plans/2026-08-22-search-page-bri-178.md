# /search Page (BRI-178 · ST-13/ST-16 front end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/web`'s first `/search` page — a free-text + faceted browse over experiences and destinations, with filter/query state reflected in the URL and an honest zero-result state — reusing the site's existing card/CTA seams.

**Architecture:** The page is a **server component** that reads `searchParams`, runs a pure search/filter engine over the **static content system** (`destinations.ts` + `viator-links.json`), and renders results with the existing `ExperienceRowCard` / `DestinationCard`. Interactive query + filter controls are thin **client islands** that push URL updates via `useRouter`; because results are derived from the URL on the server, reloading or sharing a URL reproduces results exactly. All branching logic lives in two pure, ts-jest–tested lib modules; JSX is verified by `next build`.

**Tech Stack:** Next.js 15 (App Router, RSC), TypeScript, Tailwind v4, `@folio/shared` domain types, ts-jest (node env) for the pure modules, PostHog (client) for the search analytics event.

**Spec:** `docs/03-engineering-specification.md` (ST-13, ST-16) and `docs/01-product-bible.md` IA (`/search` = "Results (list + map)"; `/experiences` = "Browse experiences"). This plan folds the bible's separate `/experiences` browse into `/search`, per BRI-178.

## Global Constraints

- **Data source is the static content system, not the live API.** See "Decision 1" below — copied verbatim into every task's implicit requirements: never call `GET /v1/search` or any API from this page; read `getAllDestinations()` from `@/data/destinations-helpers`.
- **Never invent a fact.** Any field a result lacks renders as an em-dash (`—`) or is simply omitted — same pattern as ST-17 detail / ST-18 compare. No faked prices, durations, or ratings.
- **Affiliate CTA seam is fixed.** Live booking links go through `/go/:slug/:id` (BRI-136) and fire `trackAffiliateClick`; never render a raw `affiliateUrl` href. This is already encapsulated in `ExperienceRowCard` — reuse it, do not re-implement.
- **Analytics only through `src/lib/analytics.ts` helpers.** Never inline `posthog.capture` in a component (CLAUDE.md analytics rule).
- **URL param names mirror the API contract verbatim where they overlap** (`q`, `priceBand`, `minRating`, `page`) so a future swap to the live `/v1/search` is a data-source change, not a URL rebuild. Additions the static facets need (`category`, `duration`) are documented deviations (Decision 3).
- **Pure lib modules import no `next`/`posthog`/JSX** so ts-jest runs them in a node env (jest.config `rootDir: src`, `testRegex: .*\.spec\.ts$`). Mirror `experience-compare.ts` / `experience-detail.ts`.
- **Tests:** `pnpm --filter @folio/web test`. Build/typecheck: `pnpm --filter @folio/web build`, `pnpm --filter @folio/web typecheck`.

---

## Decisions (the reasoning the task asked for)

### Decision 1 — Search queries the **static** dataset, server-side (NOT the live API)

`GET /v1/search` is real, tested, and contract-complete, but it reads the **DB** (Experience/City via Postgres FTS). Three facts make the DB the wrong source *today*:

1. **The DB has no usable content.** The Render ingest is broken/suspended (memory: `Experience` count effectively unusable; the task forbids touching Render). A page bound to `/v1/search` would render empty or garbage until that resolves.
2. **Every front-end page shipped this week reads static content** (ST-16/17/18). ST-17's `experience-detail.ts` states it outright: "the static system, not the DB one, is the source here." `/search` binding to the API would be the lone exception, and would diverge from the very pages it links to (`experienceDetailPath` resolves against static data).
3. **`apps/web` makes no server-side `/v1/search` call today** and has no `API_BASE_URL` wired for it in build; `next build`/local dev has no API running, so a live-API page would fail to build/prerender.

**Decision:** search the same static dataset the rest of the site renders, in a pure server-side engine. To keep the eventual API swap cheap, the **URL contract and result shape mirror the API** (Decision 3); when the DB is populated, swapping `runSearch()` for a `fetch('/v1/search?...')` is a data-layer change behind the same URL params and the same card components. This mirrors ST-17's explicit static-vs-DB call, made the same way.

### Decision 2 — Honest filter set for the **static** data (not the DB population rates)

The ST-16 report's population rates (price ~100%, duration ~76%, rating ~40%) were measured on the **live DB `Tour` catalogue**. The **static dataset this page actually renders** has different real populations (measured on `destinations.ts`, 48 experiences / 6 destinations):

| Field | Static population | Shape | Decision |
|---|---|---|---|
| `priceBand` | **100%** | editorial band `$`/`$$`/`$$$` (`$$$$` absent) | **Filter control** (primary) |
| `category` | **100%** | 9 `ExperienceCategory` values | **Filter control** (static's strongest facet; named in ST-16 AC) |
| `duration` | **100%** | free-text labels ("Half day", "Evening"…) | **Filter control** as buckets (Decision 3) |
| `rating` / `fromPrice` | **~0% today** | only via `viator-links.json`, currently `{}` | **Display-only** (em-dash when absent); `minRating` supported by engine + URL but **no control surfaced** this iteration |

Surfacing three filters that are 100% populated (price, category, duration) means every result carries every facet value → clean counts, no dishonest "—" gaps in the facet UI. `rating` is rendered on cards when present and blank (`—`) otherwise (via `ExperienceRowCard`, which already does this), but a `minRating` *control* is deliberately **not** shown: on today's static data it would silently wipe 100% of results. The engine and the `minRating` URL param are still implemented and tested, so the control lights up cleanly the day enrichment/API populates ratings — matching the task's "handle partial data honestly" intent for the source we actually have.

### Decision 3 — URL contract: API params verbatim + two documented static facets

- Verbatim from `/v1/search`: `q`, `priceBand` (comma-joined, e.g. `$,$$`), `minRating`, `page`.
- **`category`** (comma-joined `ExperienceCategory` tokens): explicitly listed in ST-16's AC ("category, tag, price band, duration, rating, suitability"), so spec-blessed even though Phase-A API hasn't built it. Additive, non-conflicting.
- **`duration`** (comma-joined buckets `short|half-day|full-day|multi-day`): the static `duration` field is categorical free-text, so we filter by label bucket. This is a deliberate, honest deviation from the API's numeric `minDurationMin`/`maxDurationMin`: mapping "Evening"/"Half day" to fabricated minute counts would violate the no-invented-facts rule. Documented in `search-url.ts`; when the minute-based API becomes the source, buckets map to min/max minute ranges behind the same control.

Duration bucket mapping (exact label → bucket; note en-dash `–` in the data):

```
"1 hour", "1–2 hours", "2 hours", "2–3 hours", "Evening"  → "short"
"Half day"                                                → "half-day"
"Full day"                                                → "full-day"
"1–2 days"                                                → "multi-day"
(unrecognised label)                                      → null  (unbucketed; still shown)
```

### Decision 4 — URL state pattern (new to this repo)

No page in `apps/web` reflects filter state in the URL today (confirmed: no `type="search"`, no `useSearchParams` faceting). Idiomatic App-Router pattern, chosen here: the **page is a server component reading `searchParams`** (a `Promise` in Next 15, awaited — same convention as the ST-17 detail page's `params`), runs the engine, renders server-side. A **client `SearchControls` island** owns the input + filter chips and calls `router.replace(pathname + '?' + query)` on change; Next re-renders the server component with new `searchParams`. Server-rendered results = shareable, reloadable, SSR/SEO-friendly, and the ST-16 AC ("state is in the URL; reloading reproduces results") is satisfied by construction.

### Decision 5 — Zero-result state doubles as a content-gap analytics signal

The empty state is a real, styled panel (not a bare "no results"). A `trackSearch` analytics event (`search_performed`, added to `analytics.ts`) fires with `query`, `result_count`, and active filters, so **zero-result queries are captured as a content-gap signal** for the future admin/analytics pass — the CLAUDE.md analytics note explicitly anticipates "search/filter … events land as those features do." Fired from a small client island so it sees the server-computed `result_count`.

### Scope boundary (out of scope for BRI-178)

- **Map toggle** (bible's "list ⇄ map"): future (M3). The URL contract stays map-compatible but no map ships here.
- **Autocomplete** (ST-14) and **fuzzy/synonym** (ST-15): separate stories; this is ST-13 + ST-16 only. Static matching is case-insensitive substring/token (no `pg_trgm`).
- **Persistent global search box on every page**: this plan adds one nav entry point to `/search` (Task 5); a site-wide search box is follow-up.

---

## File Structure

- `apps/web/src/lib/search-url.ts` — **pure.** `SearchState` type, vocab guards, `parseSearchState()`, `searchStateToQuery()`, `durationBucketOf()`. The URL contract. No next/posthog imports.
- `apps/web/src/lib/search-url.spec.ts` — tests for parse/serialize round-trip + tolerance.
- `apps/web/src/lib/search-experiences.ts` — **pure.** `SearchResult*` types, `runSearch()`, facet counting, ranking, pagination over the static corpus. Imports `@/data/destinations-helpers` + `search-url` only.
- `apps/web/src/lib/search-experiences.spec.ts` — tests for matching, filter AND, featured fallback, partial-data, zero results, pagination, facets.
- `apps/web/src/lib/analytics.ts` — **modify.** Add `trackSearch()` + `SearchAnalyticsInput`.
- `apps/web/src/app/search/page.tsx` — **RSC.** Reads `searchParams`, runs `runSearch`, renders chrome + results + empty state + JSON-LD + metadata.
- `apps/web/src/app/search/SearchControls.tsx` — **client island.** Query input + price/category/duration chips + clear; syncs URL.
- `apps/web/src/app/search/SearchAnalytics.tsx` — **client island.** Fires `trackSearch` on query/filter/result-count change.
- `apps/web/src/components/covilla/CovillaHeader.tsx` — **modify.** Add a "Search" nav entry + flyout link to `/search`.
- `apps/web/src/app/sitemap.ts` — **modify.** Add `/search`.
- `apps/web/src/app/sitemap.spec.ts` — **modify.** Assert `/search` present.

---

## Task 1: Search URL state (`search-url.ts`)

**Files:**
- Create: `apps/web/src/lib/search-url.ts`
- Test: `apps/web/src/lib/search-url.spec.ts`

**Interfaces:**
- Consumes: `PriceBand`, `ExperienceCategory` from `@folio/shared`.
- Produces (relied on by Tasks 2 & 4):
  - `type DurationBucket = "short" | "half-day" | "full-day" | "multi-day"`
  - `interface SearchState { q: string; priceBands: PriceBand[]; categories: ExperienceCategory[]; durations: DurationBucket[]; minRating?: number; page: number }`
  - `const EMPTY_SEARCH_STATE: SearchState`
  - `function parseSearchState(params: Record<string, string | string[] | undefined>): SearchState`
  - `function searchStateToQuery(state: SearchState): string`
  - `const VALID_PRICE_BANDS`, `VALID_CATEGORIES`, `VALID_DURATIONS` (readonly arrays used by Task 4 to render chips)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/search-url.spec.ts
import { describe, expect, it } from "@jest/globals";
import {
  parseSearchState,
  searchStateToQuery,
  EMPTY_SEARCH_STATE,
} from "@/lib/search-url";

describe("parseSearchState", () => {
  it("returns the empty state for no params", () => {
    expect(parseSearchState({})).toEqual(EMPTY_SEARCH_STATE);
  });

  it("parses q, comma-joined priceBand/category/duration, minRating, page", () => {
    const s = parseSearchState({
      q: " temples ",
      priceBand: "$,$$",
      category: "Culture & History,Food & Drink",
      duration: "short,full-day",
      minRating: "4",
      page: "3",
    });
    expect(s.q).toBe("temples");
    expect(s.priceBands).toEqual(["$", "$$"]);
    expect(s.categories).toEqual(["Culture & History", "Food & Drink"]);
    expect(s.durations).toEqual(["short", "full-day"]);
    expect(s.minRating).toBe(4);
    expect(s.page).toBe(3);
  });

  it("drops unknown tokens and clamps page/minRating tolerantly", () => {
    const s = parseSearchState({
      priceBand: "$,bogus",
      category: "Nope",
      duration: "short,weird",
      minRating: "99",
      page: "0",
    });
    expect(s.priceBands).toEqual(["$"]);
    expect(s.categories).toEqual([]);
    expect(s.durations).toEqual(["short"]);
    expect(s.minRating).toBe(5); // clamped 0..5
    expect(s.page).toBe(1); // clamped >=1
  });

  it("takes the first value when a param arrives as an array", () => {
    expect(parseSearchState({ q: ["a", "b"] }).q).toBe("a");
  });
});

describe("searchStateToQuery", () => {
  it("omits defaults and round-trips a populated state", () => {
    expect(searchStateToQuery(EMPTY_SEARCH_STATE)).toBe("");
    const state = {
      q: "night market",
      priceBands: ["$", "$$"] as const,
      categories: ["Food & Drink"] as const,
      durations: ["short"] as const,
      minRating: 4,
      page: 2,
    };
    const round = parseSearchState(
      Object.fromEntries(new URLSearchParams(searchStateToQuery(state as never))),
    );
    expect(round.q).toBe("night market");
    expect(round.priceBands).toEqual(["$", "$$"]);
    expect(round.categories).toEqual(["Food & Drink"]);
    expect(round.durations).toEqual(["short"]);
    expect(round.minRating).toBe(4);
    expect(round.page).toBe(2);
  });

  it("omits page=1 from the query", () => {
    expect(searchStateToQuery({ ...EMPTY_SEARCH_STATE, q: "x", page: 1 })).toBe("q=x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @folio/web exec jest src/lib/search-url.spec.ts`
Expected: FAIL — "Cannot find module '@/lib/search-url'".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/search-url.ts
/**
 * Pure URL-state contract for /search (ST-16: "state is in the URL; reloading
 * reproduces results"). No next/posthog imports, so ts-jest runs it in node.
 *
 * Param names mirror the API's `GET /v1/search` verbatim where they overlap
 * (`q`, `priceBand`, `minRating`, `page`) so a future swap to the live endpoint
 * is a data-source change, not a URL rebuild. `category` and `duration` are
 * additive facets the static content system carries; `duration` uses categorical
 * buckets because the static `Experience.duration` is free-text labels, not
 * minutes (mapping labels to fake minutes would invent data — see the plan's
 * Decision 3). When the minute-based API becomes the source, buckets map to
 * min/max minute ranges behind the same control.
 */
import type { ExperienceCategory, PriceBand } from "@folio/shared";

export type DurationBucket = "short" | "half-day" | "full-day" | "multi-day";

export const VALID_PRICE_BANDS: readonly PriceBand[] = ["$", "$$", "$$$", "$$$$"];
export const VALID_CATEGORIES: readonly ExperienceCategory[] = [
  "Culture & History",
  "Food & Drink",
  "Nature & Outdoors",
  "Landmarks",
  "Neighbourhoods",
  "Nightlife",
  "Day Trips",
  "Wellness",
  "Water & Coast",
];
export const VALID_DURATIONS: readonly DurationBucket[] = [
  "short",
  "half-day",
  "full-day",
  "multi-day",
];

export interface SearchState {
  q: string;
  priceBands: PriceBand[];
  categories: ExperienceCategory[];
  durations: DurationBucket[];
  minRating?: number;
  page: number;
}

export const EMPTY_SEARCH_STATE: SearchState = {
  q: "",
  priceBands: [],
  categories: [],
  durations: [],
  page: 1,
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function tokens<T extends string>(
  v: string | string[] | undefined,
  valid: readonly T[],
): T[] {
  const raw = first(v);
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is T => (valid as readonly string[]).includes(t));
}

export function parseSearchState(
  params: Record<string, string | string[] | undefined>,
): SearchState {
  const q = (first(params.q) ?? "").trim();
  const priceBands = tokens(params.priceBand, VALID_PRICE_BANDS);
  const categories = tokens(params.category, VALID_CATEGORIES);
  const durations = tokens(params.duration, VALID_DURATIONS);

  const rawRating = first(params.minRating);
  const parsedRating = rawRating !== undefined ? Number(rawRating) : NaN;
  const minRating = Number.isFinite(parsedRating)
    ? Math.min(5, Math.max(0, parsedRating))
    : undefined;

  const rawPage = first(params.page);
  const parsedPage = rawPage !== undefined ? Number(rawPage) : NaN;
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.trunc(parsedPage)) : 1;

  return { q, priceBands, categories, durations, minRating, page };
}

export function searchStateToQuery(state: SearchState): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.priceBands.length) p.set("priceBand", state.priceBands.join(","));
  if (state.categories.length) p.set("category", state.categories.join(","));
  if (state.durations.length) p.set("duration", state.durations.join(","));
  if (state.minRating !== undefined) p.set("minRating", String(state.minRating));
  if (state.page > 1) p.set("page", String(state.page));
  return p.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @folio/web exec jest src/lib/search-url.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/search-url.ts apps/web/src/lib/search-url.spec.ts
git commit -m "feat(web): search URL-state contract for /search (BRI-178, ST-16)"
```

---

## Task 2: Search + filter engine (`search-experiences.ts`)

**Files:**
- Create: `apps/web/src/lib/search-experiences.ts`
- Test: `apps/web/src/lib/search-experiences.spec.ts`

**Interfaces:**
- Consumes: `SearchState`, `DurationBucket` from `@/lib/search-url`; `getAllDestinations()` from `@/data/destinations-helpers`; `Destination`, `Experience`, `PriceBand`, `ExperienceCategory` from `@folio/shared`.
- Produces (relied on by Task 4):
  - `interface SearchResultExperience { type: "experience"; experience: Experience; destination: { slug: string; city: string; country: string }; score: number }`
  - `interface SearchResultDestination { type: "destination"; destination: Destination; score: number }`
  - `type SearchResult = SearchResultExperience | SearchResultDestination`
  - `interface FacetCount<T extends string> { value: T; count: number }`
  - `interface SearchFacets { priceBands: FacetCount<PriceBand>[]; categories: FacetCount<ExperienceCategory>[]; durations: FacetCount<DurationBucket>[] }`
  - `interface SearchOutcome { query: string; results: SearchResult[]; total: number; page: number; pageSize: number; totalPages: number; facets: SearchFacets }`
  - `function durationBucketOf(label: string | undefined): DurationBucket | null`
  - `function hasExperienceFilters(state: SearchState): boolean`
  - `function runSearch(state: SearchState, pageSize?: number): SearchOutcome`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/search-experiences.spec.ts
import { describe, expect, it } from "@jest/globals";
import { runSearch, durationBucketOf, hasExperienceFilters } from "@/lib/search-experiences";
import { EMPTY_SEARCH_STATE, type SearchState } from "@/lib/search-url";
import { getAllDestinations } from "@/data/destinations-helpers";

function state(over: Partial<SearchState> = {}): SearchState {
  return { ...EMPTY_SEARCH_STATE, ...over };
}

describe("durationBucketOf", () => {
  it("buckets known labels and nulls the unknown", () => {
    expect(durationBucketOf("Half day")).toBe("half-day");
    expect(durationBucketOf("1–2 hours")).toBe("short");
    expect(durationBucketOf("Evening")).toBe("short");
    expect(durationBucketOf("Full day")).toBe("full-day");
    expect(durationBucketOf("1–2 days")).toBe("multi-day");
    expect(durationBucketOf("banana")).toBeNull();
    expect(durationBucketOf(undefined)).toBeNull();
  });
});

describe("hasExperienceFilters", () => {
  it("is true when any experience-only filter is set", () => {
    expect(hasExperienceFilters(state())).toBe(false);
    expect(hasExperienceFilters(state({ priceBands: ["$"] }))).toBe(true);
    expect(hasExperienceFilters(state({ categories: ["Food & Drink"] }))).toBe(true);
    expect(hasExperienceFilters(state({ durations: ["short"] }))).toBe(true);
    expect(hasExperienceFilters(state({ minRating: 4 }))).toBe(true);
  });
});

describe("runSearch — featured (empty query)", () => {
  it("returns destinations first, then experiences, and counts everything", () => {
    const out = runSearch(state(), 200);
    const all = getAllDestinations();
    const expCount = all.reduce((n, d) => n + d.experiences.length, 0);
    expect(out.total).toBe(all.length + expCount);
    expect(out.results[0].type).toBe("destination");
    // a destination appears before any experience in the featured order
    const firstExp = out.results.findIndex((r) => r.type === "experience");
    const lastDest = out.results.map((r) => r.type).lastIndexOf("destination");
    expect(lastDest).toBeLessThan(firstExp);
  });
});

describe("runSearch — text query", () => {
  it("matches experiences by title/description/city, excludes non-matches", () => {
    // 'temple' is a Bangkok-heavy term in the static data.
    const out = runSearch(state({ q: "temple" }), 200);
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      const hay =
        r.type === "experience"
          ? `${r.experience.title} ${r.experience.description} ${r.experience.category} ${r.destination.city} ${r.destination.country}`
          : `${r.destination.city} ${r.destination.country} ${r.destination.tagline}`;
      expect(hay.toLowerCase()).toContain("temple");
    }
  });

  it("returns an empty result set (not an error) for a nonsense query", () => {
    const out = runSearch(state({ q: "zzzzqxwv" }), 200);
    expect(out.results).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.totalPages).toBe(1);
  });
});

describe("runSearch — filters", () => {
  it("ANDs priceBand + category and drops destinations once a filter is set", () => {
    const out = runSearch(state({ priceBands: ["$"], categories: ["Food & Drink"] }), 200);
    expect(out.results.every((r) => r.type === "experience")).toBe(true);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(r.experience.priceBand).toBe("$");
      expect(r.experience.category).toBe("Food & Drink");
    }
  });

  it("filters by duration bucket", () => {
    const out = runSearch(state({ durations: ["multi-day"] }), 200);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(durationBucketOf(r.experience.duration)).toBe("multi-day");
    }
  });

  it("minRating excludes experiences with no rating (honest partial data)", () => {
    // viator-links.json is empty today → no static experience has a rating →
    // a minRating filter legitimately yields zero results.
    const out = runSearch(state({ minRating: 4 }), 200);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(typeof r.experience.rating).toBe("number");
      expect(r.experience.rating!).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("runSearch — facets & pagination", () => {
  it("reports facet counts over the query-matched experiences", () => {
    const out = runSearch(state({ q: "" }), 200);
    const totalFacetPrice = out.facets.priceBands.reduce((n, f) => n + f.count, 0);
    const expCount = getAllDestinations().reduce((n, d) => n + d.experiences.length, 0);
    expect(totalFacetPrice).toBe(expCount);
    expect(out.facets.categories.length).toBeGreaterThan(0);
  });

  it("paginates deterministically", () => {
    const p1 = runSearch(state({ page: 1 }), 5);
    const p2 = runSearch(state({ page: 2 }), 5);
    expect(p1.results.length).toBe(5);
    expect(p1.pageSize).toBe(5);
    expect(p1.results).not.toEqual(p2.results);
    expect(p1.totalPages).toBe(Math.ceil(p1.total / 5));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @folio/web exec jest src/lib/search-experiences.spec.ts`
Expected: FAIL — "Cannot find module '@/lib/search-experiences'".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/search-experiences.ts
/**
 * Pure search + filter engine for /search (ST-13 free-text, ST-16 facets),
 * over the STATIC content system — see the plan's Decision 1 for why static,
 * not the live `GET /v1/search`, is the source today. No next/posthog imports,
 * so ts-jest runs this in node.
 *
 * Shape and semantics deliberately echo the API service (mixed Experience +
 * Destination results; destinations excluded once an experience-only filter is
 * set; empty query = "featured" with destinations first) so swapping this for a
 * live `fetch('/v1/search?...')` later is a data-layer change behind the same
 * URL params (search-url.ts) and the same cards.
 */
import type {
  Destination,
  Experience,
  ExperienceCategory,
  PriceBand,
} from "@folio/shared";
import { getAllDestinations } from "@/data/destinations-helpers";
import type { DurationBucket, SearchState } from "@/lib/search-url";

const DEFAULT_PAGE_SIZE = 12;

export interface SearchResultExperience {
  type: "experience";
  experience: Experience;
  destination: { slug: string; city: string; country: string };
  score: number;
}
export interface SearchResultDestination {
  type: "destination";
  destination: Destination;
  score: number;
}
export type SearchResult = SearchResultExperience | SearchResultDestination;

export interface FacetCount<T extends string> {
  value: T;
  count: number;
}
export interface SearchFacets {
  priceBands: FacetCount<PriceBand>[];
  categories: FacetCount<ExperienceCategory>[];
  durations: FacetCount<DurationBucket>[];
}
export interface SearchOutcome {
  query: string;
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: SearchFacets;
}

const DURATION_LABEL_TO_BUCKET: Record<string, DurationBucket> = {
  "1 hour": "short",
  "1–2 hours": "short",
  "2 hours": "short",
  "2–3 hours": "short",
  Evening: "short",
  "Half day": "half-day",
  "Full day": "full-day",
  "1–2 days": "multi-day",
};

export function durationBucketOf(label: string | undefined): DurationBucket | null {
  if (!label) return null;
  return DURATION_LABEL_TO_BUCKET[label] ?? null;
}

/**
 * True when any experience-only filter is set. Destinations carry no price,
 * category, duration, or rating, so when this is true destinations are dropped
 * entirely — mirroring the API's `hasExperienceFilters` AND-contract exception.
 */
export function hasExperienceFilters(state: SearchState): boolean {
  return Boolean(
    state.priceBands.length ||
      state.categories.length ||
      state.durations.length ||
      state.minRating !== undefined,
  );
}

interface Corpus {
  experiences: SearchResultExperience[];
  destinations: SearchResultDestination[];
}

/** Flatten the static content into a mixed, still-unfiltered corpus. */
function buildCorpus(): Corpus {
  const destinations = getAllDestinations();
  const exp: SearchResultExperience[] = [];
  const dest: SearchResultDestination[] = [];
  for (const d of destinations) {
    dest.push({ type: "destination", destination: d, score: 0 });
    for (const e of d.experiences) {
      exp.push({
        type: "experience",
        experience: e,
        destination: { slug: d.slug, city: d.city, country: d.country },
        score: 0,
      });
    }
  }
  return { experiences: exp, destinations: dest };
}

function experienceHaystack(r: SearchResultExperience): string {
  const e = r.experience;
  return `${e.title} ${e.description} ${e.category} ${r.destination.city} ${r.destination.country}`.toLowerCase();
}

function destinationHaystack(r: SearchResultDestination): string {
  const d = r.destination;
  return `${d.city} ${d.country} ${d.tagline} ${d.knownFor.join(" ")} ${d.intro.join(" ")}`.toLowerCase();
}

/** Token score: +2 if title/name contains the token, +1 for any other field. */
function scoreExperience(r: SearchResultExperience, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = r.experience.title.toLowerCase();
  const hay = experienceHaystack(r);
  let score = 0;
  for (const t of tokens) {
    if (!hay.includes(t)) return -1; // AND: every token must appear somewhere
    score += title.includes(t) ? 2 : 1;
  }
  return score;
}

function scoreDestination(r: SearchResultDestination, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = `${r.destination.city} ${r.destination.country}`.toLowerCase();
  const hay = destinationHaystack(r);
  let score = 0;
  for (const t of tokens) {
    if (!hay.includes(t)) return -1;
    score += name.includes(t) ? 2 : 1;
  }
  return score;
}

function matchesFilters(r: SearchResultExperience, state: SearchState): boolean {
  const e = r.experience;
  if (state.priceBands.length && !state.priceBands.includes(e.priceBand)) return false;
  if (state.categories.length && !state.categories.includes(e.category)) return false;
  if (state.durations.length) {
    const bucket = durationBucketOf(e.duration);
    if (bucket === null || !state.durations.includes(bucket)) return false;
  }
  if (state.minRating !== undefined) {
    if (typeof e.rating !== "number" || e.rating < state.minRating) return false;
  }
  return true;
}

function countFacet<T extends string>(
  items: SearchResultExperience[],
  pick: (e: Experience) => T | null,
): FacetCount<T>[] {
  const counts = new Map<T, number>();
  for (const r of items) {
    const v = pick(r.experience);
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function runSearch(state: SearchState, pageSize = DEFAULT_PAGE_SIZE): SearchOutcome {
  const q = state.q.trim().toLowerCase();
  const tokens = q.length ? q.split(/\s+/).filter(Boolean) : [];
  const corpus = buildCorpus();
  const dropDestinations = hasExperienceFilters(state);

  // 1. Text-match both entity types.
  const matchedExperiences = corpus.experiences
    .map((r) => ({ ...r, score: scoreExperience(r, tokens) }))
    .filter((r) => r.score >= 0);
  const matchedDestinations = dropDestinations
    ? []
    : corpus.destinations
        .map((r) => ({ ...r, score: scoreDestination(r, tokens) }))
        .filter((r) => r.score >= 0);

  // 2. Facet counts over the query-matched experiences (before facet filters),
  //    so each chip shows how many results it would yield.
  const facets: SearchFacets = {
    priceBands: countFacet<PriceBand>(matchedExperiences, (e) => e.priceBand),
    categories: countFacet<ExperienceCategory>(matchedExperiences, (e) => e.category),
    durations: countFacet<DurationBucket>(matchedExperiences, (e) => durationBucketOf(e.duration)),
  };

  // 3. Apply facet filters to experiences.
  const filteredExperiences = matchedExperiences.filter((r) => matchesFilters(r, state));

  // 4. Merge + order. Empty query = featured (destinations first, data order);
  //    otherwise score-sorted with a stable title/name tie-break.
  let ordered: SearchResult[];
  if (tokens.length === 0) {
    ordered = [...matchedDestinations, ...filteredExperiences];
  } else {
    ordered = [...filteredExperiences, ...matchedDestinations].sort(
      (a, b) => b.score - a.score || sortName(a).localeCompare(sortName(b)),
    );
  }

  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, state.page), totalPages);
  const start = (page - 1) * pageSize;
  const results = ordered.slice(start, start + pageSize);

  return { query: state.q.trim(), results, total, page, pageSize, totalPages, facets };
}

function sortName(r: SearchResult): string {
  return r.type === "experience" ? r.experience.title : r.destination.city;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @folio/web exec jest src/lib/search-experiences.spec.ts`
Expected: PASS. (If the `q: "temple"` test finds zero matches because the static data phrasing differs, switch the probe term to one present in `destinations.ts` — e.g. `"market"` or `"food"` — confirmed present via `grep -i temple apps/web/src/data/destinations.ts`; do this before changing engine logic.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/search-experiences.ts apps/web/src/lib/search-experiences.spec.ts
git commit -m "feat(web): static search + filter engine for /search (BRI-178, ST-13/16)"
```

---

## Task 3: Search analytics helper (`analytics.ts`)

**Files:**
- Modify: `apps/web/src/lib/analytics.ts` (append after `trackToursCompared`)

**Interfaces:**
- Produces (relied on by Task 4):
  - `type SearchAnalyticsInput = { query: string; resultCount: number; priceBands: string[]; categories: string[]; durations: string[]; minRating?: number }`
  - `function trackSearch(input: SearchAnalyticsInput): void`

- [ ] **Step 1: Add the helper**

```ts
// append to apps/web/src/lib/analytics.ts

/**
 * Capture a search execution (ST-13/16). `result_count === 0` is the deliberate
 * content-gap signal — a future admin/analytics pass reads zero-result queries
 * to find demand the catalogue doesn't yet cover (see the plan's Decision 5).
 */
export type SearchAnalyticsInput = {
  query: string;
  resultCount: number;
  priceBands: string[];
  categories: string[];
  durations: string[];
  minRating?: number;
};

export function trackSearch(input: SearchAnalyticsInput): void {
  posthog.capture("search_performed", {
    query: input.query,
    query_length: input.query.length,
    result_count: input.resultCount,
    zero_results: input.resultCount === 0,
    price_bands: input.priceBands,
    categories: input.categories,
    durations: input.durations,
    min_rating: input.minRating,
    filter_count:
      input.priceBands.length +
      input.categories.length +
      input.durations.length +
      (input.minRating !== undefined ? 1 : 0),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @folio/web typecheck`
Expected: PASS (no new errors). No jest test — `analytics.ts` has no spec by convention (it is a thin `posthog.capture` wrapper verified by typecheck + build, like `trackAffiliateClick`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/analytics.ts
git commit -m "feat(web): trackSearch analytics event with zero-result signal (BRI-178)"
```

---

## Task 4: /search page + client islands

**Files:**
- Create: `apps/web/src/app/search/page.tsx`
- Create: `apps/web/src/app/search/SearchControls.tsx`
- Create: `apps/web/src/app/search/SearchAnalytics.tsx`

**Interfaces:**
- Consumes: `parseSearchState`, `searchStateToQuery`, `SearchState`, `VALID_PRICE_BANDS`, `VALID_CATEGORIES`, `VALID_DURATIONS`, `DurationBucket` (Task 1); `runSearch`, `SearchOutcome`, `SearchResult` (Task 2); `trackSearch` (Task 3); `ExperienceRowCard`, `DestinationCard`, `CovillaHeader`, `CovillaFooter`, `getNavDestinations`, `site`.
- Produces: the `/search` route. No later task consumes its internals.

- [ ] **Step 1: Build the client controls island**

```tsx
// apps/web/src/app/search/SearchControls.tsx
"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  VALID_PRICE_BANDS,
  VALID_CATEGORIES,
  VALID_DURATIONS,
  searchStateToQuery,
  type DurationBucket,
  type SearchState,
} from "@/lib/search-url";
import type { SearchFacets } from "@/lib/search-experiences";
import type { ExperienceCategory, PriceBand } from "@folio/shared";

const DURATION_LABELS: Record<DurationBucket, string> = {
  short: "A few hours",
  "half-day": "Half day",
  "full-day": "Full day",
  "multi-day": "Multi-day",
};

/**
 * Query input + facet chips for /search. The only source of truth is the URL:
 * every change writes a new query string via router.replace, and the server
 * component re-runs the engine from those params (plan Decision 4). Toggling any
 * filter resets to page 1.
 */
export function SearchControls({
  state,
  facets,
}: {
  state: SearchState;
  facets: SearchFacets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState(state.q);

  function push(next: SearchState) {
    const qs = searchStateToQuery(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function submitQuery(e: React.FormEvent) {
    e.preventDefault();
    push({ ...state, q: draft.trim(), page: 1 });
  }

  function toggle<T extends string>(key: "priceBands" | "categories" | "durations", value: T) {
    const current = state[key] as T[];
    const nextList = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    // Cast the whole object: the computed key + typed value keep the shape
    // correct, but TS can't narrow a computed-property spread on its own.
    push({ ...state, [key]: nextList, page: 1 } as SearchState);
  }

  const priceCount = (b: PriceBand) => facets.priceBands.find((f) => f.value === b)?.count ?? 0;
  const catCount = (c: ExperienceCategory) =>
    facets.categories.find((f) => f.value === c)?.count ?? 0;
  const durCount = (d: DurationBucket) => facets.durations.find((f) => f.value === d)?.count ?? 0;

  const hasFilters =
    state.priceBands.length || state.categories.length || state.durations.length || state.q;

  return (
    <div className="space-y-6">
      <form onSubmit={submitQuery} role="search" className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search experiences and destinations…"
          aria-label="Search experiences and destinations"
          className="w-full rounded-[3px] border border-line bg-white py-3.5 pl-11 pr-4 text-[15px] text-ink outline-none focus:border-accent"
        />
      </form>

      <Facet label="Price">
        {VALID_PRICE_BANDS.filter((b) => priceCount(b) > 0 || state.priceBands.includes(b)).map(
          (b) => (
            <Chip
              key={b}
              active={state.priceBands.includes(b)}
              onClick={() => toggle("priceBands", b)}
              label={`${b} (${priceCount(b)})`}
            />
          ),
        )}
      </Facet>

      <Facet label="Category">
        {VALID_CATEGORIES.filter((c) => catCount(c) > 0 || state.categories.includes(c)).map((c) => (
          <Chip
            key={c}
            active={state.categories.includes(c)}
            onClick={() => toggle("categories", c)}
            label={`${c} (${catCount(c)})`}
          />
        ))}
      </Facet>

      <Facet label="Duration">
        {VALID_DURATIONS.filter((d) => durCount(d) > 0 || state.durations.includes(d)).map((d) => (
          <Chip
            key={d}
            active={state.durations.includes(d)}
            onClick={() => toggle("durations", d)}
            label={`${DURATION_LABELS[d]} (${durCount(d)})`}
          />
        ))}
      </Facet>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            push({ q: "", priceBands: [], categories: [], durations: [], page: 1 });
          }}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-muted hover:text-ink"
        >
          <X size={14} aria-hidden /> Clear all
        </button>
      ) : null}
    </div>
  );
}

function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(kids) && kids.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-white text-ink-soft hover:border-ink hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Build the analytics island**

```tsx
// apps/web/src/app/search/SearchAnalytics.tsx
"use client";

import { useEffect, useRef } from "react";
import { trackSearch } from "@/lib/analytics";
import type { SearchState } from "@/lib/search-url";

/**
 * Fires `search_performed` once per distinct (query+filters+resultCount) view,
 * so the server-computed `resultCount` — including the zero-result content-gap
 * signal (plan Decision 5) — is captured without any inline posthog.capture.
 */
export function SearchAnalytics({
  state,
  resultCount,
}: {
  state: SearchState;
  resultCount: number;
}) {
  const key = JSON.stringify([
    state.q,
    state.priceBands,
    state.categories,
    state.durations,
    state.minRating,
    resultCount,
  ]);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    // Don't log the bare, untouched browse view as a "search".
    if (
      !state.q &&
      !state.priceBands.length &&
      !state.categories.length &&
      !state.durations.length &&
      state.minRating === undefined
    ) {
      return;
    }
    trackSearch({
      query: state.q,
      resultCount,
      priceBands: state.priceBands,
      categories: state.categories,
      durations: state.durations,
      minRating: state.minRating,
    });
  }, [key, state, resultCount]);

  return null;
}
```

- [ ] **Step 3: Build the page (RSC)**

```tsx
// apps/web/src/app/search/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
import { DestinationCard } from "@/components/DestinationCard";
import { getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";
import { parseSearchState } from "@/lib/search-url";
import { runSearch, type SearchResult } from "@/lib/search-experiences";
import { SearchControls } from "./SearchControls";
import { SearchAnalytics } from "./SearchAnalytics";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const state = parseSearchState(await searchParams);
  const filtered =
    Boolean(state.q) ||
    state.priceBands.length > 0 ||
    state.categories.length > 0 ||
    state.durations.length > 0 ||
    state.minRating !== undefined;
  const title = state.q ? `Search: ${state.q}` : "Search experiences";
  return {
    title,
    description:
      "Search and filter Folio Voyage's curated experiences and destinations by price, category, and duration.",
    alternates: { canonical: "/search" },
    // Filtered/query permutations are thin, near-duplicate pages — keep them out
    // of the index but let crawlers follow links out to canonical pages.
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: { title: `${title} · ${site.name}`, url: `${site.url}/search` },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const state = parseSearchState(sp);
  const nav = getNavDestinations();
  const outcome = runSearch(state);

  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="pt-20">
        <section className="border-b border-line bg-surface">
          <div className="container-page py-12 md:py-16">
            <p className="eyebrow">Find your experience</p>
            <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] md:text-[48px]">
              Search
            </h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-ink-soft">
              Search across every hand-picked experience and destination, then
              refine by price, category, and duration.
            </p>
          </div>
        </section>

        <section className="container-page grid gap-10 py-12 md:grid-cols-[280px_1fr] md:py-16">
          <aside className="md:sticky md:top-24 md:self-start">
            <SearchControls state={state} facets={outcome.facets} />
          </aside>

          <div>
            <p className="eyebrow mb-6" aria-live="polite">
              {outcome.total} {outcome.total === 1 ? "result" : "results"}
              {outcome.query ? ` for “${outcome.query}”` : ""}
            </p>

            {outcome.results.length === 0 ? (
              <EmptyState query={outcome.query} />
            ) : (
              <div className="space-y-6">
                {outcome.results.map((r) => (
                  <ResultCard key={resultKey(r)} result={r} />
                ))}
              </div>
            )}

            {outcome.totalPages > 1 ? (
              <Pagination
                page={outcome.page}
                totalPages={outcome.totalPages}
                searchParams={sp}
              />
            ) : null}
          </div>
        </section>
      </main>

      <CovillaFooter />
      <SearchAnalytics state={state} resultCount={outcome.total} />
    </>
  );
}

function resultKey(r: SearchResult): string {
  return r.type === "experience"
    ? `e:${r.destination.slug}:${r.experience.id}`
    : `d:${r.destination.slug}`;
}

function ResultCard({ result }: { result: SearchResult }) {
  if (result.type === "destination") {
    return <DestinationCard destination={result.destination} />;
  }
  return (
    <ExperienceRowCard
      experience={result.experience}
      destination={{
        slug: result.destination.slug,
        city: result.destination.city,
        country: result.destination.country,
      }}
    />
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-[3px] border border-dashed border-line bg-white/60 px-8 py-16 text-center">
      <SearchX size={32} className="mx-auto text-muted" aria-hidden />
      <p className="mt-4 text-[18px] font-medium text-ink">
        {query ? `No results for “${query}”` : "No results match those filters"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-ink-soft">
        Try a broader term or clear a filter. You can also browse every guide on
        the destinations page.
      </p>
      <Link
        href="/destinations"
        className="mt-6 inline-flex items-center rounded-[2px] border border-accent px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
      >
        Browse destinations
      </Link>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: SP;
}) {
  const href = (p: number) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === "string") usp.set(k, v);
    }
    if (p > 1) usp.set("page", String(p));
    else usp.delete("page");
    const qs = usp.toString();
    return qs ? `/search?${qs}` : "/search";
  };
  return (
    <nav className="mt-10 flex items-center justify-between" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className="eyebrow hover:text-ink">
          ← Previous
        </Link>
      ) : (
        <span className="eyebrow opacity-40">← Previous</span>
      )}
      <span className="text-[13px] text-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className="eyebrow hover:text-ink">
          Next →
        </Link>
      ) : (
        <span className="eyebrow opacity-40">Next →</span>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Build + typecheck + lint**

Run:
```bash
pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint && pnpm --filter @folio/web build
```
Expected: build succeeds; `/search` prerenders. Fix any type/lint errors (common: `cn` import path is `@/lib/cn`; `container-page`, `eyebrow`, `surface`, `line`, `ink-soft`, `accent` are existing Tailwind tokens — confirm against `ExperienceRowCard`/`destinations/page.tsx` if a class is rejected).

- [ ] **Step 5: Browser-verify the four required behaviors**

Start the dev server (preview_start `{name:"web"}` or add a `.claude/launch.json` web entry) and confirm:
1. Query matching: `/search?q=food` renders only matching cards; the `N results for "food"` line is correct.
2. Filter combination in URL: click a Price and a Category chip → URL gains `?priceBand=…&category=…`, results narrow, destinations disappear; reload the URL → identical results (ST-16 AC).
3. Partial data: an unmatched experience card shows its price band + "Booking soon" (no invented rating), i.e. the em-dash/omission pattern via `ExperienceRowCard`.
4. Empty state: `/search?q=zzzzq` shows the styled `EmptyState`; confirm a `search_performed` event with `zero_results: true` in `read_console_messages`/PostHog network (or verify the `trackSearch` call fires via a console log temporarily).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/search/
git commit -m "feat(web): /search page with URL-reflected filters and honest empty state (BRI-178, ST-13/16)"
```

---

## Task 5: Nav entry point + sitemap

**Files:**
- Modify: `apps/web/src/components/covilla/CovillaHeader.tsx`
- Modify: `apps/web/src/app/sitemap.ts`
- Modify: `apps/web/src/app/sitemap.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `/search` link in the primary nav + flyout; `/search` in the sitemap.

- [ ] **Step 1: Write the failing sitemap test**

```ts
// add inside apps/web/src/app/sitemap.spec.ts, in the existing describe("sitemap", ...)
  it("lists the /search page", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    expect(urls.has(`${site.url}/search`)).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @folio/web exec jest src/app/sitemap.spec.ts`
Expected: FAIL — `/search` not present.

- [ ] **Step 3: Add `/search` to the sitemap**

In `apps/web/src/app/sitemap.ts`, add to `staticRoutes` (after the `/destinations` entry):

```ts
    {
      url: `${site.url}/search`,
      changeFrequency: "weekly",
      priority: 0.6,
      lastModified: now,
    },
```

- [ ] **Step 4: Run the sitemap test to verify it passes**

Run: `pnpm --filter @folio/web exec jest src/app/sitemap.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add a Search entry to the header nav**

In `apps/web/src/components/covilla/CovillaHeader.tsx`:

Add an active-path flag next to the existing ones (after `const onBlog = …`):
```ts
  const onSearch = pathname?.startsWith("/search");
```

Add a nav link in the primary `<nav>` (before the `The Folio` link, around line 214):
```tsx
            <Link href="/search" className={navLink(Boolean(onSearch))}>
              Search
            </Link>
```

Add a link to the flyout's "More" list (in the `FlyoutMenu` array around line 351):
```tsx
                { href: "/search", label: "Search" },
```

- [ ] **Step 6: Typecheck + build**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web build`
Expected: PASS. Browser-verify the header "Search" link routes to `/search` and shows active styling when there.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/covilla/CovillaHeader.tsx apps/web/src/app/sitemap.ts apps/web/src/app/sitemap.spec.ts
git commit -m "feat(web): link /search from nav + sitemap (BRI-178)"
```

---

## Final verification (whole feature)

- [ ] `pnpm --filter @folio/web test` — all specs pass (search-url, search-experiences, sitemap).
- [ ] `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint && pnpm --filter @folio/web build` — clean.
- [ ] Browser: run through the four ST-16/ST-13 behaviors (query, URL-reflected filters + reload reproduces, partial data, empty state) one more time on a production build (`pnpm --filter @folio/web build && pnpm --filter @folio/web start`).
- [ ] Open a PR into `master` (do **not** deploy; do **not** touch Linear — the human closes BRI-178).

---

# Part B — Blog → Guides rename (independent; do AFTER /search plan is reviewed)

> This is a distinct, smaller task. It does **not** block /search and is reported separately. Discard all 10 blog posts (confirmed, no migration). Rename the route/section from `/blog` to `/guides` (product-bible naming); the new section ships **empty** — real guide content is future scope. No real guide copy is written here.

**Files:**
- Move: `apps/web/src/app/blog/` → `apps/web/src/app/guides/` (delete the `[slug]/` dynamic route entirely).
- Replace: `apps/web/src/app/guides/page.tsx` with an empty-section placeholder index (no `posts` import).
- Delete: `apps/web/src/data/blog.ts` **only after** all imports are gone (sitemap, any `covilla/Blog*` components). If `covilla/BlogSection.tsx`/`BlogBody.tsx`/`BlogPersonaGrid.tsx`/`BlogFeaturedDestination.tsx` are unused post-rename, delete them; if still referenced by the homepage, leave them and just stop routing to `/blog`. Verify with `grep -rn "data/blog\|/blog\|BlogSection\|BlogBody" apps/web/src`.
- Modify nav: `CovillaHeader.tsx` (change `The Folio` → `Guides`, `href="/blog"` → `/guides`, `onBlog` → `onGuides`, and the flyout `The Folio — blog` entry → `Guides`) **and** `SiteHeader.tsx` (the earlier audit flagged these two nav lists as inconsistent — while here, ensure both point at `/guides`; `SiteHeader.navLinks` currently has no blog entry, so just confirm consistency, don't force-add one unless the homepage uses `SiteHeader`).
- Modify: `apps/web/src/app/sitemap.ts` — replace the `/blog` static entry with `/guides`; delete the `blogRoutes` block (and its `posts` import) since there are no posts.
- Modify: `apps/web/src/app/sitemap.spec.ts` — drop/replace any blog-post assertion; assert `/guides` present, `/blog` absent.

**Steps (TDD where a pure surface exists — here it's mostly routing + sitemap):**

- [ ] Update `sitemap.spec.ts`: assert `urls.has(`${site.url}/guides`)` true and `/blog` false. Run → fails.
- [ ] Rename the route dir, delete `[slug]`, write the empty `/guides` index page (chrome + "Guides — coming soon" panel, `CovillaHeader`/`CovillaFooter`, `alternates.canonical: "/guides"`).
- [ ] Update `sitemap.ts` (swap entry, remove `blogRoutes` + `posts` import). Run sitemap spec → passes.
- [ ] Update `CovillaHeader.tsx` + `SiteHeader.tsx` nav.
- [ ] `grep -rn "/blog\|data/blog" apps/web/src` → expect no live references; delete `data/blog.ts` and any now-orphaned `covilla/Blog*` components.
- [ ] `pnpm --filter @folio/web test && typecheck && lint && build` → clean. Browser-verify `/guides` renders, nav points there, `/blog` 404s.
- [ ] Commit: `refactor(web): rename /blog → /guides, drop placeholder posts (BRI-178 follow-up)`.
```
