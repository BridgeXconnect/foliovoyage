# ST-17 — Experience Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every curated experience its own indexable detail page — an "evaluate this option" page a search result or destination-list card links into — reusing the existing static content system, the `/go` affiliate redirect, and the existing SEO patterns.

**Architecture:** A new SSG route `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx`, nested under the already-canonical `/destinations/:slug` editorial page. It reads the same static `destinations` data the destination page uses, renders enrichment facts + a single "booking option" block (provider price/rating/free-cancellation) + a CTA routed through the existing `/go/:slug/:id` redirect, and emits `Product` + `BreadcrumbList` JSON-LD. All page-derivable logic (data lookup, static-param enumeration, CTA/href, metadata + JSON-LD) is extracted into pure, unit-tested modules; a new ts-jest harness (mirroring `apps/api`) runs them in CI.

**Tech Stack:** Next.js 15 (App Router, RSC, SSG), React 19, TypeScript 5.9, Tailwind v4, `@folio/shared` domain types, jest 30 + ts-jest 29 (new to `apps/web`, mirrors `apps/api`).

**Spec:** `docs/03-engineering-specification.md` ST-17 (EP-6). AC verbatim: _"Experience page shows enrichment facts, aggregated tours, imported rating + count with provider attribution; tour page shows price snapshot (timestamped) + inclusions."_ Traces FR-DEST-3, FR-REV-1.

## Global Constraints

- **Node 22, pnpm 11 via corepack.** Run commands from repo root unless noted.
- **Do not deploy.** Build/verify locally only (CLAUDE.md; no Render/Vercel triggers).
- **Two content systems must not be conflated** (CLAUDE.md). This story builds on the **static** system (`apps/web/src/data/destinations.ts` + `viator-links.json`), the one the live/indexed site actually runs on. See Findings §2.
- **Affiliate CTA routes through the existing `/go/:slug/:id` redirect only** (BRI-136). No second link-handling path. This is expected to be revisited when BRI-137/138 lands; today's link logic is not treated as final. See Findings §3.
- **"Match, don't overwrite"** (docs/07, docs/02 §1.3): provider commerce signals are additive badges; never replace editorial `title`/`description`/`priceBand`.
- **No fake data.** No invented timestamps, ratings, or inclusions. Missing fields render as honest absence, not placeholders. See Findings §6.
- **SSG, `dynamicParams = false`** — every detail page is prerendered from known static data; an unknown slug/id 404s.
- Every new pure module lives in `apps/web/src/lib/` and imports **no** `next/*` and **no** client-only modules (`posthog-js`), so ts-jest runs it in a node env with no transform of React/Next.

---

## Key Findings & Decision (read before implementing)

These are the "flag it explicitly" findings the task asked for. The decision below is the one to review; everything downstream depends on it.

### §1 — There is no detail endpoint and no slug on `Experience`/`Tour`
- The API exposes only `GET /v1/destinations/:country/:city` (list) and `GET /v1/search` (list). Both return **list-shaped** DTOs (`ExperienceResponse`, `SearchExperienceResult`) that omit fields a detail page wants: duration, `ratingCount`, currency, exact price, lat/lng, inclusions. There is **no** `GET /experiences/:id` / `/tours/:id`.
- Neither `Experience` nor `Tour` has an Atlas-owned `slug` (schema comment: deliberately absent). So the doc IA's `/experiences/:slug` / `/tours/:slug` (docs/01 §6.1, docs/02 §4.3) is **not buildable as written** against today's schema.

### §2 — Static/DB duality: the live surface is static; the DB destination page is a redirect stub
- The canonical, indexed destination page `apps/web/src/app/destinations/[slug]/page.tsx` renders **entirely from static data** (`getDestination`, `ExperienceRowCard`). It is SSG and in the sitemap.
- The DB-backed `apps/web/src/app/destinations/[slug]/[city]/page.tsx` is now a **308 redirect stub** (BRI-166) → it forwards to the canonical short URL and is deliberately excluded from the sitemap. `DbExperienceCard` is dormant.
- **Consequence:** a DB-experience detail page would be an island with no indexed inbound-link surface. The static experiences, by contrast, are already rendered, linked, and indexed.

### §3 — `/go/:slug/:id` only resolves **static** keys today
- `apps/web/src/app/go/[slug]/[id]/route.ts` resolves `:slug/:id` against `viator-links.json` (keys `"<citySlug>/<experienceId>"`) and 404s unknown keys. It has **no** path to a DB `Tour.affiliateUrl`. Routing a DB experience's CTA through `/go` would 404 today — that gap is exactly BRI-137/138 territory (provider-correct deep links / link-health), which is being held until after this lands.
- Static experiences already route their CTA through `/go/:slug/:id` correctly (see `ExperienceRowCard`), so building against the static system means the CTA works **today** with zero new link logic.

### §4 — Route-collision constraint fixes the URL shape
- `destinations/[slug]/[city]/` already occupies the `destinations/[slug]/<one-dynamic-segment>` slot. A sibling `destinations/[slug]/[experienceId]/` is a **Next.js dynamic-segment name collision** and is disallowed.
- Nesting under a **named** segment avoids it and reads as the canonical hierarchy: **`/destinations/:slug/experiences/:experienceId`** (3 segments; no collision with the 2-segment `[city]` redirect). This is the chosen URL.

### §5 — DECISION
Build ST-17 as **static experience detail pages** at **`/destinations/:slug/experiences/:experienceId`**, SSG, reusing the static content system, the `/go` CTA, and the existing metadata/JSON-LD patterns. Extend the existing (still-fitting) structure rather than inventing a new one.

**Explicitly deferred (flagged, not silently skipped):**
- **DB-backed detail** (against `Experience`/`Tour`) — needs (a) a new `GET /v1/experiences/:id` detail endpoint, (b) an indexable inbound surface (the DB destination page is a redirect stub), and (c) `/go` support for DB keys (BRI-137/138). None exist yet. Revisit when the DB path becomes the live surface.
- **Separate `/tours/:slug` pages** — at MVP experience≈tour is 1:1 (schema: `Tour.experienceId`, "1:1 in practice"). The single "booking option" block on the experience page **is** the tour view (price/provider/rating/duration/free-cancellation). A distinct tour URL only earns its keep once one experience aggregates *multiple* tours — a DB-model future (ST-12), not a static-model reality.
- **Timestamped price snapshot** — the AC says "price snapshot (timestamped)". Static data carries no per-price fetch timestamp; `viator-links.json` entries have none. We render the provider "from" price with honest framing ("final price shown by the provider at booking") and **no fabricated timestamp**. True timestamped snapshots need `Tour.updatedAt` from the DB path — deferred with the rest of the DB work.

### §6 — Documentation drift (surfaced, minimally reconciled here)
- docs/01 §6.1 and docs/02 §4.3/§6.1 describe flat, slug-based, separate `/experiences/:slug` + `/tours/:slug` detail pages. Reality (post-BRI-166, current schema): destination-nested URL, id-not-slug, experience≈tour 1:1. **Authoritative doc question:** doc 02 is the HOW/IA source of truth per CLAUDE.md, but its IA section **predates** BRI-166's redirect decision (which lives only in code + the BRI-166 docstring). So doc 02 is stale on this point, not authoritative-as-written.
- This plan does **not** rewrite the IA sections (out of ST-17 scope, and the task says don't touch Linear). Task 7 adds a **single as-built note** to doc 03's ST-17 line pointing at the real URL + the deferred-DB finding, so the next reader isn't misled and the drift is logged rather than silently widened. A full doc-02 IA reconciliation is left as a follow-up.

---

## File Structure

**New (source):**
- `apps/web/src/lib/experience-detail.ts` — pure helpers: `findExperienceDetail`, `listExperienceDetailParams`, `experienceDetailPath`, `experienceGoHref`, `experienceDetailAffiliateInput`. No `next`/`posthog` imports.
- `apps/web/src/lib/experience-detail-seo.ts` — pure builders: `buildExperienceMetadata`, `buildExperienceProductLd`, `buildExperienceBreadcrumbLd`. Take `siteUrl` as a param (no env/`next` coupling).
- `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx` — the RSC page (SSG): `generateStaticParams`, `generateMetadata`, render. Thin — delegates to the two lib modules + a presentational body.
- `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/ExperienceDetailCta.tsx` — `"use client"` CTA (mirrors `ExperienceRowCard`'s live/coming-soon split; fires `trackAffiliateClick`). Isolates the only client-side concern.

**New (tests + harness):**
- `apps/web/jest.config.js` — ts-jest config mirroring `apps/api/jest.config.js`, plus `@/`+`@folio/shared` module mapping.
- `apps/web/src/lib/experience-detail.spec.ts`
- `apps/web/src/lib/experience-detail-seo.spec.ts`
- `apps/web/src/app/sitemap.spec.ts`

**Modified:**
- `apps/web/package.json` — add `"test": "jest"` + devDeps (`jest`, `ts-jest`, `@jest/globals`).
- `apps/web/src/components/covilla/ExperienceRowCard.tsx` — make the card title link to the detail page (inbound link; no other behaviour change).
- `apps/web/src/app/sitemap.ts` — emit the per-experience detail URLs.

**Read-only references (do not modify):** `destinations-helpers.ts`, `@folio/shared`, `go/[slug]/[id]/route.ts`, `lib/site.ts`, `lib/analytics.ts`, `destinations/[slug]/page.tsx` (SEO pattern to mirror).

---

### Task 1: Add a ts-jest test harness to `apps/web`

**Files:**
- Create: `apps/web/jest.config.js`
- Create: `apps/web/src/lib/__harness__.spec.ts` (temporary wiring proof, deleted in Step 6)
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: a working `pnpm --filter @folio/web test` that ts-jest runs over `*.spec.ts`, with `@/*` → `src/*` and `@folio/shared` resolved. Later tasks rely on this.

- [ ] **Step 1: Add the test script + devDeps to `apps/web/package.json`**

In `"scripts"`, add `"test": "jest"`. In `"devDependencies"`, add (match `apps/api`'s versions exactly):

```json
"@jest/globals": "^30.0.0",
"jest": "^30.0.0",
"ts-jest": "^29.2.5"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; jest/ts-jest present under `apps/web`.

- [ ] **Step 3: Write `apps/web/jest.config.js`**

```js
/**
 * Jest config for the web app's unit tests (ST-17).
 * Mirrors apps/api/jest.config.js (ts-jest, node env, *.spec.ts next to source)
 * so the toolchain and the bar match the API's. Only the pure, next-free lib
 * modules are tested here; RSC/JSX is verified by `next build`, not jest.
 *
 * The `@/` alias and the `@folio/shared` workspace import are mapped so specs
 * resolve them the same way the app's tsconfig does.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@folio/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
  testEnvironment: "node",
};
```

- [ ] **Step 4: Write the wiring-proof spec `apps/web/src/lib/__harness__.spec.ts`**

```ts
import { describe, expect, it } from "@jest/globals";
import { getAllDestinations } from "@/data/destinations-helpers";
import type { Experience } from "@folio/shared";

describe("web jest harness", () => {
  it("resolves @/ and @folio/shared and loads real static data", () => {
    const all = getAllDestinations();
    expect(all.length).toBeGreaterThan(0);
    const first: Experience = all[0].experiences[0];
    expect(typeof first.id).toBe("string");
  });
});
```

- [ ] **Step 5: Run it — proves the alias mapping + JSON import + shared resolution all work**

Run: `pnpm --filter @folio/web test`
Expected: PASS (1 test). If `@folio/shared` fails to resolve, re-check the `moduleNameMapper` path depth (`src/../../../packages/shared/src`).

- [ ] **Step 6: Delete the wiring-proof spec and commit the harness**

Run: `rm apps/web/src/lib/__harness__.spec.ts`

```bash
git add apps/web/package.json apps/web/jest.config.js pnpm-lock.yaml
git commit -m "test(web): add ts-jest harness mirroring apps/api (ST-17)"
```

---

### Task 2: Pure detail-lookup + static-param helpers

**Files:**
- Create: `apps/web/src/lib/experience-detail.ts`
- Test: `apps/web/src/lib/experience-detail.spec.ts`

**Interfaces:**
- Consumes: `getAllDestinations`, `getDestination` from `@/data/destinations-helpers`; `Destination`, `Experience` from `@folio/shared`.
- Produces:
  - `interface ExperienceDetail { destination: Destination; experience: Experience }`
  - `findExperienceDetail(slug: string, experienceId: string): ExperienceDetail | undefined`
  - `listExperienceDetailParams(): { slug: string; experienceId: string }[]`
  - `experienceDetailPath(slug: string, experienceId: string): string` → `/destinations/${slug}/experiences/${experienceId}`

- [ ] **Step 1: Write the failing test `apps/web/src/lib/experience-detail.spec.ts`**

```ts
import { describe, expect, it } from "@jest/globals";
import {
  findExperienceDetail,
  listExperienceDetailParams,
  experienceDetailPath,
} from "@/lib/experience-detail";
import { getAllDestinations } from "@/data/destinations-helpers";

describe("findExperienceDetail", () => {
  it("returns the destination + experience for a real slug/id pair", () => {
    const found = findExperienceDetail("bangkok", "grand-palace-wat-phra-kaew");
    expect(found).toBeDefined();
    expect(found!.destination.slug).toBe("bangkok");
    expect(found!.experience.id).toBe("grand-palace-wat-phra-kaew");
    expect(found!.experience.title).toMatch(/Grand Palace/);
  });

  it("returns undefined for an unknown destination slug", () => {
    expect(findExperienceDetail("atlantis", "grand-palace-wat-phra-kaew")).toBeUndefined();
  });

  it("returns undefined for a known slug but unknown experience id", () => {
    expect(findExperienceDetail("bangkok", "no-such-experience")).toBeUndefined();
  });
});

describe("listExperienceDetailParams", () => {
  it("enumerates one param pair per experience across every destination", () => {
    const params = listExperienceDetailParams();
    const expected = getAllDestinations().reduce((n, d) => n + d.experiences.length, 0);
    expect(params.length).toBe(expected);
    // every pair resolves back to a real detail
    for (const p of params) {
      expect(findExperienceDetail(p.slug, p.experienceId)).toBeDefined();
    }
  });

  it("produces unique slug/id pairs", () => {
    const params = listExperienceDetailParams();
    const keys = new Set(params.map((p) => `${p.slug}/${p.experienceId}`));
    expect(keys.size).toBe(params.length);
  });
});

describe("experienceDetailPath", () => {
  it("builds the nested canonical path", () => {
    expect(experienceDetailPath("bangkok", "wat-arun-sunset")).toBe(
      "/destinations/bangkok/experiences/wat-arun-sunset",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/web test experience-detail.spec`
Expected: FAIL — cannot find module `@/lib/experience-detail`.

- [ ] **Step 3: Write `apps/web/src/lib/experience-detail.ts`**

```ts
/**
 * Pure lookup + routing helpers for experience detail pages (ST-17).
 *
 * Built on the static content system (the live, indexed surface) via
 * `destinations-helpers` — see the ST-17 plan's Findings §2/§5 for why the
 * static system, not the DB one, is the source here. No `next`/client imports,
 * so this runs under ts-jest in a node env.
 */
import type { Destination, Experience } from "@folio/shared";
import { getAllDestinations, getDestination } from "@/data/destinations-helpers";

export interface ExperienceDetail {
  destination: Destination;
  experience: Experience;
}

/** Resolve a (destinationSlug, experienceId) pair to its destination + experience. */
export function findExperienceDetail(
  slug: string,
  experienceId: string,
): ExperienceDetail | undefined {
  const destination = getDestination(slug);
  if (!destination) return undefined;
  const experience = destination.experiences.find((e) => e.id === experienceId);
  if (!experience) return undefined;
  return { destination, experience };
}

/** Every (slug, experienceId) pair, for `generateStaticParams`. */
export function listExperienceDetailParams(): { slug: string; experienceId: string }[] {
  return getAllDestinations().flatMap((d) =>
    d.experiences.map((e) => ({ slug: d.slug, experienceId: e.id })),
  );
}

/** Canonical in-app path for a detail page. */
export function experienceDetailPath(slug: string, experienceId: string): string {
  return `/destinations/${slug}/experiences/${experienceId}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/web test experience-detail.spec`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/experience-detail.ts apps/web/src/lib/experience-detail.spec.ts
git commit -m "feat(web): experience-detail lookup + static-param helpers (ST-17)"
```

---

### Task 3: CTA href + affiliate-analytics-input helpers

**Files:**
- Modify: `apps/web/src/lib/experience-detail.ts`
- Modify: `apps/web/src/lib/experience-detail.spec.ts`

**Interfaces:**
- Consumes: `Experience`, `Destination` from `@folio/shared`; `AffiliateClickInput` **type** from `@/lib/analytics` (type-only import — erased, pulls no `posthog-js` into tests).
- Produces:
  - `experienceGoHref(destinationSlug: string, experience: Experience): string | undefined` — `/go/${slug}/${id}` when `affiliateUrl` is set, else `undefined` (mirrors `ExperienceRowCard`'s `goHref`).
  - `experienceDetailAffiliateInput(destination: Destination, experience: Experience): AffiliateClickInput` — the exact payload `ExperienceRowCard` passes to `trackAffiliateClick`.

- [ ] **Step 1: Add the failing tests (append to `experience-detail.spec.ts`)**

```ts
import {
  experienceGoHref,
  experienceDetailAffiliateInput,
} from "@/lib/experience-detail";

describe("experienceGoHref", () => {
  it("routes a live experience through /go/:slug/:id (never the raw affiliateUrl)", () => {
    const live = { ...baseExperience, id: "x1", affiliateUrl: "https://www.viator.com/tours/abc" };
    expect(experienceGoHref("bangkok", live)).toBe("/go/bangkok/x1");
  });

  it("returns undefined when there is no affiliate link", () => {
    const notLive = { ...baseExperience, id: "x1", affiliateUrl: undefined };
    expect(experienceGoHref("bangkok", notLive)).toBeUndefined();
  });
});

describe("experienceDetailAffiliateInput", () => {
  it("carries the stable id + destination context + provider signals", () => {
    const input = experienceDetailAffiliateInput(baseDestination, {
      ...baseExperience,
      id: "x1",
      title: "T",
      provider: "Viator",
      category: "Food & Drink",
      priceBand: "$$",
      rating: 4.5,
      freeCancel: true,
    });
    expect(input).toEqual({
      experienceId: "x1",
      title: "T",
      provider: "Viator",
      category: "Food & Drink",
      priceBand: "$$",
      hasRating: true,
      freeCancel: true,
      city: baseDestination.city,
      country: baseDestination.country,
      destinationSlug: baseDestination.slug,
    });
  });

  it("reports hasRating=false and freeCancel=false when those fields are absent", () => {
    const input = experienceDetailAffiliateInput(baseDestination, {
      ...baseExperience,
      id: "x2",
      rating: undefined,
      freeCancel: undefined,
    });
    expect(input.hasRating).toBe(false);
    expect(input.freeCancel).toBe(false);
  });
});
```

Add these fixtures at the top of the file (below the imports):

```ts
import type { Destination, Experience } from "@folio/shared";

const baseExperience: Experience = {
  id: "base",
  title: "Base",
  description: "Desc.",
  image: "https://example.test/i.jpg",
  imageAlt: "alt",
  category: "Culture & History",
  priceBand: "$$",
};

const baseDestination: Destination = {
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/web test experience-detail.spec`
Expected: FAIL — `experienceGoHref`/`experienceDetailAffiliateInput` not exported.

- [ ] **Step 3: Append the implementations to `experience-detail.ts`**

```ts
import type { AffiliateClickInput } from "@/lib/analytics";

/**
 * CTA href for the detail page. A live experience routes through the first-party
 * `/go/:slug/:id` redirect (BRI-136) — which logs the click then 302s to the
 * verbatim provider deep link — never the raw `affiliateUrl`. Undefined when the
 * experience has no live link (→ "booking coming soon"). This is deliberately the
 * same seam `ExperienceRowCard` uses; expected to be revisited under BRI-137/138.
 */
export function experienceGoHref(
  destinationSlug: string,
  experience: Experience,
): string | undefined {
  return experience.affiliateUrl ? `/go/${destinationSlug}/${experience.id}` : undefined;
}

/** The affiliate-click payload for the detail-page CTA — identical shape to the card's. */
export function experienceDetailAffiliateInput(
  destination: Destination,
  experience: Experience,
): AffiliateClickInput {
  return {
    experienceId: experience.id,
    title: experience.title,
    provider: experience.provider,
    category: experience.category,
    priceBand: experience.priceBand,
    hasRating: typeof experience.rating === "number",
    freeCancel: Boolean(experience.freeCancel),
    city: destination.city,
    country: destination.country,
    destinationSlug: destination.slug,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/web test experience-detail.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/experience-detail.ts apps/web/src/lib/experience-detail.spec.ts
git commit -m "feat(web): detail-page CTA href + affiliate-input helpers via /go (ST-17)"
```

---

### Task 4: SEO builders (metadata + Product/Breadcrumb JSON-LD)

**Files:**
- Create: `apps/web/src/lib/experience-detail-seo.ts`
- Test: `apps/web/src/lib/experience-detail-seo.spec.ts`

**Interfaces:**
- Consumes: `Destination`, `Experience` from `@folio/shared`; `Metadata` **type** from `next` (type-only — erased); `experienceDetailPath` from `@/lib/experience-detail`.
- Produces (all take `siteUrl: string` so they're pure/deterministic in tests):
  - `buildExperienceMetadata(siteUrl, destination, experience): Metadata`
  - `buildExperienceProductLd(siteUrl, destination, experience): Record<string, unknown>`
  - `buildExperienceBreadcrumbLd(siteUrl, destination, experience): Record<string, unknown>`

- [ ] **Step 1: Write the failing test `apps/web/src/lib/experience-detail-seo.spec.ts`**

```ts
import { describe, expect, it } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import {
  buildExperienceMetadata,
  buildExperienceProductLd,
  buildExperienceBreadcrumbLd,
} from "@/lib/experience-detail-seo";

const SITE = "https://www.foliovoyage.com";

const dest: Destination = {
  slug: "bangkok", city: "Bangkok", country: "Thailand", tagline: "t",
  heroImage: "https://e.test/h.jpg", heroImageAlt: "h", intro: ["p"],
  knownFor: ["k"], bestTime: "Nov–Feb", fromPrice: 100, experiences: [], lat: 13.75, lng: 100.5,
};

const rich: Experience = {
  id: "wat-arun-sunset", title: "Wat Arun at golden hour", description: "The Temple of Dawn.",
  image: "https://e.test/wat-arun.jpg", imageAlt: "Wat Arun", category: "Landmarks",
  priceBand: "$$", duration: "2–3 hours", provider: "Viator",
  fromPrice: 28, currency: "USD", rating: 4.7, ratingCount: 1200, freeCancel: true,
  affiliateUrl: "https://www.viator.com/tours/abc",
};

const sparse: Experience = {
  id: "wat-pho-reclining-buddha", title: "Wat Pho", description: "Reclining Buddha.",
  image: "https://e.test/wat-pho.jpg", imageAlt: "Wat Pho", category: "Culture & History",
  priceBand: "$",
};

describe("buildExperienceMetadata", () => {
  it("sets a descriptive title and the nested canonical URL", () => {
    const m = buildExperienceMetadata(SITE, dest, rich);
    expect(m.title).toContain("Wat Arun at golden hour");
    expect(m.title).toContain("Bangkok");
    expect(m.alternates?.canonical).toBe("/destinations/bangkok/experiences/wat-arun-sunset");
    expect((m.openGraph as { url?: string }).url).toBe(
      `${SITE}/destinations/bangkok/experiences/wat-arun-sunset`,
    );
    expect((m.openGraph as { images?: { url: string }[] }).images?.[0].url).toBe(rich.image);
  });
});

describe("buildExperienceProductLd", () => {
  it("emits Product with aggregateRating + offers for a rich experience", () => {
    const ld = buildExperienceProductLd(SITE, dest, rich) as Record<string, any>;
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe(rich.title);
    expect(ld.aggregateRating).toEqual({
      "@type": "AggregateRating", ratingValue: 4.7, reviewCount: 1200,
    });
    expect(ld.offers).toMatchObject({
      "@type": "Offer", price: "28", priceCurrency: "USD",
      url: `${SITE}/destinations/bangkok/experiences/wat-arun-sunset`,
      seller: { "@type": "Organization", name: "Viator" },
    });
  });

  it("omits aggregateRating and offers-price when those fields are absent", () => {
    const ld = buildExperienceProductLd(SITE, dest, sparse) as Record<string, any>;
    expect(ld["@type"]).toBe("Product");
    expect(ld.aggregateRating).toBeUndefined();
    // no fromPrice → no priced Offer (no fabricated price)
    expect(ld.offers?.price).toBeUndefined();
  });
});

describe("buildExperienceBreadcrumbLd", () => {
  it("chains Home → Destinations → City → Experience", () => {
    const ld = buildExperienceBreadcrumbLd(SITE, dest, rich) as Record<string, any>;
    expect(ld["@type"]).toBe("BreadcrumbList");
    const items = ld.itemListElement as { position: number; name: string; item: string }[];
    expect(items.map((i) => i.name)).toEqual(["Home", "Destinations", "Bangkok", rich.title]);
    expect(items[2].item).toBe(`${SITE}/destinations/bangkok`);
    expect(items[3].item).toBe(`${SITE}/destinations/bangkok/experiences/wat-arun-sunset`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/web test experience-detail-seo.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/web/src/lib/experience-detail-seo.ts`**

```ts
/**
 * Pure SEO builders for experience detail pages (ST-17). Mirrors the metadata +
 * JSON-LD pattern already used by the destination page (`destinations/[slug]/
 * page.tsx`): a descriptive title, a nested canonical, OpenGraph/Twitter cards,
 * and `Product` + `BreadcrumbList` structured data.
 *
 * `siteUrl` is a parameter (not read from `@/lib/site` here) so these are
 * deterministic under test and free of `next`/env coupling. Nullable provider
 * signals are emitted only when present — no fabricated rating/price (docs/02
 * §1.3, plan Findings §6).
 */
import type { Metadata } from "next";
import type { Destination, Experience } from "@folio/shared";
import { experienceDetailPath } from "@/lib/experience-detail";

const SITE_NAME = "Folio Voyage";

function detailUrl(siteUrl: string, d: Destination, e: Experience): string {
  return `${siteUrl}${experienceDetailPath(d.slug, e.id)}`;
}

export function buildExperienceMetadata(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Metadata {
  const title = `${e.title} — ${d.city}, ${d.country}`;
  const description = e.description;
  const url = detailUrl(siteUrl, d, e);
  return {
    title,
    description,
    alternates: { canonical: experienceDetailPath(d.slug, e.id) },
    openGraph: {
      type: "article",
      title: `${e.title} · ${SITE_NAME}`,
      description,
      url,
      images: [{ url: e.image, alt: e.imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${e.title} · ${SITE_NAME}`,
      description,
      images: [e.image],
    },
  };
}

export function buildExperienceProductLd(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Record<string, unknown> {
  const url = detailUrl(siteUrl, d, e);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: e.title,
    description: e.description,
    image: e.image,
    category: e.category,
    url,
  };

  if (typeof e.rating === "number" && typeof e.ratingCount === "number") {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: e.rating,
      reviewCount: e.ratingCount,
    };
  }

  // Offer: always present (the page has a booking affordance), but price is
  // included only when a real "from" price exists — never fabricated.
  const offer: Record<string, unknown> = { "@type": "Offer", url };
  if (typeof e.fromPrice === "number" && e.currency) {
    offer.price = String(e.fromPrice);
    offer.priceCurrency = e.currency;
  }
  if (e.provider) {
    offer.seller = { "@type": "Organization", name: e.provider };
  }
  ld.offers = offer;

  return ld;
}

export function buildExperienceBreadcrumbLd(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Destinations", item: `${siteUrl}/destinations` },
      { "@type": "ListItem", position: 3, name: d.city, item: `${siteUrl}/destinations/${d.slug}` },
      { "@type": "ListItem", position: 4, name: e.title, item: detailUrl(siteUrl, d, e) },
    ],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/web test experience-detail-seo.spec`
Expected: PASS (rich + sparse cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/experience-detail-seo.ts apps/web/src/lib/experience-detail-seo.spec.ts
git commit -m "feat(web): detail-page metadata + Product/Breadcrumb JSON-LD builders (ST-17)"
```

---

### Task 5: The detail page (SSG) + client CTA

**Files:**
- Create: `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx`
- Create: `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/ExperienceDetailCta.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2 & 4; `site` from `@/lib/site`; `trackAffiliateClick` + `AffiliateClickInput` from `@/lib/analytics`; `CovillaHeader`/`CovillaFooter`, `getNavDestinations`.
- Produces: the rendered route. No later task consumes its internals.

- [ ] **Step 1: Write the client CTA `ExperienceDetailCta.tsx`**

```tsx
"use client";

import { ArrowUpRight } from "lucide-react";
import { trackAffiliateClick, type AffiliateClickInput } from "@/lib/analytics";

/**
 * Detail-page booking CTA. Mirrors ExperienceRowCard's affiliate seam: a live
 * `sponsored nofollow` link routed through `/go` (passed as `goHref`), or a
 * clearly non-functional "coming soon" state. The href is resolved server-side
 * (`experienceGoHref`); this component only renders + fires the click event.
 */
export function ExperienceDetailCta({
  goHref,
  provider,
  clickInput,
}: {
  goHref?: string;
  provider?: string;
  clickInput: AffiliateClickInput;
}) {
  if (!goHref) {
    return (
      <span
        aria-disabled
        className="inline-flex cursor-default items-center rounded-[2px] border border-line px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted"
      >
        Booking coming soon
      </span>
    );
  }
  return (
    <a
      href={goHref}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={() => trackAffiliateClick(clickInput)}
      className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-5 py-3 text-[12px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
    >
      Book on {provider ?? "Viator"} <ArrowUpRight size={15} />
    </a>
  );
}
```

- [ ] **Step 2: Write the page `page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Clock, Star, ShieldCheck } from "lucide-react";

import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";
import {
  findExperienceDetail,
  listExperienceDetailParams,
  experienceGoHref,
  experienceDetailAffiliateInput,
} from "@/lib/experience-detail";
import {
  buildExperienceMetadata,
  buildExperienceProductLd,
  buildExperienceBreadcrumbLd,
} from "@/lib/experience-detail-seo";
import { ExperienceDetailCta } from "./ExperienceDetailCta";

// Fully static — one page per (destination, experience). Unknown pairs 404.
export function generateStaticParams() {
  return listExperienceDetailParams();
}
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; experienceId: string }>;
}): Promise<Metadata> {
  const { slug, experienceId } = await params;
  const found = findExperienceDetail(slug, experienceId);
  if (!found) return {};
  return buildExperienceMetadata(site.url, found.destination, found.experience);
}

function formatFromPrice(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
}

export default async function ExperienceDetailPage({
  params,
}: {
  params: Promise<{ slug: string; experienceId: string }>;
}) {
  const { slug, experienceId } = await params;
  const found = findExperienceDetail(slug, experienceId);
  if (!found) notFound();
  const { destination: d, experience: e } = found;

  const nav = getNavDestinations();
  const goHref = experienceGoHref(d.slug, e);
  const clickInput = experienceDetailAffiliateInput(d, e);
  const productLd = buildExperienceProductLd(site.url, d, e);
  const breadcrumbLd = buildExperienceBreadcrumbLd(site.url, d, e);

  const hasPrice = typeof e.fromPrice === "number" && e.fromPrice > 0;
  const hasRating = typeof e.rating === "number" && e.rating > 0;

  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-28 md:px-10">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="eyebrow">
          <Link href="/destinations" className="hover:text-ink">Destinations</Link>
          <span className="px-2" aria-hidden>/</span>
          <Link href={`/destinations/${d.slug}`} className="hover:text-ink">{d.city}</Link>
        </nav>

        <p className="eyebrow mt-6">{e.category}</p>
        <h1 className="mt-3 font-display text-[40px] font-semibold leading-[1.05] md:text-[52px]">
          {e.title}
        </h1>

        <p className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-ink-soft">
          <MapPin size={15} /> {d.city}, {d.country}
        </p>

        <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-[3px] bg-surface">
          <Image
            src={e.image}
            alt={e.imageAlt}
            fill
            priority
            sizes="(max-width: 896px) 100vw, 896px"
            className="object-cover"
          />
        </div>

        {/* Enrichment facts */}
        <p className="mt-8 text-[18px] leading-8 text-ink-soft">{e.description}</p>

        <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-y border-line py-5 text-[14px]">
          {e.duration && (
            <div className="inline-flex items-center gap-1.5">
              <Clock size={15} className="text-muted" />
              <dt className="sr-only">Duration</dt>
              <dd>{e.duration}</dd>
            </div>
          )}
          {hasRating && (
            <div className="inline-flex items-center gap-1.5">
              <Star size={15} className="fill-current text-amber-500" aria-hidden />
              <dt className="sr-only">Rating</dt>
              <dd>
                <span className="font-medium">{e.rating!.toFixed(1)}</span>
                {typeof e.ratingCount === "number" && (
                  <span className="text-muted"> ({e.ratingCount.toLocaleString("en-US")})</span>
                )}
                {e.provider && <span className="text-muted"> · via {e.provider}</span>}
              </dd>
            </div>
          )}
          {e.freeCancel && (
            <div className="inline-flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck size={15} aria-hidden />
              <dt className="sr-only">Cancellation</dt>
              <dd>Free cancellation</dd>
            </div>
          )}
        </dl>

        {/* Booking option (the 1:1 "tour") */}
        <section aria-labelledby="booking" className="mt-10 rounded-[3px] border border-line p-6 md:p-8">
          <h2 id="booking" className="font-display text-[22px] font-medium">Book this experience</h2>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                {hasPrice ? "From" : "Price"}
              </p>
              <p className="text-[20px] font-medium text-ink">
                {hasPrice ? formatFromPrice(e.fromPrice!, e.currency) : e.priceBand}
              </p>
              {hasPrice && (
                <p className="mt-1 text-[12px] text-muted">
                  Final price shown by {e.provider ?? "the provider"} at booking.
                </p>
              )}
            </div>
            <ExperienceDetailCta goHref={goHref} provider={e.provider} clickInput={clickInput} />
          </div>
          <p className="mt-5 max-w-xl text-[12px] leading-6 text-muted">
            Hand-picked and independently written. Booking links go live as partner programs are
            approved — see our{" "}
            <Link href="/legal/disclosure" className="text-accent underline">affiliate disclosure</Link>.
          </p>
        </section>

        <div className="mt-10">
          <Link href={`/destinations/${d.slug}`} className="text-[14px] text-accent underline">
            ← All experiences in {d.city}
          </Link>
        </div>
      </main>
      <CovillaFooter />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint the new route**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: clean. Fix any type/lint errors before proceeding.

- [ ] **Step 4: Production build (proves SSG enumerates every detail page)**

Run: `pnpm --filter @folio/web build`
Expected: build succeeds; output lists prerendered `/destinations/[slug]/experiences/[experienceId]` routes (one per experience). If a route errors, inspect the offending experience's data.

- [ ] **Step 5: Verify in the browser preview**

Start the web dev server via preview (`preview_start` with the web launch config), then:
- Navigate to `/destinations/bangkok/experiences/grand-palace-wat-phra-kaew` (a live one — has a `viator-links.json` entry) → confirm the CTA renders "Book on Viator" and its href is `/go/bangkok/grand-palace-wat-phra-kaew` (read_page / inspect the anchor). Do **not** actually follow it.
- Navigate to a not-live experience (any id absent from `viator-links.json`) → confirm "Booking coming soon".
- Navigate to `/destinations/bangkok/experiences/does-not-exist` → confirm 404.
- Check `read_console_messages` for errors. Capture a screenshot for the report.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/destinations/[slug]/experiences"
git commit -m "feat(web): experience detail page (SSG, /go CTA, Product JSON-LD) — ST-17"
```

---

### Task 6: Inbound links (card → detail) + sitemap

**Files:**
- Modify: `apps/web/src/components/covilla/ExperienceRowCard.tsx`
- Modify: `apps/web/src/app/sitemap.ts`
- Test: `apps/web/src/app/sitemap.spec.ts`

**Interfaces:**
- Consumes: `experienceDetailPath` (Task 2).
- Produces: the destination-page card title becomes a `Link` to the detail page; the sitemap lists every detail URL.

- [ ] **Step 1: Write the failing sitemap test `apps/web/src/app/sitemap.spec.ts`**

```ts
import { describe, expect, it } from "@jest/globals";
import sitemap from "@/app/sitemap";
import { getAllDestinations } from "@/data/destinations-helpers";

describe("sitemap", () => {
  it("includes a detail URL for every experience in every destination", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    for (const d of getAllDestinations()) {
      for (const e of d.experiences) {
        expect(urls.has(`http://localhost:3000/destinations/${d.slug}/experiences/${e.id}`)).toBe(true);
      }
    }
  });

  it("still lists the canonical destination pages", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    for (const d of getAllDestinations()) {
      expect(urls.has(`http://localhost:3000/destinations/${d.slug}`)).toBe(true);
    }
  });
});
```

Note: `site.url` is `http://localhost:3000` under test (no `NEXT_PUBLIC_SITE_URL`/Vercel env set in jest). If a machine exports those, assert with `${site.url}` instead of the literal — import `site` from `@/lib/site` and build the expected string from it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/web test sitemap.spec`
Expected: FAIL — detail URLs absent.

- [ ] **Step 3: Add detail routes to `sitemap.ts`**

Add, after `destinationRoutes`, before the `return`:

```ts
  // ST-17: one indexable detail page per experience, nested under its
  // canonical destination.
  const experienceRoutes: MetadataRoute.Sitemap = getAllDestinations().flatMap((d) =>
    d.experiences.map((e) => ({
      url: `${site.url}/destinations/${d.slug}/experiences/${e.id}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  );
```

and include it in the return: `return [...staticRoutes, ...destinationRoutes, ...experienceRoutes, ...blogRoutes];`

- [ ] **Step 4: Run to verify sitemap test passes**

Run: `pnpm --filter @folio/web test sitemap.spec`
Expected: PASS.

- [ ] **Step 5: Link the card title to the detail page in `ExperienceRowCard.tsx`**

Add `import Link from "next/link";` and `import { experienceDetailPath } from "@/lib/experience-detail";` at the top. Replace the title `<h3>…{e.title}…</h3>` with a linked title (keep classes):

```tsx
        <h3 className="mt-2 font-display text-[22px] font-medium leading-snug">
          <Link
            href={experienceDetailPath(destination.slug, e.id)}
            className="transition-colors hover:text-accent"
          >
            {e.title}
          </Link>
        </h3>
```

Leave the affiliate CTA and everything else unchanged — this only adds an internal inbound link; the outbound `/go` CTA is untouched.

- [ ] **Step 6: Typecheck, lint, full web test + build**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint && pnpm --filter @folio/web test && pnpm --filter @folio/web build`
Expected: all clean.

- [ ] **Step 7: Verify the inbound link in preview**

Reload the destination page `/destinations/bangkok`, confirm the experience titles are now links to `/destinations/bangkok/experiences/:id`, click one, confirm it lands on the detail page. Screenshot for the report.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/sitemap.ts apps/web/src/app/sitemap.spec.ts apps/web/src/components/covilla/ExperienceRowCard.tsx
git commit -m "feat(web): link cards to detail pages + list them in sitemap (ST-17)"
```

---

### Task 7: Log the as-built URL + deferred-DB finding in the spec

**Files:**
- Modify: `docs/03-engineering-specification.md` (ST-17 line only)

**Interfaces:** none (docs).

- [ ] **Step 1: Append an as-built note under ST-17**

Under the ST-17 bullet in `docs/03-engineering-specification.md`, add a sub-line (keep the existing AC line intact):

```markdown
  - As built (2026-08-21): shipped as **static** experience detail pages at
    `/destinations/:slug/experiences/:experienceId` (SSG), nested under the
    BRI-166 canonical destination. Experience≈tour is 1:1 at MVP, so the single
    "booking option" block is the tour view (no separate `/tours/:slug`); CTA
    routes through `/go/:slug/:id` (BRI-136), revisited under BRI-137/138.
    DB-backed detail (needs a `GET /v1/experiences/:id` endpoint + an indexable
    inbound surface + `/go` support for DB keys) is deferred. docs/01 §6.1 /
    docs/02 §4.3 IA (`/experiences/:slug`, `/tours/:slug`) is stale vs. this and
    the current schema (no Atlas slug) — flagged for a later doc-02 reconciliation.
```

- [ ] **Step 2: Commit**

```bash
git add docs/03-engineering-specification.md
git commit -m "docs: record ST-17 as-built detail-page URL + deferred DB path"
```

---

## Landing the PR

- [ ] **Step 1: Rebase-clean, run the whole affected gate locally**

Run: `pnpm turbo run lint typecheck test --filter @folio/web && pnpm --filter @folio/web build`
Expected: green.

- [ ] **Step 2: Push the branch and open the PR against `master`**

```bash
git push -u origin stewie/st-17-detail-pages-82868a
```

Open the PR (title `ST-17: experience detail pages`), body summarising: the URL shape + why (Findings §4/§5), the static-vs-DB decision + deferrals (§2/§3), the `/go` CTA reuse + BRI-137/138 caveat (§3), SEO (Product + Breadcrumb LD, sitemap), and the new web jest harness. Include the CI-green requirement.

- [ ] **Step 3: Wait for CI green, then merge**

Confirm both CI jobs (`lint-typecheck-test`, `migrate`) pass — the web `test` task now runs under Turbo `--affected`. Merge once green. (Do not deploy; no Render/Vercel triggers.)

---

## Self-Review

**1. Spec coverage (ST-17 AC):**
- "enrichment facts" → description + duration/rating/free-cancellation facts block (Task 5). ✅
- "aggregated tours" → 1:1 booking-option block, with the aggregation-to-many explicitly deferred to the DB model (Findings §5, Task 7). ✅ (honest scoping)
- "imported rating + count with provider attribution" → rating + `ratingCount` + "via {provider}" (Task 5); `aggregateRating` + `offers.seller` in JSON-LD (Task 4). ✅
- "tour page shows price snapshot (timestamped) + inclusions" → price "from" + provider framing; **timestamp deferred** with reason (Findings §5), inclusions surfaced as the free-cancellation/duration facts we actually have (no fabrication). ✅ (partial-by-necessity, flagged)
- Traceability FR-DEST-3 / FR-REV-1 — detail render + review facts. ✅
- Unblocks ST-18: detail pages exist per experience within a destination for compare to select from. ✅

**2. Placeholder scan:** every code + test step carries real code; no "TBD"/"add error handling"/"similar to Task N". ✅

**3. Type consistency:** `findExperienceDetail`/`listExperienceDetailParams`/`experienceDetailPath`/`experienceGoHref`/`experienceDetailAffiliateInput` (Tasks 2–3) are used verbatim in Tasks 4–6; SEO builders' `(siteUrl, destination, experience)` signature is called consistently in Task 5; `AffiliateClickInput` shape matches `analytics.ts`; `ExperienceDetailCta` props match the page's call site. ✅

**Open items for the reviewer (Roy):** (a) confirm the static-system decision (Findings §5) vs. waiting for a DB detail endpoint; (b) confirm the nested URL `/destinations/:slug/experiences/:id` vs. the doc's flat `/experiences/:slug`; (c) confirm adding jest to `apps/web` is acceptable (vs. leaving web untested and testing only via `next build`).
