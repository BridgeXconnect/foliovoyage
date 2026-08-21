# ST-18 — Compare 2–4 Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a traveler select 2–4 curated tours on a destination page and open a side-by-side comparison (price, duration, rating, provider, cancellation) — a client-side selection tray + modal layered on the existing static destination page, reusing ST-17's pure detail/CTA helpers.

**Architecture:** A pure, unit-tested `experience-compare.ts` module owns the selection rule (2..4, cap enforced) and builds a `ComparisonModel` from a destination + selected ids, emitting `null` for facts a given tour lacks (never fabricated). Two new `"use client"` components render on top of it: `ExperienceComparePicker` replaces the destination page's inline experience-list map — it holds selection state, renders each `ExperienceRowCard` with an added compare checkbox, and shows a sticky compare tray; `ExperienceCompareModal` renders the side-by-side table and reuses ST-17's `/go` CTA seam per column. No new route, no new indexed URL — the comparison is an ephemeral decision aid, consistent with the site's SSG/SEO posture.

**Tech Stack:** Next.js 15 (App Router, RSC + client components), React 19, TypeScript 5.9, Tailwind v4, `@folio/shared` domain types, jest 30 + ts-jest 29 (the harness ST-17 added to `apps/web`), lucide-react icons, posthog-js (existing analytics seam).

**Spec:** `docs/03-engineering-specification.md` ST-18 (EP-6) / Linear BRI-130. AC verbatim: _"Selecting 2–4 tours opens a comparison of price, duration, rating, provider, inclusions."_ Traces FR-DEST-4, BG-2. Blocked-by ST-17 (now merged).

## Global Constraints

- **Node 22, pnpm 11 via corepack.** Run commands from repo root unless noted.
- **Do not deploy.** Build/verify locally only (CLAUDE.md; no Render/Vercel triggers). Render is suspended — trigger nothing.
- **Do not touch Linear.** Roy closes out ST-18 after this is reported.
- **Static content system only** (`apps/web/src/data/destinations.ts` + `viator-links.json` via `destinations-helpers`). Same call as ST-17 and for the same reasons: this is the live, indexed surface with working `/go` CTAs today. Do **not** touch the DB catalog.
- **Affiliate CTA routes through `/go/:slug/:id` only** (BRI-136), fired through `trackAffiliateClick` (CLAUDE.md analytics rule). Reuse ST-17's `experienceGoHref` / `experienceDetailAffiliateInput`; never inline a raw `affiliateUrl` href or a bespoke `posthog.capture`.
- **No fake data.** A fact a tour lacks renders as an honest em-dash "—", never a guessed value. Itemized inclusions are not in the dataset — see Findings §I; do not invent them.
- **Comparison is scoped to a single destination** (you compare tours within one city). Selection state is per-destination-page.
- **Every new pure module lives in `apps/web/src/lib/`** and imports no `next/*` and no client-only runtime (`posthog-js`), so ts-jest runs it in a node env. Type-only imports (erased) are fine.
- **Reuse over duplication:** ST-17's `formatFromPrice`, `experienceDetailPath`, `experienceGoHref`, `experienceDetailAffiliateInput` are the seams to build on — do not reimplement price formatting, the detail path, or the `/go` CTA payload.

---

## Key Findings & Decisions (read before implementing)

These are the "flag it explicitly" findings the task asked for. The decisions below are what to review; everything downstream depends on them.

### §I — "Inclusions" is not real data (the ST-17-style honest-absence call)
- The `Experience` type (`packages/shared/src/index.ts`) has **no inclusions field**. Real per-tour facts are: `duration` (all 48 experiences), `priceBand` (all), and — only for the 19 tours matched in `viator-links.json` — `fromPrice`/`currency`, `rating`/`ratingCount`, `provider`, `freeCancel`. There is no "what's included" list (guide / transport / meals).
- **Decision (mirrors ST-17's timestamped-snapshot handling):** render the real fields we have, and use **free cancellation** — the one genuine policy/"inclusion-like" signal in the data — as the compared cancellation row. Do **not** render a fabricated inclusions list or a noise row of empty "Inclusions: —" cells. The modal footnotes that itemized inclusions vary by tour and live on each tour's provider page; an as-built doc note (Task 5) records the gap as deferred to the DB `Tour` model. **Open item for Roy:** accept free-cancellation-as-the-inclusion-signal + footnote, vs. holding ST-18's inclusions row until the DB path carries real inclusions.

### §II — Data mix makes null-handling load-bearing, not hypothetical
- Live tours per destination: bangkok 4, kyoto 3, lisbon 1, rome 4, hanoi 4, bali 3 (19 total of 48). Every destination also has non-live experiences. So a real 2–4 compare set routinely mixes a rich tour (price/rating/provider/free-cancel) with a sparse one (only `priceBand` + `duration`). `buildComparison` must emit `null` for absent facts and the modal must render "—". This is the core of the "missing/null fields across the set" test bar.

### §III — Selection UX: none exists; build a checkbox-per-card + sticky tray
- No checkbox / selection-tray / compare pattern exists anywhere in `apps/web`. The nearest precedent for "client interaction layered on the static page" is `View3DButton` (a `"use client"` island the RSC destination page renders inline). We follow that shape: the RSC page renders a client `ExperienceComparePicker` that owns selection state.
- `ExperienceRowCard` is used **only** on the destination page (the other mentions are JSDoc). So moving its rendering into the picker and adding an **optional** `compare` prop is contained and backward-compatible.

### §IV — Comparison view: a client modal, not a route
- A user-selected 2–4 combination has no SEO value (combinatorial, thin, duplicative) — the same reasoning that kept ST-17 from minting thin indexable pages. So the comparison is **not** a new `/compare` route. It is a `role="dialog"` **modal** opened from the tray, rendered client-side, with a horizontally-scrollable side-by-side table (2–4 columns). No `generateStaticParams`, no sitemap entry.
- **Deferred (flagged):** URL-param shareability (`?compare=a,b,c`) so a comparison is linkable/reloadable. Nice-to-have, not in the AC; adds routing/state-sync complexity. Left as a follow-up; selection is in-memory per page visit. **Open item for Roy.**

### §V — Reuse of ST-17 helpers (the task asked to check this)
- `formatFromPrice(amount, currency)` → the price cell. Reused directly.
- `experienceDetailPath(slug, id)` → each compare column's title links to the tour's detail page (ST-17). Reused directly.
- `experienceGoHref(slug, experience)` + `experienceDetailAffiliateInput(dest, experience)` + `trackAffiliateClick` → each column's "Book on {provider}" CTA uses the identical `/go` seam and analytics payload as the detail page. Reused directly (the pure helpers), so the modal adds no new link logic.
- `findExperienceDetail` is **not** reused: the picker/modal already hold the whole `Destination`, so `buildComparison` selects from `destination.experiences` by id rather than re-resolving slug→destination.

---

## File Structure

**New (source):**
- `apps/web/src/lib/experience-compare.ts` — pure: `MIN_COMPARE`, `MAX_COMPARE`, `toggleCompareSelection`, `canCompare`, `buildComparison` (+ exported `ComparisonModel`/`CompareTour`/`CompareRow` types). No `next`/`posthog` runtime imports.
- `apps/web/src/components/covilla/ExperienceCompareModal.tsx` — `"use client"`. Presentational side-by-side dialog; consumes `ComparisonModel`; reuses the `/go` CTA seam per column.
- `apps/web/src/components/covilla/ExperienceComparePicker.tsx` — `"use client"`. Owns selection state; renders the experience list (via `ExperienceRowCard`) + sticky compare tray; opens the modal.

**New (tests):**
- `apps/web/src/lib/experience-compare.spec.ts`

**Modified:**
- `apps/web/src/components/covilla/ExperienceRowCard.tsx` — add an **optional** `compare` prop (checkbox); no change when the prop is absent.
- `apps/web/src/app/destinations/[slug]/page.tsx` — replace the inline `d.experiences.map(...)` with `<ExperienceComparePicker …/>`.
- `apps/web/src/lib/analytics.ts` — add `trackToursCompared` (one small structured event, consistent with the analytics philosophy in CLAUDE.md).
- `docs/03-engineering-specification.md` — one as-built note under ST-18.

**Read-only references (do not modify):** `experience-detail.ts`, `destinations-helpers.ts`, `@folio/shared`, `go/[slug]/[id]/route.ts`, `View3DButton.tsx` (island precedent), `jest.config.js` (ST-17 harness).

---

### Task 1: Pure compare-logic module (selection rule + comparison model)

This is the test-heavy core: the 2/3/4/5th selection cases and the null-field cases live here as pure unit tests.

**Files:**
- Create: `apps/web/src/lib/experience-compare.ts`
- Test: `apps/web/src/lib/experience-compare.spec.ts`

**Interfaces:**
- Consumes: `Destination`, `Experience` from `@folio/shared`; `formatFromPrice`, `experienceDetailPath` from `@/lib/experience-detail`.
- Produces:
  - `MIN_COMPARE = 2`, `MAX_COMPARE = 4`
  - `toggleCompareSelection(current: readonly string[], id: string, max?: number): string[]`
  - `canCompare(selected: readonly string[], min?: number, max?: number): boolean`
  - `interface CompareTour { id: string; title: string; image: string; imageAlt: string; category: string; detailPath: string }`
  - `interface CompareRow { key: "price" | "duration" | "rating" | "provider" | "freeCancel"; label: string; values: (string | null)[] }`
  - `interface ComparisonModel { tours: CompareTour[]; rows: CompareRow[] }`
  - `buildComparison(destination: Destination, ids: readonly string[]): ComparisonModel`

- [ ] **Step 1: Write the failing test `apps/web/src/lib/experience-compare.spec.ts`**

```ts
import { describe, expect, it } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import {
  MIN_COMPARE,
  MAX_COMPARE,
  toggleCompareSelection,
  canCompare,
  buildComparison,
} from "@/lib/experience-compare";

// A live (matched) tour: carries provider commerce signals.
function live(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id,
    title: `Live ${id}`,
    description: "d",
    image: `https://e.test/${id}.jpg`,
    imageAlt: `alt ${id}`,
    category: "Landmarks",
    priceBand: "$$",
    duration: "2–3 hours",
    provider: "Viator",
    fromPrice: 28,
    currency: "USD",
    rating: 4.7,
    ratingCount: 1200,
    freeCancel: true,
    affiliateUrl: "https://www.viator.com/tours/abc",
    ...over,
  };
}

// A sparse (unmatched) tour: only editorial priceBand + duration.
function sparse(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id,
    title: `Sparse ${id}`,
    description: "d",
    image: `https://e.test/${id}.jpg`,
    imageAlt: `alt ${id}`,
    category: "Culture & History",
    priceBand: "$",
    duration: "Half day",
    ...over,
  };
}

const dest: Destination = {
  slug: "bangkok",
  city: "Bangkok",
  country: "Thailand",
  tagline: "t",
  heroImage: "https://e.test/h.jpg",
  heroImageAlt: "h",
  intro: ["p"],
  knownFor: ["k"],
  bestTime: "Nov–Feb",
  fromPrice: 100,
  experiences: [live("a"), live("b"), live("c"), sparse("d"), sparse("e")],
  lat: 13.75,
  lng: 100.5,
};

describe("selection rule (2..4)", () => {
  it("exposes the documented bounds", () => {
    expect(MIN_COMPARE).toBe(2);
    expect(MAX_COMPARE).toBe(4);
  });

  it("adds ids up to the max of 4, then rejects a 5th (no-op)", () => {
    let sel: string[] = [];
    sel = toggleCompareSelection(sel, "a"); // 1
    sel = toggleCompareSelection(sel, "b"); // 2
    sel = toggleCompareSelection(sel, "c"); // 3
    sel = toggleCompareSelection(sel, "d"); // 4 (max)
    expect(sel).toEqual(["a", "b", "c", "d"]);
    const after5th = toggleCompareSelection(sel, "e"); // attempted 5th
    expect(after5th).toEqual(["a", "b", "c", "d"]); // unchanged
  });

  it("toggling an already-selected id removes it (even at the cap)", () => {
    const sel = ["a", "b", "c", "d"];
    expect(toggleCompareSelection(sel, "b")).toEqual(["a", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const sel = ["a"];
    const next = toggleCompareSelection(sel, "b");
    expect(sel).toEqual(["a"]);
    expect(next).toEqual(["a", "b"]);
  });

  it("canCompare is true only for 2..4 selected", () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(["a"])).toBe(false);
    expect(canCompare(["a", "b"])).toBe(true);
    expect(canCompare(["a", "b", "c"])).toBe(true);
    expect(canCompare(["a", "b", "c", "d"])).toBe(true);
    expect(canCompare(["a", "b", "c", "d", "e"])).toBe(false);
  });
});

describe("buildComparison", () => {
  it("builds 2 columns in the given id order with detail paths", () => {
    const m = buildComparison(dest, ["b", "a"]);
    expect(m.tours.map((t) => t.id)).toEqual(["b", "a"]);
    expect(m.tours[0].detailPath).toBe("/destinations/bangkok/experiences/b");
    expect(m.tours[1].detailPath).toBe("/destinations/bangkok/experiences/a");
    // one cell per tour on every row
    for (const row of m.rows) expect(row.values).toHaveLength(2);
    expect(m.rows.map((r) => r.key)).toEqual([
      "price",
      "duration",
      "rating",
      "provider",
      "freeCancel",
    ]);
  });

  it("builds 3 columns", () => {
    const m = buildComparison(dest, ["a", "b", "c"]);
    expect(m.tours).toHaveLength(3);
    for (const row of m.rows) expect(row.values).toHaveLength(3);
  });

  it("builds 4 columns (the max)", () => {
    const m = buildComparison(dest, ["a", "b", "c", "d"]);
    expect(m.tours).toHaveLength(4);
    for (const row of m.rows) expect(row.values).toHaveLength(4);
  });

  it("renders real values for a live tour", () => {
    const m = buildComparison(dest, ["a"]);
    const val = (k: string) => m.rows.find((r) => r.key === k)!.values[0];
    expect(val("price")).toBe("From $28");
    expect(val("duration")).toBe("2–3 hours");
    expect(val("rating")).toBe("4.7 (1,200)");
    expect(val("provider")).toBe("Viator");
    expect(val("freeCancel")).toBe("Yes");
  });

  it("emits null (honest absence) for facts a sparse tour lacks", () => {
    // 'd' is sparse: no provider/price/rating/freeCancel; only priceBand + duration.
    const m = buildComparison(dest, ["d"]);
    const val = (k: string) => m.rows.find((r) => r.key === k)!.values[0];
    expect(val("price")).toBe("$"); // editorial priceBand, never fabricated
    expect(val("duration")).toBe("Half day");
    expect(val("rating")).toBeNull();
    expect(val("provider")).toBeNull();
    expect(val("freeCancel")).toBeNull(); // unknown policy → null, not "No"
  });

  it("keeps per-tour nulls aligned when the set mixes live + sparse", () => {
    const m = buildComparison(dest, ["a", "d"]);
    const rating = m.rows.find((r) => r.key === "rating")!;
    expect(rating.values).toEqual(["4.7 (1,200)", null]);
    const provider = m.rows.find((r) => r.key === "provider")!;
    expect(provider.values).toEqual(["Viator", null]);
  });

  it("skips ids that are not in the destination", () => {
    const m = buildComparison(dest, ["a", "does-not-exist", "b"]);
    expect(m.tours.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/web test experience-compare.spec`
Expected: FAIL — cannot find module `@/lib/experience-compare`.

- [ ] **Step 3: Write `apps/web/src/lib/experience-compare.ts`**

```ts
/**
 * Pure selection rule + comparison model for "compare 2–4 tours" (ST-18).
 *
 * Built on the static content system via ST-17's pure helpers (`formatFromPrice`,
 * `experienceDetailPath`) — no `next`/`posthog` runtime imports, so ts-jest runs
 * this in a node env. The presentation (picker + modal) is a thin client layer
 * over this module; all the branching that needs testing lives here.
 *
 * "Inclusions" (guide/transport/meals) is not in the static dataset, so there is
 * no inclusions row; the nearest real policy signal — free cancellation — is the
 * compared cancellation row, and the modal footnotes the gap (plan Findings §I).
 * Any fact a tour lacks is `null` here and an em-dash in the UI — never invented.
 */
import type { Destination, Experience } from "@folio/shared";
import { formatFromPrice, experienceDetailPath } from "@/lib/experience-detail";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/**
 * Toggle an experience id in/out of the compare selection. Removing an already-
 * selected id always works; adding a new id past `max` is a no-op (the cap that
 * enforces "up to 4"). Returns a new array — never mutates `current`.
 */
export function toggleCompareSelection(
  current: readonly string[],
  id: string,
  max: number = MAX_COMPARE,
): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= max) return [...current];
  return [...current, id];
}

/** Whether the current selection is comparable (between min and max inclusive). */
export function canCompare(
  selected: readonly string[],
  min: number = MIN_COMPARE,
  max: number = MAX_COMPARE,
): boolean {
  return selected.length >= min && selected.length <= max;
}

export interface CompareTour {
  id: string;
  title: string;
  image: string;
  imageAlt: string;
  category: string;
  /** ST-17 canonical detail path — the column title links here. */
  detailPath: string;
}

export interface CompareRow {
  key: "price" | "duration" | "rating" | "provider" | "freeCancel";
  label: string;
  /** One cell per tour, in the same order as `tours`. `null` = not available. */
  values: (string | null)[];
}

export interface ComparisonModel {
  tours: CompareTour[];
  rows: CompareRow[];
}

function priceOf(e: Experience): string {
  return typeof e.fromPrice === "number" && e.fromPrice > 0
    ? `From ${formatFromPrice(e.fromPrice, e.currency)}`
    : e.priceBand;
}

function ratingOf(e: Experience): string | null {
  if (typeof e.rating !== "number" || e.rating <= 0) return null;
  const count =
    typeof e.ratingCount === "number"
      ? ` (${e.ratingCount.toLocaleString("en-US")})`
      : "";
  return `${e.rating.toFixed(1)}${count}`;
}

/**
 * Build a side-by-side comparison for `ids` within one destination. Order
 * follows `ids`; ids not present in the destination are skipped.
 */
export function buildComparison(
  destination: Destination,
  ids: readonly string[],
): ComparisonModel {
  const byId = new Map(destination.experiences.map((e) => [e.id, e] as const));
  const picked: Experience[] = ids
    .map((id) => byId.get(id))
    .filter((e): e is Experience => Boolean(e));

  const tours: CompareTour[] = picked.map((e) => ({
    id: e.id,
    title: e.title,
    image: e.image,
    imageAlt: e.imageAlt,
    category: e.category,
    detailPath: experienceDetailPath(destination.slug, e.id),
  }));

  const rows: CompareRow[] = [
    { key: "price", label: "Price", values: picked.map(priceOf) },
    { key: "duration", label: "Duration", values: picked.map((e) => e.duration ?? null) },
    { key: "rating", label: "Rating", values: picked.map(ratingOf) },
    { key: "provider", label: "Provider", values: picked.map((e) => e.provider ?? null) },
    {
      key: "freeCancel",
      label: "Free cancellation",
      // Only assert free cancellation when the data says so; unknown → null.
      values: picked.map((e) => (e.freeCancel === true ? "Yes" : null)),
    },
  ];

  return { tours, rows };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/web test experience-compare.spec`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/experience-compare.ts apps/web/src/lib/experience-compare.spec.ts
git commit -m "feat(web): pure compare selection rule + comparison model (ST-18)"
```

---

### Task 2: The comparison modal (client, presentational)

**Files:**
- Create: `apps/web/src/components/covilla/ExperienceCompareModal.tsx`
- Modify: `apps/web/src/lib/analytics.ts` (add `trackToursCompared`)

**Interfaces:**
- Consumes: `ComparisonModel`, `CompareTour`, `CompareRow` from `@/lib/experience-compare`; `Experience`, `Destination` from `@folio/shared`; `experienceGoHref`, `experienceDetailAffiliateInput` from `@/lib/experience-detail`; `trackAffiliateClick` from `@/lib/analytics`.
- Produces:
  - `analytics.ts`: `trackToursCompared(input: { destinationSlug: string; city: string; country: string; experienceIds: string[] }): void`
  - `ExperienceCompareModal` — props `{ destination: Destination; selectedIds: string[]; onClose: () => void }`. Builds its own `ComparisonModel` from `destination` + `selectedIds` (so callers pass ids, not a model).

- [ ] **Step 1: Add `trackToursCompared` to `apps/web/src/lib/analytics.ts`**

Append (after `trackAffiliateClick`):

```ts
/** Capture a "compare tours" interaction (FR-ANALYTICS-1 structured events). */
export function trackToursCompared(input: {
  destinationSlug: string;
  city: string;
  country: string;
  experienceIds: string[];
}): void {
  posthog.capture("tours_compared", {
    destination_slug: input.destinationSlug,
    city: input.city,
    country: input.country,
    experience_ids: input.experienceIds,
    tour_count: input.experienceIds.length,
  });
}
```

- [ ] **Step 2: Write `apps/web/src/components/covilla/ExperienceCompareModal.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, ArrowUpRight } from "lucide-react";
import type { Destination } from "@folio/shared";
import { buildComparison } from "@/lib/experience-compare";
import {
  experienceGoHref,
  experienceDetailAffiliateInput,
} from "@/lib/experience-detail";
import { trackAffiliateClick } from "@/lib/analytics";

/**
 * Side-by-side comparison dialog for 2–4 selected tours (ST-18). Presentational:
 * it turns `selectedIds` into a `ComparisonModel` (pure) and lays the tours out
 * as columns with a sticky left label column. Facts a tour lacks render as "—"
 * (honest absence — see plan Findings §I/§II). Each column's booking CTA reuses
 * ST-17's `/go` seam and the shared `trackAffiliateClick` payload — no new link
 * logic. Itemized inclusions aren't in the dataset, so a footnote points to each
 * tour's provider page instead of fabricating a list.
 */
export function ExperienceCompareModal({
  destination,
  selectedIds,
  onClose,
}: {
  destination: Destination;
  selectedIds: string[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const model = buildComparison(destination, selectedIds);
  const byId = new Map(destination.experiences.map((e) => [e.id, e] as const));

  // Close on Escape; focus the close button on open; lock body scroll.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const colWidth = "min-w-[220px] max-w-[280px]";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${model.tours.length} tours in ${destination.city}`}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close comparison"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/60"
      />

      <div className="relative z-10 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[4px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-[20px] font-medium">
            Compare tours — {destination.city}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto px-6 py-6">
          <table className="w-full border-collapse text-left align-top">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white" />
                {model.tours.map((t) => (
                  <th key={t.id} className={`${colWidth} px-3 pb-4 font-normal`}>
                    <div className="relative mb-3 aspect-[16/10] overflow-hidden rounded-[3px] bg-surface">
                      <Image
                        src={t.image}
                        alt={t.imageAlt}
                        fill
                        sizes="280px"
                        className="object-cover"
                      />
                    </div>
                    <p className="eyebrow">{t.category}</p>
                    <Link
                      href={t.detailPath}
                      className="mt-1 block font-display text-[16px] font-medium leading-snug transition-colors hover:text-accent"
                    >
                      {t.title}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-white py-3 pr-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted"
                  >
                    {row.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td key={model.tours[i].id} className="px-3 py-3 text-[14px] text-ink">
                      {v ?? <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Booking CTA row — reuses ST-17's /go seam per column. */}
              <tr className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-white py-4 pr-4" />
                {model.tours.map((t) => {
                  const e = byId.get(t.id)!;
                  const goHref = experienceGoHref(destination.slug, e);
                  const clickInput = experienceDetailAffiliateInput(destination, e);
                  return (
                    <td key={t.id} className="px-3 py-4">
                      {goHref ? (
                        <a
                          href={goHref}
                          target="_blank"
                          rel="sponsored nofollow noopener"
                          onClick={() => trackAffiliateClick(clickInput)}
                          className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white"
                        >
                          Book on {e.provider ?? "Viator"} <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        <span className="inline-flex cursor-default items-center rounded-[2px] border border-line px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                          Booking soon
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          <p className="mt-6 max-w-2xl text-[12px] leading-6 text-muted">
            Detailed inclusions (guide, transport, meals) vary by tour — open a
            tour to see its full details on the provider’s page. Hand-picked and
            independently written; see our{" "}
            <Link href="/legal/disclosure" className="text-accent underline">
              affiliate disclosure
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: clean. Fix any type/lint errors before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/covilla/ExperienceCompareModal.tsx apps/web/src/lib/analytics.ts
git commit -m "feat(web): side-by-side compare modal + tours_compared event (ST-18)"
```

---

### Task 3: Compare checkbox on the card + the selection picker

**Files:**
- Modify: `apps/web/src/components/covilla/ExperienceRowCard.tsx`
- Create: `apps/web/src/components/covilla/ExperienceComparePicker.tsx`

**Interfaces:**
- `ExperienceRowCard` gains an **optional** prop:
  - `compare?: { selected: boolean; disabled: boolean; onToggle: () => void }` — when present, renders a checkbox; when absent, the card is unchanged.
- `ExperienceComparePicker` — props `{ destination: Destination }`. Reads `destination.experiences`, owns `selectedIds` state, renders cards + sticky tray + `ExperienceCompareModal`.

- [ ] **Step 1: Add the optional compare checkbox to `ExperienceRowCard.tsx`**

Add `CheckSquare, Square` to the existing `lucide-react` import line:

```tsx
import { ArrowUpRight, Star, ShieldCheck, CheckSquare, Square } from "lucide-react";
```

Extend the props type (add the `compare` field alongside `experience` and `destination`):

```tsx
  compare,
}: {
  experience: Experience;
  destination: { slug: string; city: string; country: string };
  /**
   * When present (ST-18), renders a "compare" checkbox. `disabled` is true when
   * the selection is at the cap and this card isn't already selected. Absent on
   * every other use of the card, which then renders exactly as before.
   */
  compare?: { selected: boolean; disabled: boolean; onToggle: () => void };
}) {
```

Immediately inside the details column, above the `<p className="eyebrow">{e.category}</p>` line, insert the checkbox (only when `compare` is provided):

```tsx
        {compare && (
          <button
            type="button"
            role="checkbox"
            aria-checked={compare.selected}
            aria-label={
              compare.selected ? `Remove ${e.title} from comparison` : `Add ${e.title} to comparison`
            }
            disabled={compare.disabled && !compare.selected}
            onClick={compare.onToggle}
            title={
              compare.disabled && !compare.selected ? "You can compare up to 4 tours" : undefined
            }
            className="mb-3 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compare.selected ? (
              <CheckSquare size={16} className="text-accent" aria-hidden />
            ) : (
              <Square size={16} aria-hidden />
            )}
            Compare
          </button>
        )}
```

Leave everything else (title link, provider signals, price, `/go` CTA) unchanged.

- [ ] **Step 2: Write `apps/web/src/components/covilla/ExperienceComparePicker.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Scale, X } from "lucide-react";
import type { Destination } from "@folio/shared";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
import { ExperienceCompareModal } from "@/components/covilla/ExperienceCompareModal";
import {
  MAX_COMPARE,
  toggleCompareSelection,
  canCompare,
} from "@/lib/experience-compare";
import { trackToursCompared } from "@/lib/analytics";

/**
 * Client island (ST-18) that replaces the destination page's inline experience
 * list. It owns the compare selection (2–4 within this one destination), renders
 * each `ExperienceRowCard` with a compare checkbox, shows a sticky tray once
 * anything is selected, and opens `ExperienceCompareModal`. Selection is in-
 * memory per page visit (no URL param — plan Findings §IV). The RSC page passes
 * the whole `Destination`; nothing here needs the network.
 */
export function ExperienceComparePicker({ destination }: { destination: Destination }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const atMax = selected.length >= MAX_COMPARE;
  const ready = canCompare(selected);

  function toggle(id: string) {
    setSelected((cur) => toggleCompareSelection(cur, id));
  }

  function openCompare() {
    if (!ready) return;
    trackToursCompared({
      destinationSlug: destination.slug,
      city: destination.city,
      country: destination.country,
      experienceIds: selected,
    });
    setOpen(true);
  }

  return (
    <>
      <div className="mt-8 space-y-6">
        {destination.experiences.map((e) => (
          <ExperienceRowCard
            key={e.id}
            experience={e}
            destination={{ slug: destination.slug, city: destination.city, country: destination.country }}
            compare={{
              selected: selected.includes(e.id),
              disabled: atMax,
              onToggle: () => toggle(e.id),
            }}
          />
        ))}
      </div>

      {/* Sticky compare tray — appears once anything is selected. */}
      {selected.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-5">
          <div className="pointer-events-auto flex w-full max-w-2xl items-center justify-between gap-4 rounded-full border border-line bg-white px-5 py-3 shadow-[0_18px_40px_-20px_rgba(15,19,38,0.5)]">
            <p className="text-[13px] text-ink-soft">
              <span className="font-medium text-ink">{selected.length}</span> selected
              <span className="text-muted"> · pick 2–{MAX_COMPARE}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
              >
                <X size={14} /> Clear
              </button>
              <button
                type="button"
                onClick={openCompare}
                disabled={!ready}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Scale size={14} /> Compare ({selected.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <ExperienceCompareModal
          destination={destination}
          selectedIds={selected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: clean. Fix any errors before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/covilla/ExperienceRowCard.tsx apps/web/src/components/covilla/ExperienceComparePicker.tsx
git commit -m "feat(web): compare checkbox on cards + selection picker with tray (ST-18)"
```

---

### Task 4: Wire the picker into the destination page + full verification

**Files:**
- Modify: `apps/web/src/app/destinations/[slug]/page.tsx`

**Interfaces:**
- Consumes: `ExperienceComparePicker` (Task 3). Removes the direct `ExperienceRowCard` import/usage from the page (now owned by the picker).

- [ ] **Step 1: Swap the inline map for the picker**

In `apps/web/src/app/destinations/[slug]/page.tsx`:

Replace the import (line ~10):

```tsx
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
```

with:

```tsx
import { ExperienceComparePicker } from "@/components/covilla/ExperienceComparePicker";
```

Replace the experiences block (the `<div className="mt-8 space-y-6"> … d.experiences.map(...) … </div>`, currently lines ~229–237):

```tsx
            <div className="mt-8 space-y-6">
              {d.experiences.map((e) => (
                <ExperienceRowCard
                  key={e.id}
                  experience={e}
                  destination={{ slug: d.slug, city: d.city, country: d.country }}
                />
              ))}
            </div>
```

with:

```tsx
            <ExperienceComparePicker destination={d} />
```

(The picker renders its own `mt-8 space-y-6` list wrapper, so the surrounding markup is unchanged.)

- [ ] **Step 2: Typecheck, lint, full web test + build**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint && pnpm --filter @folio/web test && pnpm --filter @folio/web build`
Expected: all clean. `build` still prerenders every destination page (the picker is a client island inside the SSG page — the page stays static). If lint flags an unused `ArrowLeft`/import in the page, remove only what you actually orphaned.

- [ ] **Step 3: Verify in the browser preview**

Start the web dev server via preview (`preview_start` with `{ name: "web" }`), then on `/destinations/bangkok`:
- Confirm each experience card now shows a "Compare" checkbox.
- Select 2 tours → the sticky tray shows "2 selected" and **Compare (2)** is enabled → click it → the modal opens with 2 columns; confirm price/duration/rating/provider/free-cancellation rows.
- Select a 3rd and 4th → tray updates; open → 3 then 4 columns.
- Attempt a 5th → the 5th card's checkbox is disabled (title "You can compare up to 4 tours"); tray stays at 4.
- Deselect to 1 → **Compare** button is disabled (below the min of 2).
- Include at least one **non-live** Bangkok experience (one without a Viator match) in a set → confirm its Rating/Provider/Free-cancellation cells render "—", not a guessed value, and its CTA shows "Booking soon".
- Confirm a live column's CTA href is `/go/bangkok/<id>` (read_page / inspect the anchor) — do **not** follow it.
- Press Escape and click the backdrop → both close the modal.
- `read_console_messages` → no errors. Resize to mobile width → the table scrolls horizontally inside the modal; the page body doesn't overflow. Capture screenshots (2-col and 4-col) for the report.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/destinations/[slug]/page.tsx"
git commit -m "feat(web): mount compare picker on the destination page (ST-18)"
```

---

### Task 5: Log the as-built decision in the spec

**Files:**
- Modify: `docs/03-engineering-specification.md` (ST-18 line only)

**Interfaces:** none (docs).

- [ ] **Step 1: Append an as-built note under ST-18**

Under the ST-18 bullet in `docs/03-engineering-specification.md`, add a sub-line (keep the existing AC line intact; match the ST-17 as-built note's style):

```markdown
  - As built (2026-08-21): shipped on the **static** destination page as a client
    selection tray + side-by-side **modal** (no `/compare` route — a user-selected
    2–4 set has no SEO value). Compare is scoped to one destination; selection is
    in-memory (URL-param shareability deferred). Columns reuse ST-17's `/go` CTA
    seam + `trackAffiliateClick`. **Inclusions:** the static dataset has no
    itemized inclusions, so the compared cancellation row uses the one real policy
    signal (free cancellation) and a footnote points to each tour's provider page;
    true per-tour inclusions are deferred to the DB `Tour` model. New event:
    `tours_compared`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/03-engineering-specification.md
git commit -m "docs: record ST-18 as-built compare UX + inclusions deferral"
```

---

## Landing the PR

- [ ] **Step 1: Run the whole affected gate locally**

Run: `pnpm turbo run lint typecheck test --filter @folio/web && pnpm --filter @folio/web build`
Expected: green.

- [ ] **Step 2: Push the branch and open the PR against `master`**

```bash
git push -u origin stewie/st-18-tour-comparison-790eff
```

Open the PR (title `ST-18: compare 2–4 tours`), body summarising: the static-page client tray + modal decision and why not a route (Findings §III/§IV), the inclusions honest-absence call + free-cancellation stand-in (§I), the null-field handling across mixed live/sparse sets (§II), reuse of ST-17's `/go` CTA + pure helpers (§V), and the new `tours_compared` event. Note the CI-green requirement and that it does not deploy.

- [ ] **Step 3: Wait for CI green, then merge**

Confirm both CI jobs (`lint-typecheck-test`, `migrate`) pass — the web `test` task runs `experience-compare.spec` under Turbo `--affected`. Merge once green. (Do not deploy; no Render/Vercel triggers.)

---

## Self-Review

**1. Spec coverage (ST-18 AC — "Selecting 2–4 tours opens a comparison of price, duration, rating, provider, inclusions"):**
- "Selecting 2–4 tours" → `toggleCompareSelection` cap + `canCompare` gate (Task 1); checkbox per card + tray with disabled-at-4 / disabled-below-2 (Tasks 3–4). ✅
- "opens a comparison" → `ExperienceCompareModal` from the tray (Tasks 2–3). ✅
- "price" → `priceOf` (real `From $X` when matched, else editorial `priceBand`). ✅
- "duration" → `duration ?? null`. ✅
- "rating" → `ratingOf` (value + count) or null. ✅
- "provider" → `provider ?? null`. ✅
- "inclusions" → **not in the dataset**; compared cancellation row uses the real `freeCancel` signal + a footnote to the provider page; itemized inclusions flagged as deferred (Findings §I, Task 5). ✅ (honest partial, flagged — the ST-17 pattern)
- Traceability FR-DEST-4 / BG-2 — comparison decision aid over normalized tour facts. ✅

**2. Placeholder scan:** every code + test step carries real code; no "TBD"/"add error handling"/"similar to Task N". ✅

**3. Type consistency:** `toggleCompareSelection`/`canCompare`/`buildComparison`/`MAX_COMPARE` (Task 1) are called verbatim in Tasks 2–3; `ComparisonModel`/`CompareRow`/`CompareTour` shapes match their consumers; `ExperienceRowCard`'s new `compare?: { selected; disabled; onToggle }` prop matches the picker's call site; `ExperienceCompareModal` props `{ destination; selectedIds; onClose }` match the picker's usage; `trackToursCompared`'s object arg matches its call; reused `experienceGoHref`/`experienceDetailAffiliateInput`/`formatFromPrice`/`experienceDetailPath` signatures match ST-17's exports. ✅

**Test-bar check (task requirement):** 2 / 3 / 4 tours (buildComparison column-count cases), attempting a 5th (toggle no-op + `canCompare` false at 5), and missing/null fields across a mixed live+sparse set (rating/provider/freeCancel null alignment) — all present as pure unit tests in Task 1. ✅

**Open items for the reviewer (Roy):** (a) accept **free-cancellation-as-the-inclusion-signal + footnote** vs. holding an inclusions row until the DB `Tour` carries real inclusions (Findings §I); (b) accept the **client modal, no `/compare` route** and **in-memory selection (no `?compare=` URL param)** vs. wanting a shareable/linkable comparison (Findings §IV); (c) confirm **compare scoped within one destination** is the intended UX (vs. cross-destination compare).
```
