# Scope: SEO proving slice, Bangkok (BRI-114)

A test, not a launch. You put 7 Bangkok pages into Google (the hub, 5 category pages and the stats page; 6 of them are topic pages) while the rest of the site stays gated, then read Search Console at weeks 2, 4, 8 and 12 to learn whether curated pages with visible logic, facts computed across tours, and a house voice can win where demand exists and the results page is weak (rows 18 to 27). Source: [the slice brief](../../superpowers/plans/2026-10-14-seo-slice-brief.md), sections 3 and 4 set the boundary. Spans both apps. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

**The page list (approved, 15 Oct 2026):** things to do in bangkok (the hub), bangkok floating market, thailand temples bangkok, spa and massage in Bangkok, muay thai bangkok, day trips from bangkok, cooking class bangkok, bangkok cruise, plus one stats page. "Private tour bangkok thailand" is dropped (no group size field). No control pages qualified.

**Held pages (decided 15 Oct 2026):** `muay-thai` (6 eligible tours) and `spa-and-massage` (3 eligible tours) stay in the manifest with `"held": true` and are not published, because both fall under the 10 tour floor (most of their tours have fewer than 5 reviews, so the BRI-200 gate drops them). They are never indexed, so a week 12 readout must not count them as ranking failures. A later snapshot run can unhold either one once it reaches 10 eligible tours ([spec 0006](../../specs/_root/0006-seo-proving-slice/index.md), Follow-up).

**Recorded before launch, so a miss reads correctly:**
- The spa and massage page is judged on a navigational head query. A miss at week 8 is an intent failure, not a verdict on the approach. (It is held for now, see Held pages; this applies only if it is unheld.)
- `ItemList` markup will not earn a carousel in the US, UK or AU. It stays on the pages, and no carousel at week 8 is not a failure.
- With no controls, the brief's "controls are the quality signal" (section 2) has nothing to read until the control research PR (below) adds them.

## Foundations

### 18. Gate allowlist, robots and a slice only sitemap · in-progress · Beta
Let anonymous visitors and crawlers reach only the slice URLs, `/go/`, `/ingest` and the slice sitemap while the gate stays on, with robots and the sitemap rewritten to match. This is the only row that blocks even a private crawl test, so it goes first.
**Done when:** with the gate on, an anonymous request to any slice URL, `/go/`, `/ingest` or the sitemap passes and every other path still shows the gate; a test enumerates the sitemap and finds only slice pages, each with `lastModified` from its snapshot date.
- [x] Design it (spec): [0006 gate, robots and sitemap](../../specs/_root/0006-seo-proving-slice/0006-gate-robots-sitemap.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop gate allowlist, robots and a slice only sitemap`
  - [ ] Shared types, the hash recipe with its golden vector test, and `seo:index` with its staleness test (umbrella AC-1, AC-2)
  - [ ] Gate helper and middleware wiring, empty live set included (AC-G1, AC-G2, AC-G3, AC-G7)
  - [ ] Gated robots with the `/_next/` allow (AC-G4)
  - [ ] `/sitemap-slice.xml` and its enumeration test (AC-G5, AC-G6)
- [ ] Verify it: `/check verify gate allowlist, robots and a slice only sitemap`
- [ ] Test it: `/test gate allowlist, robots and a slice only sitemap`

### 19. Page list and tour membership rule · in-progress
The manifest of the 9 pages, and the rule that decides which Bangkok tours belong on each page. Coordinates alone cannot decide it (612 of 2,589 Bangkok tours have none), and off city tours must stay out (Phuket, Phi Phi, Krabi, Samui, and 2 Pattaya floating market tours). The BRI-200 gate is a yes or no filter only; ordering uses static fields, never ratings.
**Done when:** each page has a written membership rule, every live page has at least 10 eligible tours, and none of the named off city tours appears on any page.
- [x] Design it (spec): [0006 manifest and membership](../../specs/_root/0006-seo-proving-slice/0006-page-manifest-membership.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop page list and tour membership rule`
  - [ ] Manifest with the 9 pages, H1s, plain words, exclusions and tag names; spa and muay thai held (AC-M1, AC-M3)
  - [ ] `selectMembers` with the off city, ordering and hub pick tests (AC-M2 to AC-M8)
  - [ ] Slug test in apps/web (AC-M9)
- [ ] Verify it: `/check verify page list and tour membership rule`

### 20. Snapshot files from prod, read only · in-progress
A command that reads prod read only and writes one committed, dated snapshot file per page: its computed facts and its pick list, with a computed on date and a grounding hash. Pages build from these files, never from live database reads.
**Done when:** running the command produces committed snapshot files for the 7 live pages (the 2 held pages get none), each with its date and hash, and a rerun on unchanged data gives the same hash.
- [x] Design it (spec): [0006 prod snapshot](../../specs/_root/0006-seo-proving-slice/0006-prod-snapshot.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop snapshot files from prod, read only`
  - [ ] Facts constants and builder with tests (AC-S4, AC-S8)
  - [ ] `seo:snapshot` with the read only guard, manifest validation, writer and automatic index step (AC-S1 to AC-S3, AC-S5 to AC-S7, AC-S9)
  - [ ] First read only run against prod, files committed (umbrella AC-6)
- [ ] Verify it: `/check verify snapshot files from prod, read only`

## Slice 1: the Bangkok hub, end to end

### 21. Hub page template and URL · in-progress
The route and page template, proven first on "things to do in bangkok": URL, layout, breadcrumbs, `ItemList` and breadcrumb structured data with no ratings, the affiliate disclosure, the "computed on" date and the "How this page was made" note. The default URL is `/destinations/bangkok/{page}`, which has to live alongside the `[slug]/[city]` redirect handler.
**Done when:** the hub renders statically from its snapshot at its final URL, and a test of its server HTML and JSON-LD finds no rating, review count, price, availability or cancellation term.
- [x] Design it (spec): [0006 page template](../../specs/_root/0006-seo-proving-slice/0006-page-template.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop hub page template and URL`
  - [ ] Static route, slice layout and components, proven on the hub (AC-T1, AC-T3, AC-T5, AC-T10)
  - [ ] How this page was made note, disclosure, breadcrumbs and JSON-LD (AC-T4, AC-T7, AC-T8, AC-T11)
  - [ ] Leak scan on the built HTML with its CI step, link audit and route regression tests (AC-T2, AC-T6, AC-T9)
- [ ] Verify it: `/check verify hub page template and URL`

### 22. Rating free pick card and campaign tagged click out · in-progress
A pick card with no price, availability, cancellation or rating, that links only to `/go/tours/*` (never to a `/tours/` or experience page), and a click out that records which slice page sent it, checked against an allowlist of slice page ids so it cannot become an open tagging route. Today `tour-go.ts` hardcodes `canvas-tour`.
**Done when:** a click from the hub reaches Viator carrying that page's campaign, the click ledger can tell which page sent it, an unknown campaign value is refused or ignored, and the card's affiliate links carry the agreed `rel` values.
- [x] Design it (spec): [0006 pick card and campaign](../../specs/_root/0006-seo-proving-slice/0006-pick-card-campaign.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop rating free pick card and campaign tagged click out`
  - [ ] `AffiliateClick.campaign` migration and the API field (AC-C5, AC-C6)
  - [ ] `tour-go.ts` campaign check against the live set and the fallback log (AC-C3, AC-C4)
  - [ ] Pick card and its click event (AC-C1, AC-C2, AC-C7)
- [ ] Verify it: `/check verify rating free pick card and campaign tagged click out`

### 23. Hub copy in the house voice · in-progress
Teach the content engine a hub input: a prompt, the voice guide's banned patterns as blocking checks, claim tracing against the snapshot and listed sources, and committed storage with the grounding hash. Proven first on the hub page. Every page and its metadata gets a human fact check (Google's 1 Oct 2026 guidance), and the generated text never states price, availability or cancellation.
**Done when:** the hub's intro and metadata pass every blocking check and claim trace, are stored as committed files with their hash, render on the page, and Roy has fact checked them.
- [x] Design it (spec): [0006 hub copy](../../specs/_root/0006-seo-proving-slice/0006-hub-copy.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop hub copy in the house voice`
  - [ ] Adapter `maxTokens` option and `HUB_COPY_MODEL` (AC-H1)
  - [ ] Prompt, blocking checks, claim trace and the per field retry loop (AC-H2 to AC-H4, AC-H8)
  - [ ] `hub-copy:run` and `hub-copy:approve` (AC-H5 to AC-H7)
  - [ ] Hub generated, rendered and fact checked by Roy (AC-H9)
- [ ] Verify it: `/check verify hub copy in the house voice`

## Slice 2: widen to all 9 pages

### 24. The five category pages and the first batch calibration · in-progress
Generate and publish the five category pages that are not held through the same path, then run the first batch calibration on the 6 topic pages (the hub plus the five), where 2 or more failures fails the batch: change the prompt, guide or checks (never single pages) and regenerate within the limits row 23's spec sets.
**Done when:** all 6 topic pages are live behind the allowlist, the calibration result is recorded, and every page has passed the human fact check.
- [x] Design it (spec): covered by [0006 hub copy and calibration](../../specs/_root/0006-seo-proving-slice/0006-hub-copy.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop the seven category pages and the first batch calibration`
  - [ ] Generate the 5 category pages that are not held (AC-H10)
  - [ ] Run the batch calibration and record every round, resample and held page (AC-H10 to AC-H12)
  - [ ] Roy fact checks each passing page (AC-H6)
- [ ] Verify it: `/check verify the seven category pages and the first batch calibration`

### 25. Stats page · in-progress
One page of facts computed across Bangkok's tours (for example durations, inclusions, categories), with no price, rating or cancellation statistics. It is the slice's only linkable asset, and a thin one without price data.
**Done when:** the stats page renders from its snapshot with its computed on date, every number traces to the snapshot, and the leak test passes on it.
- [x] Design it (spec): [0006 stats page](../../specs/_root/0006-seo-proving-slice/0006-stats-page.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop stats page`
  - [ ] Stats facts in the snapshot command (AC-D1)
  - [ ] Stats body from fixed templates (AC-D2 to AC-D4)
  - [ ] Number trace test (AC-D5)
- [ ] Verify it: `/check verify stats page`

## Slice 3: measure it

### 26. Search Console and measurement plumbing · in-progress
Verify the Search Console property, submit the slice sitemap, set up a weekly export, and confirm analytics IDs and the disclosure are on every page.
**Done when:** the property is verified, the sitemap is submitted and read, and the first weekly export file exists in the agreed format.
- [x] Design it (spec): [0006 measurement](../../specs/_root/0006-seo-proving-slice/0006-measurement.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop search console and measurement plumbing`
  - [ ] Slice PostHog settings (AC-R6)
  - [ ] `seo:gsc-export` and `seo:clicks` with stubbed tests (AC-R2 to AC-R5)
  - [ ] Property verified, sitemap submitted and first export run, done by Roy (AC-R1, AC-R7)
  - [ ] Readout template with week 0 and the fixed bars (AC-R8)
- [ ] Verify it: `/check verify search console and measurement plumbing`

### 27. Checkpoint readouts at weeks 2, 4, 8 and 12 · in-progress
Read each checkpoint against the measures fixed before launch: crawled (week 2), at least 50% indexed is a pass and 80% good (week 4), impressions (week 8), top 20 and click outs (week 12). Use the recorded caveats above when reading a miss.
**Done when:** all four readouts are recorded with their numbers and a pass or miss call against the fixed measures.
- [x] Design it (spec): covered by [0006 measurement](../../specs/_root/0006-seo-proving-slice/0006-measurement.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop checkpoint readouts`
  - [ ] Week 2 readout (AC-R9)
  - [ ] Week 4 readout (AC-R9)
  - [ ] Week 8 readout (AC-R9)
  - [ ] Week 12 readout (AC-R9)
- [ ] Verify it: `/check verify checkpoint readouts at weeks 2, 4, 8 and 12`

## Before launch, outside this slice
Separate work this slice depends on. Each ships on its own, not in this build order.
- **Home page and disclosure fixes** (small PR, before launch): remove the home page claims that contradict F1 (C7, for example `first-hand knowledge` in `TrustSection.tsx`), extend `/legal/disclosure` to cover machine written content (C6), and remove the retired `SearchAction` markup from `apps/web/src/app/page.tsx`.
- **Control pages research** (small PR, before launch): a research module extension for the advanced results page, about $0.50 through the spend guard, to find control queries.
- **Consent and privacy**: a cookie consent flow (PostHog replay samples about 50% today). A launch prerequisite, its own task.
- **BRI-254, experience page `AggregateRating`**: has a Google basis as well as Viator's. Does not block the slice (those pages stay gated and unlinked) but blocks any wider launch.
- **Vercel Pro**: the project is on Hobby (non commercial), needed at public launch.
- **Deploy**: nothing here deploys without Roy's go ahead.

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Human fact check at scale**: whether the per page human check holds beyond this slice stays open · needs a decision
- **Fix `lastModified: now` in the main sitemap**: do it the next time that sitemap is touched
- **Other cities, attraction and best time pages, AI per tour copy on slice pages, price or rating statistics, outreach, Pinterest, a live price component, non English pages, ISR, a CMS**: out by the brief's section 4
