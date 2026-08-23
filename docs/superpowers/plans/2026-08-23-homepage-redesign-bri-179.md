# Homepage Redesign (BRI-179) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/web/src/app/page.tsx`'s section list around a search-forward hero and a real destination showcase, cut sections that are either fake, redundant, or point at pages that don't exist, and leave every kept section's Covilla visual treatment untouched — content/structure only, no design-token or visual-effect changes.

**Architecture:** The homepage stays a plain server component (`page.tsx`) composing section components from `src/components/covilla/`. Two new sections are added (`SearchHero`, `DestinationShowcase`), both plain server components with zero client-side state — the search box is a native `GET` form to `/search`, so it works with zero JS and needs no new analytics wiring (the existing `/search` page already fires `search_performed` on landing — see Decision 5). Three real, already-honest sections are kept unmodified (`HowItWorks`, `BenefitsSection`, `TrustSection`). Five sections/files that are fake, redundant, or decorative-only are deleted outright rather than left as dead code, matching this repo's existing "delete orphaned code" convention (see `c8ac5f8`, the BRI-178 follow-up).

**Tech Stack:** Next.js 15 (App Router, RSC), TypeScript, Tailwind v4, `@folio/shared` domain types. No new dependencies; `embla-carousel-react` is removed (see Decision 6).

**Spec:** Linear [BRI-179](https://linear.app/bridgexconnect/issue/BRI-179/homepage-redesign-structurecontent-only-decoupled-from-upcoming-visual). This plan documents the Step 1 audit inline (Decisions 1–2 below) because the ticket's proposed structure was written from a high-level pass that turned out to be wrong about which sections are fake — the audit output *is* the spec correction.

## Global Constraints

- **Structure/content only — no visual design changes.** Every kept component's existing markup/classes/animation stays byte-for-byte identical; only which components are mounted, in what order, and with what data changes. New components use only class patterns already established elsewhere in the codebase (no new visual language).
- **Never invent a fact.** No new copy states a claim Folio Voyage can't back up today (see Decision 3 — this is why the hero does *not* get a photo carousel or a "trusted by X travellers" line).
- **Don't link to a page that doesn't exist.** No `/about`, `/collections`, or itinerary links ship in this pass (explicit user instruction). Every link this plan adds resolves to a real, already-shipped route: `/search`, `/destinations`, `/destinations/:slug`.
- **Analytics:** no new `posthog.capture` calls are added by this plan (Decision 5 explains why the obvious spot — the hero search submit — would double-count an event `/search` already fires). If a future pass wants hero-attribution analytics, extend `trackSearch`/`SearchAnalytics` with a `source` field rather than inlining a second capture.
- **Verification:** `pnpm --filter @folio/web build`, `pnpm --filter @folio/web lint`, `pnpm --filter @folio/web typecheck` after every task. This plan adds no new pure logic, so there are no new `.spec.ts` files — RSC/JSX correctness is verified by `next build` per the existing `jest.config.js` convention ("Only the pure, next-free lib modules are tested here; RSC/JSX is verified by `next build`, not jest").

---

## Decisions (the Step 1 audit — read before objecting to a task)

### Decision 1 — What's actually in each current section, verified against source

| Component | BRI-179's assumption | What's actually there | Verdict |
|---|---|---|---|
| `TestimonialParallax` (`data/testimonials.ts`) | "very likely fabricated... unsourced, template-pattern quotes" | Every quote is explicitly attributed to `name: "Folio Voyage"` itself (never a fake customer name), and the file's own header comment states why: *"Folio Voyage is pre-launch and has no booking history... inventing [testimonials] would be exactly the kind of fake social proof an affiliate reviewer distrusts. Instead this band carries the site's own editorial promises."* The homepage already passes `eyebrow="What we stand for"`, not the component's default "What travellers say". **Not fabricated — already honest.** | Cut anyway, but for a different, real reason: **redundancy** (Decision 2), not fabrication. |
| `PopularVacations` | (assumed real, not challenged) | Genuinely data-driven: `items` are mapped straight from `getAllDestinations()`'s real `experiences` (title/description/image/priceBand all from `destinations.ts`), links go to real `/destinations/:slug`, price is shown as an honest band (`$`/`$$`/`$$$`), and it fires real PostHog events. **Confirmed real.** | Keep the component (it's also used on `/destinations`, untouched) — but drop it from the **homepage**, since the new `DestinationShowcase` covers "browse the 6 cities" and `/destinations` is the right home for the country-by-country experience browse. Homepage showing the identical component as `/destinations` one click away is redundant, not fake. |
| `GalleryRow` | bucketed as "generic template sections... discard by default" | Real destination photography (Rome/Kyoto/Bangkok/Hanoi/Lisbon/Bali), but zero content: no links, no captions beyond alt text, no data. A decorative image strip. | **Confirmed generic/decorative.** Cut, matches the ticket's default assumption. |
| `HowItWorks` | bucketed as "generic template sections... discard by default" | Genuinely specific, honest copy written for Folio Voyage: 4 steps (pick a destination → shortlist experiences → book with confidence → travel, then tell us), including an honest present-tense caveat *"As partner programs go live, book vetted operators directly... Until then, every recommendation stands on its own."* This is the only section on the page that explains site **mechanics** to a first-time visitor — no other kept section does this. **Not generic — the ticket's default assumption was wrong here.** | **Keep**, correcting the ticket's proposed removal. |
| `PromiseBand` | bucketed as "generic template sections... discard by default" | Real image + link to `/legal/contact`, but the copy itself ("Peace of mind from the first idea to the trip itself") is vague filler that adds no information beyond what `TrustSection`/`BenefitsSection` already say. | **Confirmed generic.** Cut from the homepage — matches the ticket's default. Component stays untouched on `/destinations`, where it acts as a bottom-of-funnel contact CTA after a browse session (different, legitimate role there). |
| `BenefitsSection` | not named in the ticket | Real, specific "why we're different" copy (hands-on curation, honest pricing, no pay-for-rank) with a working CTA to `/destinations`. This already **is** the "Why Atlas / differentiation teaser" item 3 asks for. | **Keep as the differentiation teaser**, unmodified. |
| `AboutSection` | not named in the ticket | Real mission copy ("A curated travel folio, not another listings site") but zero links/CTA, and says roughly the same thing as `BenefitsSection` in prose form. | Cut — redundant with `BenefitsSection` (Decision 2), and per the "don't link to `/about`" constraint there's nowhere honest for it to point right now anyway. |
| `TrustSection` | "Trust/disclosure section — keep, already correct" | Confirmed: independence, vetting, transparency, local-knowledge — real per-point copy, real images, matches the ticket's own description exactly. | **Keep, unmodified** — ticket was right about this one. |
| `HeroSlider` | implicitly replaced by item 1 (search-forward hero) | A Covilla marketing-slider hero whose "video-play accent" opens a modal that says *"Destination films are coming soon"* — vaporware content advertising a feature that doesn't exist. CTA is "Contact us", not search or browse. | **Cut, replaced by `SearchHero`.** |
| `AcrossWorldSlider` | implicitly replaced by item 2 (destination showcase) | Real, data-driven (all 6 cities, real images, real experience counts, real links to `/destinations/:slug`) — genuinely close to what item 2 asks for. But it never links to `/destinations` itself, only to individual guides, and it's an embla "coverflow" carousel — a Covilla-specific visual effect this task is meant to avoid baking into the *content structure*. | **Cut, replaced by `DestinationShowcase`** (same real data, plain grid + explicit `/destinations` link, no carousel dependency). |

### Decision 2 — Why cut real, honest content: four sections were making the same pitch

After removing what's fake/decorative, the *current* page still stacks four separate sections that all exist to say "you can trust our curation and our honesty about commissions": `BenefitsSection` ("Honest by design... commissions never buy a ranking"), `TestimonialParallax` ("commission never moves anything up the page"), `AboutSection` ("it never buys a recommendation. The trust is the whole point"), `TrustSection` ("Commissions fund the work; they never buy a recommendation"). That's the same claim, four times, in four different visual formats. This is a real structural problem the ticket's "likely fabricated" framing didn't name correctly — the actual issue is redundancy, not dishonesty. Keeping all four would be un-fixed bloat under a corrected excuse; keeping none would delete two sections (`BenefitsSection`, `TrustSection`) the ticket explicitly wants kept. **Resolution:** keep exactly one differentiation section (`BenefitsSection`, item 3) and one trust/disclosure section (`TrustSection`, item 4, explicitly blessed by the ticket) — cut `TestimonialParallax` and `AboutSection` as the redundant repeats. `TestimonialParallax`'s underlying data (`testimonials.ts`) and component have no other importer, so both are deleted rather than left as dead code.

### Decision 3 — Hero has no photo, no carousel, no invented claims

The hero is rebuilt as: eyebrow (`site.tagline`, already-established brand copy) → H1 → one line of subtext → a `GET /search` form → quick links to the 6 curated cities. Deliberately **no background photograph, no parallax, no carousel, no "trusted by" claim, no fabricated stat.** Two reasons: (1) `HeroSlider`'s only real content beyond the photo was a fake "destination films" teaser — there's no honest full-bleed hero content to carry forward; (2) a plain content band (matching the existing `bg-surface` header pattern already used on `/search` and `/destinations`) is the least visually opinionated choice available, which is exactly what "swapping the visual system later should be a skin change" requires — nothing here for a designer to have to *undo* first.

### Decision 4 — Destination showcase reuses `DestinationCard`, not a new carousel

`DestinationCard` (`src/components/DestinationCard.tsx`) already exists, is already real (image, city, country, live experience count, links to `/destinations/:slug`), and is already reused across the app (`/search` destination results). Building `DestinationShowcase` as a plain responsive grid of `DestinationCard` — instead of porting `AcrossWorldSlider`'s embla coverflow — reuses an existing component (per the task's explicit instruction) and avoids adding a second, homepage-only carousel dependency for a section whose whole point is to be simple to re-skin later.

### Decision 5 — No new PostHog capture on the hero search submit

The natural instinct is to fire a `posthog.capture` when the hero search form submits. But landing on `/search?q=...` already renders `<SearchAnalytics>` (`app/search/SearchAnalytics.tsx`), which fires `search_performed` (via the centralised `trackSearch` helper in `lib/analytics.ts`) with the real, server-computed result count for that exact query — on every non-empty query, regardless of entry point. A second capture at the hero submit point would be a near-duplicate event with a worse payload (no result count yet). The hero form is therefore a bare native `<form action="/search" method="GET">` — no `'use client'`, no JS required for its primary interaction, no new analytics surface. (If homepage-attribution for search becomes valuable later, the correct extension is a `source` field threaded through `SearchState` → `trackSearch`, not a second inline capture — flagged here, not built here.)

### Decision 6 — `embla-carousel-react` becomes unused

Confirmed via `grep`: `embla-carousel-react` is imported only by `HeroSlider.tsx` and `AcrossWorldSlider.tsx`, both deleted by this plan. No other file in `apps/web` imports it. Removing the dependency is in scope (it's a direct, mechanical consequence of deleting its only two consumers, not a separate refactor).

### Decision 7 — Metadata: additive only, verified against Next's actual merge behavior

`page.tsx` currently exports no `metadata`, so the homepage inherits `apps/web/src/app/layout.tsx`'s root metadata (title, description, OpenGraph, Twitter, robots — all real, already good, sourced from `site.ts`). Next.js's App Router metadata resolver (`mergeMetadata` in `next/src/lib/metadata/resolve-metadata.ts`) merges **per top-level key**: a child that doesn't export a given key inherits the parent's resolved value for it untouched; a child that *does* export a key replaces that key's value wholesale. `layout.tsx` sets no `alternates` key at all, so adding `export const metadata: Metadata = { alternates: { canonical: "/" } }` to `page.tsx` is purely additive — title/description/OG/Twitter/robots are untouched because `page.tsx`'s export doesn't mention those keys. This brings the homepage in line with `/search` and `/destinations`, which both already set their own canonical. Separately, the existing `WebSite` JSON-LD gains a real `potentialAction: SearchAction` pointing at `/search?q={search_term_string}` (Google's "sitelinks search box" schema) — genuinely accurate now that `/search` exists and accepts `?q=`, and directly reflects the new search-forward hero.

### Final section list

1. `CovillaHeader` (chrome, unchanged, `transparent` prop **dropped** — see Task 3)
2. `FixedRail`, `Preloader` (chrome, unchanged)
3. **`SearchHero`** (new) — search-forward hero
4. **`DestinationShowcase`** (new) — the 6 curated cities, links to `/destinations/:slug` + `/destinations`
5. `HowItWorks` (kept, unchanged) — real "how this site works" mechanics
6. `BenefitsSection` (kept, unchanged) — the differentiation teaser (item 3)
7. `TrustSection` (kept, unchanged) — trust/disclosure (item 4)
8. `CovillaFooter` (chrome, unchanged)

Cut from the homepage: `HeroSlider`, `AcrossWorldSlider`, `TestimonialParallax`, `PopularVacations`, `PromiseBand`, `AboutSection`, `GalleryRow`. Of these, `HeroSlider`, `AcrossWorldSlider`, `TestimonialParallax`, `AboutSection`, `GalleryRow` have no other importer anywhere in the app and are deleted outright (along with `data/testimonials.ts`). `PopularVacations` and `PromiseBand` stay — both are still used, unmodified, by `/destinations`.

---

## File Structure

- `apps/web/src/components/covilla/SearchHero.tsx` — **create.** Server component. Search-forward hero: eyebrow, H1, subtext, `GET /search` form, quick links to the 6 cities.
- `apps/web/src/components/covilla/DestinationShowcase.tsx` — **create.** Server component. Eyebrow/H2 + grid of `DestinationCard` for all curated destinations + "Browse all destinations" CTA to `/destinations`.
- `apps/web/src/app/page.tsx` — **modify.** New section list, new imports, `metadata` export, `potentialAction` on the JSON-LD, header `transparent` prop dropped, `<main>` gets `pt-20`.
- `apps/web/src/components/covilla/HeroSlider.tsx` — **delete.**
- `apps/web/src/components/covilla/AcrossWorldSlider.tsx` — **delete.**
- `apps/web/src/components/covilla/TestimonialParallax.tsx` — **delete.**
- `apps/web/src/components/covilla/AboutSection.tsx` — **delete.**
- `apps/web/src/components/covilla/GalleryRow.tsx` — **delete.**
- `apps/web/src/data/testimonials.ts` — **delete.**
- `apps/web/package.json` — **modify.** Remove `embla-carousel-react`.

---

## Task 1: `SearchHero` component

**Files:**
- Create: `apps/web/src/components/covilla/SearchHero.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces (relied on by Task 3): `SearchHero({ destinations }: { destinations: { slug: string; city: string; country: string }[] })` — a plain server component, default export is named `SearchHero`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/covilla/SearchHero.tsx
import Link from "next/link";
import { Search } from "lucide-react";
import { site } from "@/lib/site";

/**
 * Search-forward homepage hero. Deliberately a plain content band (no photo,
 * no carousel) — the least visually opinionated hero available, so a future
 * visual pass is a skin change, not a rebuild. The search form is a native
 * GET to /search; landing there already fires the `search_performed`
 * analytics event (see SearchAnalytics), so this component adds no client JS
 * and no new PostHog capture.
 */
export function SearchHero({
  destinations,
}: {
  destinations: { slug: string; city: string; country: string }[];
}) {
  return (
    <section className="border-b border-line bg-surface">
      <div className="container-page py-16 md:py-24">
        <p className="eyebrow">{site.tagline}</p>
        <h1 className="mt-4 max-w-2xl text-[40px] font-semibold leading-[1.08] md:text-[60px]">
          Where do you want to go?
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-8 text-ink-soft">
          Search hand-picked experiences across our curated destinations, or
          jump straight into a city guide.
        </p>

        <form
          action="/search"
          method="GET"
          role="search"
          className="relative mt-9 max-w-xl"
        >
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            placeholder="Search experiences and destinations…"
            aria-label="Search experiences and destinations"
            className="w-full rounded-[3px] border border-line bg-white py-4 pl-11 pr-32 text-[15px] text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1.5 bottom-1.5 inline-flex items-center bg-accent px-6 text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-accent-ink"
          >
            Search
          </button>
        </form>

        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted">
            Popular:
          </span>
          {destinations.map((d) => (
            <Link
              key={d.slug}
              href={`/destinations/${d.slug}`}
              className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              {d.city}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: both PASS (no errors). `SearchHero.tsx` is not wired into any page yet, so there is nothing to render or browse-check until Task 3 — this step only confirms the file itself is well-typed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/covilla/SearchHero.tsx
git commit -m "feat(web): add search-forward SearchHero component (BRI-179)"
```

---

## Task 2: `DestinationShowcase` component

**Files:**
- Create: `apps/web/src/components/covilla/DestinationShowcase.tsx`

**Interfaces:**
- Consumes: `Destination` type from `@/data/types` (fields used: `slug`, `city`, `country`, `heroImage`, `heroImageAlt`, `experiences` — same shape `DestinationCard` already consumes); `DestinationCard` from `@/components/DestinationCard` (existing, unmodified); `Reveal` from `./Reveal` (existing, unmodified).
- Produces (relied on by Task 3): `DestinationShowcase({ destinations }: { destinations: Destination[] })` — plain server component, named export `DestinationShowcase`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/covilla/DestinationShowcase.tsx
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DestinationCard } from "@/components/DestinationCard";
import { Reveal } from "./Reveal";
import type { Destination } from "@/data/types";

/**
 * Real destination showcase: every curated city, reusing the existing
 * DestinationCard (already used by /search's destination results) in a plain
 * responsive grid rather than a Covilla-specific carousel — see the plan's
 * Decision 4.
 */
export function DestinationShowcase({
  destinations,
}: {
  destinations: Destination[];
}) {
  return (
    <section className="container-page py-24 md:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal className="max-w-xl">
          <p className="eyebrow">Folio destinations</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.1] md:text-[46px]">
            Six cities, each researched and written by hand
          </h2>
        </Reveal>
        <Link
          href="/destinations"
          className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
        >
          Browse all destinations <ArrowUpRight size={15} />
        </Link>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((d, i) => (
          <Reveal key={d.slug} delay={i * 90}>
            <DestinationCard destination={d} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/covilla/DestinationShowcase.tsx
git commit -m "feat(web): add DestinationShowcase component reusing DestinationCard (BRI-179)"
```

---

## Task 3: Rewire `page.tsx`

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `SearchHero` (Task 1), `DestinationShowcase` (Task 2), `HowItWorks`/`BenefitsSection`/`TrustSection`/`CovillaHeader`/`CovillaFooter`/`FixedRail`/`Preloader` (all existing, unmodified), `getAllDestinations`/`getNavDestinations` (existing, unmodified), `site` (existing, unmodified).
- Produces: nothing (leaf of this plan's dependency chain — Task 4 depends on this task only in that it must land first so the deleted files have zero remaining importers).

- [ ] **Step 1: Replace the file**

```tsx
// apps/web/src/app/page.tsx
import type { Metadata } from "next";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { FixedRail } from "@/components/covilla/FixedRail";
import { Preloader } from "@/components/covilla/Preloader";
import { SearchHero } from "@/components/covilla/SearchHero";
import { DestinationShowcase } from "@/components/covilla/DestinationShowcase";
import { BenefitsSection } from "@/components/covilla/BenefitsSection";
import { HowItWorks } from "@/components/covilla/HowItWorks";
import { TrustSection } from "@/components/covilla/TrustSection";
import { getAllDestinations, getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  const nav = getNavDestinations();
  const destinations = getAllDestinations();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    description: site.description,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${site.url}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <Preloader />
      <CovillaHeader destinations={nav} />
      <FixedRail />

      <main className="pt-20">
        <SearchHero destinations={nav} />

        <DestinationShowcase destinations={destinations} />

        <HowItWorks />

        <BenefitsSection />

        <TrustSection />
      </main>

      <CovillaFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @folio/web build`
Expected: PASS. This is the real correctness check for this task — RSC/JSX has no jest coverage in this repo (`jest.config.js`: "RSC/JSX is verified by `next build`, not jest"), so a clean build is the equivalent of a passing test here. A failure here means either a removed import is still referenced somewhere, or a prop type mismatch on `SearchHero`/`DestinationShowcase`.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: both PASS.

- [ ] **Step 4: Manual browser check**

Start the dev server (`pnpm --filter @folio/web dev`) and open `/`:
- Header renders solid (not transparent-over-photo) from the first scroll pixel — confirms dropping the `transparent` prop worked and `pt-20` prevents the hero from sitting under the fixed header.
- Hero search box: type a query that has real results (e.g. "temple") and submit — confirms it lands on `/search?q=temple` with results, not a client error.
- Hero quick-links: click one destination chip — confirms it lands on `/destinations/<slug>`.
- Destination showcase: all 6 cities render as cards; "Browse all destinations" link lands on `/destinations`.
- Scroll through `HowItWorks` → `BenefitsSection` → `TrustSection` — confirms no removed-component gap and no duplicate "why trust us" messaging.
- View page source or DevTools → confirm the `application/ld+json` script now includes `potentialAction`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): rebuild homepage around search-forward hero + destination showcase (BRI-179)"
```

---

## Task 4: Remove orphaned sections, data, and dependency

**Files:**
- Delete: `apps/web/src/components/covilla/HeroSlider.tsx`
- Delete: `apps/web/src/components/covilla/AcrossWorldSlider.tsx`
- Delete: `apps/web/src/components/covilla/TestimonialParallax.tsx`
- Delete: `apps/web/src/components/covilla/AboutSection.tsx`
- Delete: `apps/web/src/components/covilla/GalleryRow.tsx`
- Delete: `apps/web/src/data/testimonials.ts`
- Modify: `apps/web/package.json`

**Interfaces:** none — this task only removes files with zero remaining importers after Task 3 landed.

- [ ] **Step 1: Confirm zero remaining importers**

Run (from `apps/web/src`):

```bash
grep -rln "HeroSlider\|AcrossWorldSlider\|TestimonialParallax\|AboutSection\|GalleryRow\|data/testimonials" --include="*.tsx" --include="*.ts" .
```

Expected: no output (or only the files' own definitions, which are about to be deleted). If any other file still imports one of these, stop and investigate before deleting — do not delete a file with a live importer.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/web/src/components/covilla/HeroSlider.tsx \
       apps/web/src/components/covilla/AcrossWorldSlider.tsx \
       apps/web/src/components/covilla/TestimonialParallax.tsx \
       apps/web/src/components/covilla/AboutSection.tsx \
       apps/web/src/components/covilla/GalleryRow.tsx \
       apps/web/src/data/testimonials.ts
```

- [ ] **Step 3: Remove the now-unused `embla-carousel-react` dependency**

Confirm no remaining usage first:

```bash
grep -rl "embla-carousel" apps/web/src
```

Expected: no output. Then remove it:

```bash
pnpm --filter @folio/web remove embla-carousel-react
```

This updates `apps/web/package.json` and the root `pnpm-lock.yaml`.

- [ ] **Step 4: Build and typecheck**

Run: `pnpm --filter @folio/web build && pnpm --filter @folio/web typecheck && pnpm --filter @folio/web lint`
Expected: all PASS — confirms nothing else referenced the deleted files or the removed dependency.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(web): remove homepage sections orphaned by BRI-179 redesign"
```

---

## Task 5: Full regression pass

**Files:** none — verification only.

**Interfaces:** none.

- [ ] **Step 1: Full workspace build**

Run: `pnpm build` (repo root — builds every workspace via Turbo)
Expected: PASS for `@folio/web` and `@folio/api`.

- [ ] **Step 2: Full lint + typecheck**

Run: `pnpm lint && pnpm typecheck` (repo root)
Expected: PASS.

- [ ] **Step 3: API test suite (unaffected, but confirms nothing cross-workspace broke)**

Run: `pnpm --filter @folio/api test`
Expected: PASS (this plan touches `apps/web` only, so this is a sanity check, not expected to catch anything).

- [ ] **Step 4: Browser regression on the two pages that share components with the homepage**

With the dev server running, check:
- `/destinations` — `PopularVacations` and `PromiseBand` still render correctly (both untouched by this plan, but both import from `destinations-helpers.ts`, which this plan didn't modify — confirm no accidental breakage).
- `/search` — still renders results, `DestinationCard` (now also used on the homepage) still renders identically there.

- [ ] **Step 5: Confirm PR-readiness**

Run: `git status` and `git log --oneline -6` to confirm all five tasks are committed and the working tree is clean. Do not push or open a PR yet — report back for review per the task's instructions.
