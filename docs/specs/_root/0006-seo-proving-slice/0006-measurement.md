# 0006. Search Console, measurement and checkpoint readouts (child of 0006 SEO proving slice)

Scope rows 26 and 27. Governed by [index.md](index.md): the live set and campaign format live there.

## Summary

You verify `foliovoyage.com` in Search Console with a DNS record, submit `/sitemap-slice.xml`, and run a local read only command each week that pulls search numbers and index status for the live slice URLs into a dated JSON file in `~/folio-logs/seo-slice/`. A second command counts click outs per campaign from prod, read only. On slice pages PostHog records pageviews and click outs only. At weeks 2, 4, 8 and 12 you write a short committed readout against the measures fixed in the scope.

## Requirements

**User stories**:
- As Roy, I want one file per week with the same fields, so that the checkpoints compare like with like.
- As a visitor, I want the slice pages to record as little about me as possible before a consent flow exists.

**Acceptance criteria**:
- **AC-R1**: The Search Console property is the domain property `sc-domain:foliovoyage.com`, verified by a DNS TXT record (a task for Roy). Roy submits `/sitemap-slice.xml` to it by hand in the Search Console UI, after the first deploy he approves, and records the date in the readout README as week 0.
- **AC-R2**: `doppler run -- pnpm --filter @folio/api seo:gsc-export [--end YYYY-MM-DD]` runs `apps/api/src/modules/research/search-console.cli.ts`. It authenticates with the service account in `GSC_SERVICE_ACCOUNT_JSON` using the read only scope `https://www.googleapis.com/auth/webmasters.readonly`, for the site in `GSC_SITE_URL`.
- **AC-R3**: For the 7 days ending `--end` (default: 3 days before today, since Search Console data lags), it calls `searchanalytics.query` once with dimensions `page` and `query` filtered to the slice URL prefix, and calls URL Inspection once per live slice URL. It writes `~/folio-logs/seo-slice/{end}.json` with `{ site, range: { start, end }, pages: [{ url, clicks, impressions, ctr, position, topQueries: [{ query, clicks, impressions, position }] (up to 10), inspection: { verdict, coverageState, indexingState, lastCrawlTime } }] }`. Rows are sorted by url, then query. A rerun for the same `--end` overwrites the file.
- **AC-R4**: `doppler run --config prd -- pnpm --filter @folio/api seo:clicks [--since YYYY-MM-DD]` counts `AffiliateClick` rows per `campaign` starting `seo-bangkok-` since the date (default: week 0), on the same guarded connection as AC-S1 (`DIRECT_URL`, `SET` then `SHOW` reports `on` before its one data query), and writes `~/folio-logs/seo-slice/clicks-{today}.json` as `{ since, campaigns: [{ campaign, clicks, likelyBot }] }` sorted by campaign. `likelyBot` counts the rows whose `userAgent` is null or matches `/bot|crawl|spider|slurp|preview|headless/i`; `clicks` is the total including them. The readouts use `clicks − likelyBot`.
- **AC-R5**: Neither command writes to any database or to Search Console. The service account has restricted (read) access on the property.
- **AC-R6**: On slice paths (`/destinations/bangkok/{slug}`), PostHog captures `$pageview` and the card's `experience_booking_clicked` only. In `instrumentation-client.ts`, the init reads `window.location.pathname` once and, on a slice path, passes `disable_session_recording: true`, `autocapture: false`, `capture_pageleave: false`, `capture_exceptions: false`, `capture_performance: false`, `capture_dead_clicks: false`, `rageclick: false`, `enable_heatmaps: false` and `disable_surveys: true`. Other paths keep today's settings. The builder checks each option name against the installed `posthog-js` version's config type (typecheck fails on an unknown key) and records any renamed key in the PR.
- **AC-R7**: The weekly JSON format is the agreed format for the scope row's done when; the first file exists after the sitemap is submitted.
- **AC-R8**: A readout template at `docs/superpowers/plans/seo-slice-readouts/README.md` records week 0 (the sitemap submission date, AC-R1) and fixes the measures, each read from the export whose `--end` is the checkpoint date or the latest before it:
  - week 2, crawled: passes when every live URL has a `lastCrawlTime`;
  - week 4, indexed: passes when at least 50% of live URLs have `verdict: PASS`, and is good at 80% or more;
  - week 8, seen: passes when at least half of the live pages have 1 or more impressions in the 7 day window;
  - week 12, ranked: passes when at least 2 topic pages (hub or category, not stats) show their `targetQuery` in `topQueries` with an average position of 20 or better; click outs per campaign (`clicks − likelyBot`, AC-R4) are reported with no bar. It also restates the recorded caveats that still apply (no `ItemList` carousel expected, no controls) and notes that the spa page was held.
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

**Security model**: read scope only on Search Console; read only connection on prod; output files stay outside the repo (`~/folio-logs/`), and only the hand written readouts are committed.

**Critical test scenarios**:
- With a stubbed fetch, the export writes the expected file shape and sort order, verifies **AC-R3**.
- The clicks command refuses a connection reporting `off`, verifies **AC-R4**.
- On a slice path the PostHog init options disable recording and autocapture; elsewhere they are unchanged, verifies **AC-R6**.

## Build plan

1. PostHog slice settings and test, satisfies **AC-R6**.
2. `search-console.cli.ts` with stubbed tests, satisfies **AC-R2**, **AC-R3**, **AC-R5**.
3. `seo:clicks`, satisfies **AC-R4**, **AC-R5**.
4. Verify the property, submit the sitemap, run the first export, satisfies **AC-R1**, **AC-R7**.
5. Readout template, satisfies **AC-R8**.
6. Write the four readouts, satisfies **AC-R9**.

## Rationale (short)

The test is 12 weeks long and read four times, so a hand run command with a fixed output beats any scheduled system. Keeping the click count on its own read only command keeps prod access in one guarded shape.
