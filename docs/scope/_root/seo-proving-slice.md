# Scope: SEO proving slice, Bangkok (BRI-114)

A test, not a launch. You put 7 Bangkok pages into Google (the hub, 5 category pages and the stats page; 6 of them are topic pages) while the rest of the site stays gated, then read Search Console at weeks 2, 4, 8 and 12 to learn whether curated pages with visible logic, facts computed across tours, and a house voice can win where demand exists and the results page is weak (rows 18 to 27). Source: [the slice brief](../../superpowers/plans/2026-10-14-seo-slice-brief.md), sections 3 and 4 set the boundary. Spans both apps. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

**The page list (approved, 15 Oct 2026):** things to do in bangkok (the hub), bangkok floating market, thailand temples bangkok, spa and massage in Bangkok, muay thai bangkok, day trips from bangkok, cooking class bangkok, bangkok cruise, plus one stats page. "Private tour bangkok thailand" is dropped (no group size field). No control pages qualified.

**Held pages (decided 15 Oct 2026):** `muay-thai` (6 eligible tours) and `spa-and-massage` (3 eligible tours) stay in the manifest with `"held": true` and are not published, because both fall under the 10 tour floor (most of their tours have fewer than 5 reviews, so the BRI-200 gate drops them). They are never indexed, so a week 12 readout must not count them as ranking failures. A later snapshot run can unhold either one once it reaches 10 eligible tours ([spec 0006](../../specs/_root/0006-seo-proving-slice/index.md), Follow-up).

**Recorded before launch, so a miss reads correctly:**
- The spa and massage page is judged on a navigational head query. A miss at week 8 is an intent failure, not a verdict on the approach. (It is held for now, see Held pages; this applies only if it is unheld.)
- `ItemList` markup will not earn a carousel in the US, UK or AU. It stays on the pages, and no carousel at week 8 is not a failure.
- With no controls, the brief's "controls are the quality signal" (section 2) has nothing to read until the control research PR (below) adds them.
- Cooking classes and cruises are expected weak (decided 16 Oct 2026, from the content research): operator sites and OTA results pages hold those results. They stay in the slice, but the quality signal is floating markets, temples and day trips, so a miss on cooking or cruises alone is not a miss for the approach.

## Foundations

### 18. Gate allowlist, robots and a slice only sitemap · done · Beta
Let anonymous visitors and crawlers reach only the slice URLs, `/go/`, `/ingest` and the slice sitemap while the gate stays on, with robots and the sitemap rewritten to match. This is the only row that blocks even a private crawl test, so it goes first.
**Done when:** with the gate on, an anonymous request to any live slice URL or the sitemap passes, `/go/tours/` and `/ingest/` pass only once the live set has at least one page, and every other path still shows the gate; with an empty live set only `/sitemap-slice.xml`, `/robots.txt`, `/api/unlock` and the coming soon page itself are reachable; a test enumerates the sitemap and finds only slice pages, each with `lastModified` from its snapshot date.
- [x] Design it (spec): [0006 gate, robots and sitemap](../../specs/_root/0006-seo-proving-slice/0006-gate-robots-sitemap.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [x] Build it: `/develop gate allowlist, robots and a slice only sitemap`
  - [x] Shared types, the hash recipe with its golden vector test, and `seo:index` with its staleness test (umbrella AC-1, AC-2)
  - [x] Live guard in CI, so a refresh and its approvals share one PR (umbrella AC-8)
  - [x] Gate helper and middleware wiring, empty live set included (AC-G1, AC-G2, AC-G3, AC-G7)
  - [x] Gated robots with the `/_next/` allow (AC-G4)
  - [x] `/sitemap-slice.xml` and its enumeration test (AC-G5, AC-G6)
- [x] Verify it: `/check verify gate allowlist, robots and a slice only sitemap`
- [x] Test it: `/test gate allowlist, robots and a slice only sitemap`

### 19. Page list and tour membership rule · done · Alpha
The manifest of the 9 pages, and the rule that decides which Bangkok tours belong on each page. Coordinates alone cannot decide it (612 of 2,589 Bangkok tours have none), and off city tours must stay out (Phuket, Phi Phi, Krabi, Samui, and 2 Pattaya floating market tours). The BRI-200 gate is a yes or no filter only; ordering uses static fields, never ratings. The manifest also holds each page's "How to choose" groups, the keyword groups and place list, and the image exclusions, and picks alternate across trip lengths inside each group so no page fills from one length (amended 16 Oct 2026).
**Done when:** each page has a written membership rule and its groups, every live page has at least 10 eligible tours, none of the named off city tours appears on any page, and on a fixture with tours of every length no section's picks all come from one length group while another has eligible members.
- [x] Design it (spec): [0006 manifest and membership](../../specs/_root/0006-seo-proving-slice/0006-page-manifest-membership.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [x] Build it: `/develop page list and tour membership rule`
  - [x] Manifest with the 9 pages, H1s, plain words, exclusions, tag names, groups, keyword groups, places, an empty `excludedExperiences` and Roy's `forbiddenNames`; spa and muay thai held (AC-M1, AC-M3)
    - [x] add a script level held case to live-guard.cli.spec once manifest.json exists
  - [x] `selectMembers` and `selectPicks` with the off city, section, round robin, exclusion and hub pick tests (AC-M2 to AC-M8, AC-M10)
  - [x] Slug test in apps/web (AC-M9)
- [x] Verify it: `/check verify page list and tour membership rule`

### 20. Snapshot files from prod, read only · done
A command that reads prod read only and writes one committed, dated snapshot file per page: its computed facts (including its sections and stat strip) and its pick list, with a computed on date and a grounding hash. A page that falls under the floor is thin: the command deletes its old file, exits with an error and says how to hold it, and the hub is regenerated and approved in the same PR. Pages build from these files, never from live database reads. It never reads or writes the notes files.
**Done when:** running the command produces committed snapshot files for the hub and the 5 category pages that are not held, 6 files (the 2 held pages get none; the stats snapshot comes with row 25), each with its date, hashes, sections and strip, every printed count comes from tours before the BRI-200 gate (gated counts only in the internal `eligible` block), a thin page's old file is deleted and the run fails, and a rerun on unchanged data gives the same hash.
- [x] Design it (spec): [0006 prod snapshot](../../specs/_root/0006-seo-proving-slice/0006-prod-snapshot.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [x] Build it: `/develop snapshot files from prod, read only`
  - [x] Facts builder over printable members (sections, stat strip, keyword groups and places from the manifest) and the internal `eligible` block, with tests (AC-S4, AC-S4a, AC-S8)
  - [x] `seo:snapshot` with the read only guard, manifest validation, writer and automatic index step (AC-S1 to AC-S3, AC-S5 to AC-S7, AC-S9)
    - [x] For `factsHash` and `picksHash`, add the same pinned assertions against the shared fixture in apps/api (`packages/shared/fixtures/seo-slice-golden.json`, as pinned in `apps/web/src/lib/seo-slice/golden.spec.ts`)
    - [x] `seo:snapshot` under ts-node needs the moduleTypes cjs override that apps/web/scripts/tsconfig.seo.json uses. Checked 16 Oct 2026 from apps/api: plain ts-node fails to load seo-slice-membership with ERR_REQUIRE_ESM; with the override it loads and isViatorHost works, so give the script that override
  - [x] First read only run against prod, files committed (umbrella AC-6)
    - [x] After that run, write a one-off membership review to ~/folio-logs/seo-slice/membership-review-{date}.md, outside the repo, with the items from the row 19 verify note: tag-only members per page (tags 20226, 21518, 11889 first); size of each page's other group and which groups fold; titles naming Ko Chang, Koh Samet, Khao Yai, Chiangmai, Siem Reap or Angkor; titles each off city word excludes; title only, tag only and both counts per page; how many real titles the leak term exclusion drops; whether any live page draws all its picks from one trip length
- [x] Verify it: `/check verify snapshot files from prod, read only`

## Slice 1: the Bangkok hub, end to end

### 21. Hub page template and URL · done · Alpha
The route and the one page template, proven first on "things to do in bangkok": URL, layout, breadcrumbs, `ItemList` and breadcrumb structured data with no ratings and no author, the rule line with "Checked by the Folio team", the stat strip, "How to choose" sections, Local notes, Good to know, the affiliate disclosure in Folio Voyage's name, the "computed on" date and the "How this page was made" note. The hub is a category index on the same template. The default URL is `/destinations/bangkok/{page}`, which has to live alongside the `[slug]/[city]` redirect handler. No personal name appears anywhere on a page.
**Done when:** the hub renders statically from its snapshot at its final URL as a category index, it also renders in the local preview before approval (never in a production build), and a scan of its server HTML, its attribute values (meta, alt, aria-label, title) and its JSON-LD finds no rating, review count, price, availability or cancellation term, no "Atlas", no name on the `forbiddenNames` list and no "our editors" style wording.
- [x] Design it (spec): [0006 page template](../../specs/_root/0006-seo-proving-slice/0006-page-template.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [x] Build it: `/develop hub page template and URL`
  - [x] Static route, slice layout and the shared template, proven on the hub as a category index (AC-T1, AC-T3, AC-T5, AC-T10)
  - [x] Rule line, checked line, stat strip, note, disclosure and breadcrumbs (AC-T4, AC-T8, AC-T11 to AC-T13)
  - [x] How to choose sections, Local notes and Good to know (AC-T3, AC-T14)
  - [x] JSON-LD with no author (AC-T7)
  - [x] Leak, name and team scan on the built HTML and attribute values with its CI step, link audit and route regression tests (AC-T2, AC-T6, AC-T9)
    - [x] also run middleware.edge-bundle.spec after the build
  - [x] Local preview, `seo:preview`, with its "not approved" banner and the test that it never runs in a production build (AC-T15)
- [x] Verify it: `/check verify hub page template and URL`

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
Teach the content engine a hub input: a prompt, the voice guide's banned patterns and first person wording as blocking checks, claim tracing against the snapshot and listed sources, and committed storage with the grounding hash. The generator never sees the notes or the picks, and never names a tour or operator. Proven first on the hub page. Every page gets a human fact check (Google's 1 Oct 2026 guidance) covering its copy, notes, Good to know, pick images and share image, recorded against a check hash so any later change unpublishes the page until it is checked again. The generated text never states price, availability or cancellation.
**Done when:** the hub's intro and metadata pass every blocking check and claim trace, are stored as committed files with their hash, render in the local preview with its share image, and Roy has fact checked the page there so its check hash matches.
- [x] Design it (spec): [0006 hub copy](../../specs/_root/0006-seo-proving-slice/0006-hub-copy.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop hub copy in the house voice`
  - [ ] **Prerequisite:** the docs/08 scoped exception PR is merged (see Before launch)
  - [ ] Adapter `maxTokens` option and `HUB_COPY_MODEL` (AC-H1)
  - [ ] Prompt, blocking checks (first person included), claim trace and the per field retry loop (AC-H2, AC-H2a, AC-H3, AC-H4, AC-H8)
  - [ ] `hub-copy:run` and `hub-copy:approve` with the check hash, notes, source facts and share image checks (AC-H5 to AC-H7)
  - [ ] For `groundingHash` and `checkHash`, add the same pinned assertions against the shared fixture in apps/api (`packages/shared/fixtures/seo-slice-golden.json`, as pinned in `apps/web/src/lib/seo-slice/golden.spec.ts`)
  - [ ] Hub generated, read in the local preview and fact checked by Roy (AC-H9, AC-H13)
    - [ ] places list entry 'Erawan' is ambiguous (museum, shrine, national park): check any intro that names it, and consider changing it to 'Erawan National Park' in the manifest
- [ ] Verify it: `/check verify hub copy in the house voice`

## Slice 2: widen to the 5 category pages and the stats page

### 24. The five category pages and the first batch calibration · in-progress
Generate and publish the five category pages that are not held through the same path, then run the first batch calibration on the 6 topic pages (the hub plus the five), where 2 or more failures fails the batch: change the prompt, guide or checks (never single pages) and regenerate within the limits row 23's spec sets.
Roy writes the Local notes for floating markets, temples and day trips by hand before their pages are checked; cooking and cruises ship without notes.
**Done when:** all 6 topic pages are live behind the allowlist, the calibration result is recorded, the three notes files exist, and every page has passed the human fact check, including its pick images (any bad photo is on `excludedExperiences`) and its share image.
- [x] Design it (spec): covered by [0006 hub copy and calibration](../../specs/_root/0006-seo-proving-slice/0006-hub-copy.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop the five category pages and the first batch calibration`
  - [ ] Roy writes `floating-markets`, `temples` and `day-trips` notes files (umbrella, Notes file schema)
  - [ ] Generate the 5 category pages that are not held (AC-H10)
  - [ ] Run the batch calibration and record every round, resample and held page (AC-H10 to AC-H12)
  - [ ] Roy fact checks each passing page, images and share image included (AC-H6, AC-H13)
- [ ] Verify it: `/check verify the five category pages and the first batch calibration`

### 25. Stats page · in-progress
One page of facts computed across Bangkok's tours (trip lengths with a median per category, inclusions, places named), with no price, rating or cancellation statistics. It is the slice's only linkable asset, and a thin one without price data. If it fails generation or Roy's read, it is held and the slice launches without it.
**Done when:** the stats page renders from its snapshot with its computed on date and checked line, every number traces to the snapshot, each category table shows its median length, its method note names Folio Voyage and holds no digits, and the leak, name and team scan passes on it (or the page is held and recorded, AC-D6).
- [x] Design it (spec): [0006 stats page](../../specs/_root/0006-seo-proving-slice/0006-stats-page.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop stats page`
  - [ ] Stats facts in the snapshot command (AC-D1)
  - [ ] Stats body from fixed templates (AC-D2 to AC-D4)
  - [ ] Number trace test (AC-D5)
  - [ ] Stats copy generated and fact checked, or the page held (AC-D6)
  - [ ] Once stats.snapshot.json exists, the preview lists stats; handle it (render the stats page or skip it) so the preview does not throw
- [ ] Verify it: `/check verify stats page`

## Slice 3: measure it

### 26. Search Console and measurement plumbing · in-progress
Verify the Search Console property, submit the slice sitemap, set up a weekly export, and confirm analytics IDs and the disclosure are on every page.
**Done when:** the property is verified, the sitemap is submitted and read, and the first weekly export file exists in the agreed format.
- [x] Design it (spec): [0006 measurement](../../specs/_root/0006-seo-proving-slice/0006-measurement.md), umbrella [0006](../../specs/_root/0006-seo-proving-slice/index.md)
- [ ] Build it: `/develop search console and measurement plumbing`
  - [ ] Slice PostHog settings (AC-R6)
  - [ ] `seo:gsc-export` and `seo:clicks` with its stale pick list, with stubbed tests (AC-R2 to AC-R5, AC-R10)
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
- **docs/08 scoped exception** (small docs PR, before row 23 starts): add to `docs/08-brand-voice-style-guide.md` an exception for slice pages covering the "Checked by the Folio team" line, the per page approval step and signed verbatim Local notes ([spec 0006 rationale](../../specs/_root/0006-seo-proving-slice/rationale.md), Exceptions to F1 and docs/08). Append it rather than inserting lines above line 27, since code comments cite docs/08 by line number. A prerequisite for row 23, not a follow up.
- **Home page and disclosure fixes** (small PR, before launch): remove the home page claims that contradict F1 (C7, for example `first-hand knowledge` in `TrustSection.tsx`), extend `/legal/disclosure` to cover machine written content (C6), and remove the retired `SearchAction` markup from `apps/web/src/app/page.tsx`.
- **Control pages research** (small PR, before launch): a research module extension for the advanced results page, about $0.50 through the spend guard, to find control queries.
- **Consent and privacy**: a cookie consent flow (PostHog replay samples about 50% today). A launch prerequisite, its own task.
- **BRI-254, experience page `AggregateRating`**: has a Google basis as well as Viator's. Does not block the slice (those pages stay gated and unlinked) but blocks any wider launch.
- **Vercel Pro**: the project is on Hobby (non commercial), needed at public launch.
- **Site URL for Production**: set NEXT_PUBLIC_SITE_URL to https://www.foliovoyage.com in Vercel Production before the first slice page goes live. Unset, it falls back on Vercel to the *.vercel.app production domain (VERCEL_PROJECT_PRODUCTION_URL), and off Vercel to http://localhost:3000; either is wrong for canonical, og:url and the sitemap loc (and the leak scan does not audit <link> tags). After the first page is live, check anonymously that its canonical, og:url and the sitemap loc all use https://www.foliovoyage.com.
- **Personal names list, Roy's task**: fill the manifest's `forbiddenNames` with the names that must never appear on a page. An empty list fails validation, so `seo:snapshot` cannot run until it is filled.
- **Deploy**: nothing here deploys without Roy's go ahead.

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Human fact check at scale**: whether the per page human check holds beyond this slice stays open · needs a decision
- **Fix `lastModified: now` in the main sitemap**: do it the next time that sitemap is touched
- **Other cities, attraction and best time pages, AI per tour copy on slice pages, price or rating statistics, outreach, Pinterest, a live price component, non English pages, ISR, a CMS**: out by the brief's section 4
