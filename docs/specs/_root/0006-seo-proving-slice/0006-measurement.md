# 0006. Search Console, measurement and checkpoint readouts (child of 0006 SEO proving slice)

Scope rows 26 and 27. Governed by [index.md](index.md): the live set and campaign format live there.

## Summary

You verify `foliovoyage.com` in Search Console with a DNS record, submit `/sitemap-slice.xml`, and run a local read only command each week that pulls search numbers and index status for the live slice URLs into a dated JSON file in `~/folio-logs/seo-slice/`. A second command, run weekly with the export, counts click outs per campaign from prod, read only, and lists picks whose tour no longer resolves, so the next refresh can swap them. On slice pages PostHog records pageviews and click outs only. At weeks 2, 4, 8 and 12 you write a short committed readout against the measures fixed in the scope.

## Requirements

**User stories**:
- As Roy, I want one file per week with the same fields, so that the checkpoints compare like with like.
- As a visitor, I want the slice pages to record as little about me as possible before a consent flow exists.

**Acceptance criteria**:
- **AC-R1**: The Search Console property is the domain property `sc-domain:foliovoyage.com`, verified by a DNS TXT record (a task for Roy). Roy submits `/sitemap-slice.xml` to it by hand in the Search Console UI, after the first deploy he approves, and records the date in the readout README as week 0.
- **AC-R2**: `doppler run -- pnpm --filter @folio/api seo:gsc-export [--end YYYY-MM-DD]` runs `apps/api/src/modules/research/search-console.cli.ts`. It authenticates with the service account in `GSC_SERVICE_ACCOUNT_JSON` using the read only scope `https://www.googleapis.com/auth/webmasters.readonly`, for the site in `GSC_SITE_URL`.
- **AC-R3**: For the 7 days ending `--end` (default: 3 days before today, since Search Console data lags), it calls `searchanalytics.query` once with dimensions `page` and `query` filtered to the slice URL prefix, and calls URL Inspection once per live slice URL. It writes `~/folio-logs/seo-slice/{end}.json` with `{ site, range: { start, end }, pages: [{ url, clicks, impressions, ctr, position, topQueries: [{ query, clicks, impressions, position }] (up to 10), inspection: { verdict, coverageState, indexingState, lastCrawlTime } }] }`. Rows are sorted by url, then query. A rerun for the same `--end` overwrites the file.
- **AC-R4**: `doppler run --config prd -- pnpm --filter @folio/api seo:clicks [--since YYYY-MM-DD]` counts `AffiliateClick` rows per `campaign` starting `seo-bangkok-` since the date (default: week 0), on the same guarded connection as AC-S1 (`DIRECT_URL`, `SET` then `SHOW` reports `on` before its one data query), and writes `~/folio-logs/seo-slice/clicks-{today}.json` as `{ since, campaigns: [{ campaign, clicks, likelyBot }], stalePicks: [...] }`, campaigns sorted by campaign (`stalePicks`, AC-R10). `likelyBot` counts the rows whose `userAgent` is null or matches `/bot|crawl|spider|slurp|preview|headless/i`; `clicks` is the total including them. The readouts use `clicks − likelyBot`.
- **AC-R10**: You run `seo:clicks` weekly, beside the export. On the same guarded connection and in the same output file, it adds `stalePicks`: for every pick in the snapshot of every slug in `LIVE_SLUGS` (the hub's picks included, read with `fs`), it checks in the database the same rules `GET /v1/experiences/:id` applies for `/go/tours/{experienceId}`, plus two the card depends on, and lists each pick that fails as `{ slug, experienceId, providerTourId, reason }`, sorted by slug then `experienceId`. Reasons, checked in this order:
  - `unknown`: no Experience with that id;
  - `unpublished`: the Experience's `status` is not `published`;
  - `noLiveTour`: it has no Tour with `deletedAt` null;
  - `tourChanged`: its representative tour (lowest `id`, not deleted) no longer has the pick's `providerTourId`, so the click would go to a different tour than the card shows;
  - `notViatorUrl`: the representative tour's `affiliateUrl` fails `isViatorHost` (`@folio/shared`, the same function `/go` applies, AC-M3).

  It never requests `/go/tours` itself, because each request writes an `AffiliateClick` row. A non empty list means: run `seo:snapshot` and approve the changed pages in one PR (index.md AC-8). The refresh drops every one of the five cases, because membership requires a published Experience, a live representative tour and a representative tour that passes `isViatorHost` (AC-M2, AC-M3); a pick listed as `notViatorUrl` is one whose URL changed after its snapshot was taken.

  **What a click does today for such a pick** (`apps/web/src/lib/tour-go.ts`, `apps/api/src/experiences/experiences.service.ts`): for `unknown`, `unpublished` or `noLiveTour`, the API answers 404, `fetchExperiencePage` returns null, and `/go/tours` answers `404` with the plain text body "Unknown tour." in the new tab the card opened. Nothing is logged and no `AffiliateClick` row is written, but the card's PostHog `experience_booking_clicked` event has already fired in the browser (AC-C7), so PostHog counts a click out the ledger does not. For `tourChanged`, the redirect goes to the new representative tour's Viator page and the row records that tour. For `notViatorUrl`, it redirects to Viator's search page for the city, records `providerId: "viator-search-fallback"` and logs `event=tour_redirect_fallback`.
- **AC-R5**: Neither command writes to any database or to Search Console. The service account has restricted (read) access on the property.
- **AC-R6**: On slice paths (`/destinations/bangkok/{slug}`), PostHog captures `$pageview` and the card's `experience_booking_clicked` only. In `instrumentation-client.ts`, the init reads `window.location.pathname` once and, on a slice path, passes `disable_session_recording: true`, `autocapture: false`, `capture_pageleave: false`, `capture_exceptions: false`, `capture_performance: false`, `capture_dead_clicks: false`, `rageclick: false`, `enable_heatmaps: false` and `disable_surveys: true`. Other paths keep today's settings. The builder checks each option name against the installed `posthog-js` version's config type (typecheck fails on an unknown key) and records any renamed key in the PR.
- **AC-R7**: The weekly JSON format is the agreed format for the scope row's done when; the first file exists after the sitemap is submitted.
- **AC-R8**: A readout template at `docs/superpowers/plans/seo-slice-readouts/README.md` records week 0 (the sitemap submission date, AC-R1) and fixes the measures, each read from the export whose `--end` is the checkpoint date or the latest before it:
  - week 2, crawled: passes when every live URL has a `lastCrawlTime`;
  - week 4, indexed: passes when at least 50% of live URLs have `verdict: PASS`, and is good at 80% or more;
  - week 8, seen: passes when at least half of the live pages have 1 or more impressions in the 7 day window;
  - week 12, ranked: passes when at least 2 topic pages (hub or category, not stats) show their `targetQuery` in `topQueries` with an average position of 20 or better; click outs per campaign (`clicks − likelyBot`, AC-R4) are reported with no bar. It also restates the recorded caveats that still apply (no `ItemList` carousel expected, no controls), notes that the muay thai and spa pages were held and never indexed, so they are not counted, and records that cooking classes and cruises were expected weak before launch (operator sites and OTA results pages hold those results), so the quality signal is floating markets, temples and day trips. A miss on cooking or cruises alone is not read as a miss for the approach.
- **AC-R9**: Each checkpoint is a committed markdown file, `docs/superpowers/plans/seo-slice-readouts/week-{NN}.md`, with the numbers copied from the JSON files and a pass or miss call per measure.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Property | DNS TXT domain property | Covers every host and protocol, no file on the gated site | URL prefix property with an HTML file |
| Export | Local CLI in the research module, weekly by hand | No hosted secret, no scheduler for a 12 week test | A Railway cron |
| Client | `google-auth-library` for the JWT, plain `fetch` to the two REST endpoints | One small dependency | The full `googleapis` package |
| Click outs | A separate prod read only command | The Search Console key lives in Doppler `dev`; prod reads keep their own guard | One command needing both configs |
| Slice analytics | Pageviews and click outs only | No consent flow yet; replay samples about half of sessions today | Leave defaults on |

## Feature design

**Configuration required**:
- `GSC_SERVICE_ACCOUNT_JSON`: the service account key JSON, Doppler `dev` only (a task for Roy). Never in a file.
- `GSC_SITE_URL`: `sc-domain:foliovoyage.com`.
- Add both to `apps/api/.env.example` with comments.

**Value sourcing**:
| Value | Source |
|---|---|
| clicks, impressions, ctr, position | `searchanalytics.query` |
| verdict, coverage, indexing, last crawl | URL Inspection `index.inspect` |
| the URL list | live pages from the manifest and generated live set, read with `fs` |
| click outs | `AffiliateClick` grouped by `campaign` |
| stale picks | live snapshots' picks, checked against `Experience` and `Tour` on prod (AC-R10) |

**Security model**: read scope only on Search Console; read only connection on prod; output files stay outside the repo (`~/folio-logs/`), and only the hand written readouts are committed.

**Critical test scenarios**:
- With a stubbed fetch, the export writes the expected file shape and sort order, verifies **AC-R3**.
- The clicks command refuses a connection reporting `off`, verifies **AC-R4**.
- With fixture rows, `stalePicks` lists one pick per reason and none for a healthy pick, issues no HTTP request, and writes nothing, verifies **AC-R10**.
- On a slice path the PostHog init options disable recording and autocapture; elsewhere they are unchanged, verifies **AC-R6**.

## Build plan

1. PostHog slice settings and test, satisfies **AC-R6**.
2. `search-console.cli.ts` with stubbed tests, satisfies **AC-R2**, **AC-R3**, **AC-R5**.
3. `seo:clicks` with `stalePicks`, satisfies **AC-R4**, **AC-R5**, **AC-R10**.
4. Verify the property, submit the sitemap, run the first export, satisfies **AC-R1**, **AC-R7**.
5. Readout template, satisfies **AC-R8**.
6. Write the four readouts, satisfies **AC-R9**.

## Rationale (short)

The test is 12 weeks long and read four times, so a hand run command with a fixed output beats any scheduled system. Keeping the click count on its own read only command keeps prod access in one guarded shape.
