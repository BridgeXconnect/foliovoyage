# 0006. SEO proving slice, Bangkok (BRI-114)

**Date**: 2026-10-15
**Status**: Proposed

## Summary

You put six Bangkok topic pages (the hub and 5 categories; muay thai and spa are held for thin data) and one stats page into Google while the rest of the site stays behind the gate, then read Search Console at weeks 2, 4, 8 and 12. Each page is built from a committed snapshot file (facts and picks read once from prod, read only), with copy written by the existing content engine and fact checked by Roy before the page goes live. Tours belong to a page by a written rule (Viator tag or title pattern, minus off city, multi day, transfer and flagged tours), never by coordinates and never ranked by ratings. Nothing here deploys without Roy's go ahead.

## Structure

Each child is a flat file in this directory, buildable on its own, with a short inline rationale. The cross child contract below is what they share.

- [0006-gate-robots-sitemap.md](0006-gate-robots-sitemap.md): the gate allowlist, robots while gated, and `/sitemap-slice.xml` (scope row 18). Supports the gate and sitemap decisions. Criteria `AC-G`.
- [0006-page-manifest-membership.md](0006-page-manifest-membership.md): the manifest of 9 pages and the tour membership rule, written as data (scope row 19). Supports the membership, ordering and picks decisions. Criteria `AC-M`.
- [0006-prod-snapshot.md](0006-prod-snapshot.md): the read only `seo:snapshot` command and the snapshot files (scope row 20). Supports the snapshot and hash decisions. Criteria `AC-S`.
- [0006-page-template.md](0006-page-template.md): the static route, layout, breadcrumbs, structured data and the leak test (scope row 21). Supports the URL decision. Criteria `AC-T`.
- [0006-pick-card-campaign.md](0006-pick-card-campaign.md): the rating free card and the campaign tagged click out, with the new `AffiliateClick.campaign` column (scope row 22). Supports the campaign record decision. Criteria `AC-C`.
- [0006-hub-copy.md](0006-hub-copy.md): hub copy generation, blocking checks, claim tracing, the fact check, and the batch calibration (scope rows 23 and 24). Supports the copy, model and calibration decisions. Criteria `AC-H`.
- [0006-stats-page.md](0006-stats-page.md): the stats page from fixed templates (scope row 25). Criteria `AC-D`.
- [0006-measurement.md](0006-measurement.md): Search Console, the weekly export, slice analytics, and the checkpoint readouts (scope rows 26 and 27). Criteria `AC-R`.

## Requirements

**User stories**:
- As Roy, I want a small set of Bangkok pages indexed while the rest of the site stays gated, so that I learn whether curated pages with visible logic can rank before I build more.
- As a searcher, I want a page that explains which tours it picked and why, with facts I can check, so that I can choose without reading a wall of listings.
- As Roy, I want every click out to say which page sent it, so that the week 12 readout can tie traffic to bookings intent.
- As Roy, I want no rating, review, price, availability or cancellation claim in the page HTML, so that the pages honour Viator's terms (BRI-204) and F1.

**Acceptance criteria** (the umbrella contract; each child holds its detailed criteria):
- **AC-1**: The manifest at `apps/web/src/content/seo/bangkok/manifest.json` is the one list of slice pages. The gate allowlist, `/sitemap-slice.xml`, robots, `generateStaticParams`, and the campaign check all read the live set derived from it, and none of them holds its own list of slugs.
- **AC-2**: A page is ready when it is not held and (a) its snapshot file exists, (b) its copy file exists with a `groundingHash` equal to the hash computed from the current snapshot and manifest (see Hashes), and (c) its `factCheck.copyHash` equals the hash of its current copy. Liveness then follows the links between pages: the hub is live when it is ready and every category page it lists (each one with a snapshot and not held) is ready; a category page is live when it is ready and the hub is live; the stats page is live when it is ready and the hub is live. A page that is not live is absent from the allowlist, the sitemap, robots and `generateStaticParams`. So every live page's breadcrumb and links point at live pages.
- **AC-3**: Pages render statically at build from committed files only. No slice page, card or route reads the database at build or request time, except `/go/tours/*`, which keeps its existing API call.
- **AC-4**: The visible text and JSON-LD of every live page, as written by `next build`, contain no rating, review count, price, availability or cancellation term (the leak test in `0006-page-template.md`, AC-T6).
- **AC-5**: Nothing in this slice uses tour coordinates.
- **AC-6**: No command in this slice writes to prod. The only prod reads are `seo:snapshot` and `seo:clicks`, both on a connection that reports `default_transaction_read_only = on` before the first query.

## Decision

**Chosen option**: Option 1: committed snapshot files plus a JSON manifest, rendered by one static route, gated by an allowlist derived from the manifest.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| URL | `/destinations/bangkok/{slug}` from a static folder `apps/web/src/app/destinations/bangkok/[page]/page.tsx`, `dynamicParams = false` | Prerenders, adds one file, leaves the `[slug]/[city]` redirect untouched (Step 0 showed a merged handler renders per request) | A merged `[slug]/[page]` handler |
| Slugs | `things-to-do` (hub), `floating-markets`, `temples`, `spa-and-massage`, `muay-thai`, `day-trips`, `cooking-classes`, `cruises`, `stats` | Short, match the target query; a test forbids any slug equal to a destination slug | `river-cruises` and longer phrases |
| Manifest home | JSON in `apps/web/src/content/seo/bangkok/manifest.json`, types in `@folio/shared` as type only imports | The edge middleware can import JSON; the CommonJS API reads it with `fs` because it cannot `require` the ESM shared package | A TypeScript constant in `@folio/shared` |
| Live set for the edge | A generated `live.generated.ts` (slugs only) and `pages.generated.ts` (static imports of every file), written by `pnpm --filter @folio/web seo:index` (run automatically by the apps/api commands) and checked by a staleness test | Middleware cannot use `fs` and must stay small | Reading the folder with `fs` at build |
| Membership | Per page: any of its tag ids OR its title pattern, then shared exclusions, then the BRI-200 gate and a published Experience | Tags alone miss most titles (floating markets: 1 tag versus 203 titles); coordinates are missing for 612 tours and cannot exclude off city ones | Coordinates within a radius |
| Ordering | Duration band, then inclusion count descending, then `providerTourId` ascending | Static fields only, never ratings (BRI-204) | Bayesian rating score |
| Picks | Up to 12 per category page, floor of 10 eligible members; hub shows 2 from each category page with a snapshot that is not held, taking the next member when one repeats | Enough to compare, few enough to curate | 20 picks |
| Snapshot | `seo:snapshot` in apps/api, `doppler run --config prd`, own read only connection, two hashes (`factsHash`, `picksHash`) | Pages never touch live data; copy survives a pick refresh | A build time DB read |
| Copy | Committed `{slug}.copy.json` beside the snapshot, made with the existing `TourCopyGenerator` port through Cloudflare AI Gateway, model `HUB_COPY_MODEL` | Reuses the checked engine; files review in a PR | A `HubCopy` table |
| Campaign record | New nullable `AffiliateClick.campaign`, set from `?p=` checked against the live set; fallback `canvas-tour` | Referrer is unreliable, `sessionId` and `providerId` mean other things | Parse `referrer` |
| Gate | Exact live paths plus `/sitemap-slice.xml`, prefixes `/go/tours/` and `/ingest/` | Smallest surface that still lets crawlers and click outs through | Prefix `/destinations/bangkok/` |
| Sitemap | Separate `/sitemap-slice.xml`, `lastModified` from each snapshot's `computedOn` | Leaves `sitemap.ts` alone while gated | Switch `sitemap.ts` on the gate |
| Measurement | A local read only CLI over the Search Console API, weekly JSON to `~/folio-logs/seo-slice/` | No new service, no hosted secret | A scheduled job on Railway |
| Build approach | Tracer Bullet: foundations (rows 18 to 20), then the hub end to end (21 to 23), then the other pages (24, 25), then measurement (26, 27) | The scope's order | Build all nine page templates first |

## Cross child contract

### Files

All slice content lives in `apps/web/src/content/seo/bangkok/`:

| File | Written by | Read by |
|---|---|---|
| `manifest.json` | hand, through a PR | everything |
| `{slug}.snapshot.json` | `seo:snapshot` (apps/api) | page, sitemap, copy CLI |
| `{slug}.copy.json` | `hub-copy:run` and `hub-copy:approve` (apps/api) | page, live set |
| `pages.generated.ts` | `seo:index` (apps/web) | page module, sitemap, robots |
| `live.generated.ts` | `seo:index` (apps/web) | middleware and the `/go` campaign check |

The apps/api commands write into apps/web by resolving the path from the repo root (`path.resolve(__dirname, "../../../../web/src/content/seo/bangkok")` or a `--out` flag). After writing, each of them (`seo:snapshot`, `hub-copy:run`, `hub-copy:approve`) runs `pnpm --filter @folio/web seo:index` as a child process, so the generated files never lag the content files. If that step fails, the command prints the error and the command to run by hand, and exits non zero.

### Manifest schema (`SeoSliceManifest`, type in `packages/shared/src/seo-slice.ts`)

```json
{
  "schemaVersion": 1,
  "city": { "slug": "bangkok", "countrySlug": "thailand", "name": "Bangkok", "destinationRef": "343" },
  "exclusions": {
    "offCityTitlePattern": "\\b(phuket|phi phi|krabi|samui|pattaya|chiang mai|chiang rai|hua hin|koh chang|koh tao|phangan)\\b",
    "excludeTagIds": [11922, 12044, 367651, 367656, 367657],
    "maxDurationMin": 1440,
    "plainWords": "tours whose titles name another Thai destination (Phuket, Phi Phi, Krabi, Samui, Pattaya, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang, Koh Tao or Phangan), multi day tours, airport and hotel transfers, tours longer than 24 hours, and listings Viator itself flags as broken or non compliant"
  },
  "tagNames": { "20226": "Markets", "11922": "Multi day Tours" },
  "pages": [
    {
      "slug": "floating-markets",
      "kind": "category",
      "targetQuery": "bangkok floating market",
      "h1": "Floating market tours from Bangkok",
      "rule": {
        "tagIds": [20226],
        "titlePattern": "\\bfloating markets?\\b",
        "plainWords": "floating market"
      },
      "sourceFacts": [{ "fact": "one line fact", "url": "https://public.example/source" }]
    }
  ]
}
```

- `held` (optional, default false) takes a page out of the snapshot, the hub and the live set without deleting its entry (AC-M7, AC-H12).
- `kind` is `hub`, `category` or `stats`. Exactly one `hub` and one `stats`. Neither has a `rule`. Every page, the hub and stats included, has an `h1`; the stats page has `targetQuery: null`. The hub's cards come from the category pages that have a snapshot and are not held (AC-M7). The stats page's facts cover the Bangkok pool of AC-M2 with no page rule applied (AC-D1).
- `rule.plainWords` is the title pattern said in words, written by hand next to the pattern (for example `"temple, Wat Arun, Wat Pho, Wat Phra Kaew, Wat Saket, Wat Traimit, Grand Palace, Emerald Buddha or Reclining Buddha"`). `exclusions.plainWords` does the same for the exclusions. Both feed the "How this page was made" note (AC-T4) and the copy grounding (AC-H2). A test fails when a rule or the exclusions block lacks them.
- `tagNames` names every tag id the manifest uses, for the "How this page was made" note. A test fails when a used id has no name.
- Patterns are JavaScript regular expressions, matched case insensitive against `Tour.title`.
- `sourceFacts` holds 0 to 5 entries per page; an empty list is valid and is the starting state. Roy owns them: a new entry lands through his PR, and his fact check (AC-H6) covers its URL.
- Adding a page later is a manifest PR plus a snapshot run. No code change (Q7).

### Snapshot schema (`SeoSliceSnapshot`)

```json
{
  "schemaVersion": 1,
  "slug": "floating-markets",
  "computedOn": "2026-10-20",
  "facts": { "memberCount": 78, "bandCounts": {}, "inclusionShares": {}, "topPlaces": [] },
  "factsHash": "v1:<sha256>",
  "picks": [{ "experienceId": "...", "providerTourId": "...", "title": "...", "imageUrl": "...", "imageAlt": "...", "durationBand": "4to8h", "inclusions": ["...", "...", "..."] }],
  "picksHash": "v1:<sha256>"
}
```

On the hub, each pick also holds `fromSlug`, the category page it came from (AC-M7). The stats snapshot has `picks: []`.

The exact `facts` keys per page kind are in `0006-prod-snapshot.md` (AC-S4) and `0006-stats-page.md` (AC-D1).

### Copy file schema (`SeoSliceCopy`)

```json
{
  "schemaVersion": 1,
  "slug": "floating-markets",
  "intro": "120 to 220 words",
  "seoTitle": "at most 60 characters",
  "metaDescription": "at most 155 characters",
  "groundingHash": "v1:<sha256>",
  "model": "claude-sonnet-5",
  "promptVersion": "hub-v1",
  "attempts": 1,
  "generatedAt": "2026-10-20T10:00:00Z",
  "factCheck": { "by": "roy", "at": "2026-10-21T09:00:00Z", "copyHash": "v1:<sha256>" }
}
```

The stats page copy file has no `intro`. `factCheck` is absent until `hub-copy:approve` writes it.

### Hashes

One recipe, implemented twice (once in apps/api, once in apps/web) and pinned by the same golden vector test in both apps:

- `canonicalHash(value)` = `"v1:" + sha256(JSON with keys sorted at every level, no whitespace)`, hex.
- `factsHash` = `canonicalHash(facts)`. `picksHash` = `canonicalHash(picks)`. Neither includes `computedOn`.
- `groundingHash` = `canonicalHash({ factsHash, h1, targetQuery, rulePlainWords, exclusionsPlainWords, sourceFacts })`, all taken from the page's manifest entry (`rulePlainWords` is null for the hub and stats; `sourceFacts` in manifest order). So any manifest edit that changes what the copy was written from also makes the copy stale.
- `copyHash` = `canonicalHash({ intro, seoTitle, metaDescription })` (`intro` omitted for stats).

### Live set

`seo:index` reads every file, computes AC-2 for each manifest page, and writes `LIVE_SLUGS` (a literal array in manifest order) to `live.generated.ts`, plus the typed data to `pages.generated.ts`. At build, the page module recomputes `factsHash` and `groundingHash` (Node runtime) and **fails the build** when a snapshot's facts do not match its `factsHash` or a copy's `groundingHash` does not match. A missing or stale `factCheck` is not a build failure; the page is simply not live. An empty `LIVE_SLUGS` is valid: the build passes with no slice pages, the sitemap has an empty `<urlset>`, and the gate passes only the two prefixes (a test covers this, since it is the state before the first approval). A jest test in apps/web reruns the derivation and fails if either generated file differs from what is on disk.

### Campaign format

`seo-bangkok-<slug>`, where `<slug>` is in `LIVE_SLUGS`. Used on the Viator URL (`withCampaign`), in `AffiliateClick.campaign`, and as the PostHog `source` on the card's click event. Anything else falls back to `canvas-tour` (AC-C3).

### Representative tour

One card per Experience. Its tour is the lowest `id` non deleted Tour of that Experience, the same tour `GET /v1/experiences/:id` and `/go/tours/:experienceId` use (spec 0005). An Experience is a member only when that tour passes every membership and eligibility rule, so the card and the click out always describe the same tour.

## Build plan

Tracer Bullet. Each step names the child criteria it satisfies.

1. Shared types and the hash recipe with its golden vector test in both apps, satisfies **AC-1**, AC-S3.
2. Manifest file with all 9 pages, rules and exclusions (`muay-thai` and `spa-and-massage` held); the pure membership function and its tests in apps/api, satisfies AC-M1 to AC-M9.
3. `seo:snapshot` with the read only guard, writing the 7 snapshot files for the pages not held, satisfies **AC-6**, AC-S1 to AC-S9.
4. `seo:index` and the two generated files, plus the staleness test, satisfies **AC-2**.
5. Gate allowlist, gated robots, `/sitemap-slice.xml`, satisfies AC-G1 to AC-G7.
6. The static route and template, proven on `things-to-do`, with the leak test, satisfies **AC-3**, **AC-4**, AC-T1 to AC-T10.
7. `AffiliateClick.campaign` migration, controller field, `?p=` handling in `tour-go.ts`, and the card, satisfies AC-C1 to AC-C7.
8. Hub copy: prompt, checks, claim trace, `hub-copy:run` and `hub-copy:approve`, proven on `things-to-do`, satisfies AC-H1 to AC-H9.
9. Generate the 5 category pages that are not held and run the batch calibration, satisfies AC-H10 to AC-H12.
10. Stats page facts and templates, satisfies AC-D1 to AC-D5.
11. Slice analytics settings, the Search Console CLI, `seo:clicks`, and the readout template, satisfies **AC-6**, AC-R1 to AC-R8.
12. Run the checkpoint readouts at weeks 2, 4, 8 and 12, satisfies AC-R9.

**AC-5** is held by the membership tests (step 2) and by the absence of any coordinate field in the snapshot schema.

## Consequences

**Positive**:
- Pages are plain static files. A bad deploy cannot leak live ratings or prices, and every claim on a page sits in a committed file a reviewer can read.
- Copy is tied to facts, not picks, so a refresh that only swaps tours keeps the approved copy.
- Adding a page or a source fact is a manifest PR, with no code change.

**Negative / tradeoffs**:
- Two copies of the hash recipe (api and web), kept equal only by the golden vector test.
- The generated files must match the content files. The apps/api commands rerun `seo:index` themselves; a hand edit to a content file still needs a manual `seo:index`, and forgetting it fails the staleness test in CI, not at runtime.
- A facts change fails the build until the copy is regenerated and fact checked again. That is deliberate, but it makes a refresh a two step PR.
- **Two approved pages are held from the start.** On prod (15 Oct 2026) `muay-thai` has 6 eligible members and `spa-and-massage` has 3, because most of their tours have fewer than 5 reviews and the BRI-200 gate drops them. Roy chose to hold both (`"held": true` in the manifest, decided 15 Oct 2026). The slice runs with 7 URLs: the hub, 5 category pages and stats. The spa caveat recorded in the scope no longer applies.
- A title pattern exclusion also drops a real Bangkok tour whose title merely names an excluded place (for example a Bangkok tour ending in Pattaya). That is accepted: the rule errs toward leaving tours out.

**Neutral**:
- One additive migration (`AffiliateClick.campaign`), shipped through the pre deploy migration path.
- New env vars: `HUB_COPY_MODEL` (validated in `apps/api/src/config/env.validation.ts`), `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`, `SEO_SLICE_SITE_LINKS`.
- Anyone can put `?p=` on a `/go` link, and bots will follow `/go` links. Only live slugs are ever written, so the column stays a closed list, but its counts include some noise. `seo:clicks` reports clicks with a bot user agent separately (AC-R4) rather than trying to block them.
- The calibration batch is the 6 topic pages that are not held (hub plus 5 categories), with the same bar of 2 failures (AC-H10).

## Follow-up

- [ ] Recheck the two held pages when the review counts grow: unhold one by removing `held` once a snapshot run shows it has at least 10 members.
- [ ] Check tag 20238 (Private Drivers, 297 Bangkok tours) in the first snapshot report. It is not excluded today; if private driver listings crowd the day trips page, add it to `excludeTagIds` through a manifest PR.
- [ ] Consent flow (Q9): a launch prerequisite with its own task. Blocks the public launch, not the gated crawl test.
- [ ] Search Console DNS TXT verification for `foliovoyage.com` (Q10a): a task for Roy, blocks AC-R1.
- [ ] Service account key for Search Console in Doppler `dev` as `GSC_SERVICE_ACCOUNT_JSON`: a task for Roy, blocks AC-R3.
- [ ] Submit `/sitemap-slice.xml` in the Search Console UI after the first deploy Roy approves: a task for Roy. Its date is week 0 for every readout (AC-R8).
- [ ] Write the first `sourceFacts` for any page Roy wants them on: a task for Roy, optional, through a manifest PR.
- [ ] CI does not run `next build` today. The leak scan (AC-T6) adds that step, so check during the build that `pnpm --filter @folio/web build` passes in CI without Doppler secrets. If it does not, say so in the PR. The scan then runs as a required local step before every slice PR merges until CI can build.
- [ ] Control pages research PR: adds pages to the manifest later with no code change.
- [ ] Remove the transitional manual `migrate:deploy` step from the release prompt once the `campaign` migration is confirmed applied by the pre deploy step.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
