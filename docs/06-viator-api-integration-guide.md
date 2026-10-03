# 06 — Viator Partner API: Integration Guide (Full Access, DB ingest)

**Source docs reviewed:** `docs.viator.com/partner-api/technical/` (full technical reference) and the implementation guides at `partnerresources.viator.com`. For a line-by-line audit of the ingest code against the live docs, see the companion `docs/13-viator-api-audit.md`.

**Status note:** This guide originally described a Basic-Access, no-ingestion, fetch-and-cache plan. That is obsolete. Atlas is now a Viator **Full-Access** affiliate and runs a real Postgres ingest pipeline (`apps/api/src/modules/import/`). This document has been rewritten to match what is actually built. Two Viator-backed content systems now coexist — see the "Two content systems" note in the root `CLAUDE.md`; this guide covers the **database-backed ingest** one. The hand-authored link-matching path is `docs/07` + `docs/10`.

## Access tier: Full Access

Viator affiliates have four access tiers: **Basic Access → Full Access → Full Access + Booking → Merchant**. Atlas is a **Full-Access Affiliate** (confirmed via the "Access to endpoints" table). That unlocks the endpoints the ingest pipeline depends on:

| Endpoint | Use in Atlas |
|---|---|
| `/products/modified-since` | Bulk/delta catalogue crawl — the ingest pipeline's fetch stage (`ViatorClient.fetchModifiedSince`). |
| `/products/search` | Per-destination product lookup — used by the hand-authored path (`docs/07`) and for code discovery, **not** as the ingest crawl. |
| `/availability/schedules/{product-code}` | The "from" price for a single product — the price resolver (ST-7c/BRI-165). |
| `/locations/bulk` | Resolve opaque location refs → lat/lng — the location resolver (ST-7b). |
| `/destinations` / taxonomy | Destination hierarchy; the source of the curated-city refs and centroids in `curated-cities.ts`. |

As a Full-Access **affiliate** (not merchant), Atlas has **no** access to any `/bookings/*` endpoint and never processes a booking — booking always happens on viator.com after the click-through (see attribution below).

## Attribution: never process a booking, never touch the tracking URL

As an affiliate you never process a booking on your own site. The flow:

1. Show Atlas's own editorial content for a product (title/description are Atlas-owned — see "ownership boundary" below).
2. The CTA links through to **the exact `productUrl` the API returns**, e.g. `https://www.viator.com/tours/.../d4371-227717P1?mcid=42383&pid=P00063937&medium=api&api_version=2.0`. That URL already carries the account's `pid`/`mcid`.
3. Landing on viator.com sets a cookie; **any purchase within 30 days is attributed automatically.** Viator tracks and pays commission — Atlas builds none of that.

**The only rule: never strip, reorder, or reconstruct those URL parameters.** Use `productUrl` verbatim. You may append your own `&campaign=<value>` (alphanumeric + dashes only) for your own analytics.

Atlas's **first-party click ledger** (FR-AFF-1, shipped in BRI-136) is a thin server-side redirect built on top of this, not a replacement for it: `apps/web`'s `/go/:slug/:id` route logs the click (POST to the API's `POST /v1/affiliate-clicks`, persisted as `AffiliateClick`) and then 302s straight to the untouched `productUrl`.

## The ingestion pipeline (as built)

The pipeline lives in `apps/api/src/modules/import/` and is orchestrated per page by `import.pipeline.ts` (`ImportPipeline.runSegment`). Read that file's class docstring for the authoritative, current description; this is the summary.

**Stages, all run per page before the next page is fetched:**

1. **Fetch + archive** — `ViatorClient.fetchModifiedSince` crawls `/products/modified-since` (paginated, rate-limited with backoff, honours `Retry-After`), archiving each raw page to Cloudflare R2 via `RawArchiveStore`.
2. **Scope filter** (`decideIngestScope`, BRI-170/171) — runs on the **raw** product, before anything downstream. `/products/modified-since` has **no server-side destination filter** — it returns Viator's entire global catalogue — so the partner must filter. Three independent exclusions: not one of the 6 curated cities (exact `destinations[].ref` match against `curated-cities.ts`), `INACTIVE`, or manual-confirmation (`MANUAL` / `INSTANT_THEN_MANUAL`). Only ~6% of the scanned catalogue survives. Applying this *first* is what keeps the expensive later stages off the full catalogue.
3. **Normalize** (`normalizeViatorProduct`, ST-7) — pure function, no DB/network/clock. Maps a raw `ViatorProduct` → `TourDTO`. See the ownership boundary below. **Detail payloads carry no price**, so it leaves price null.
4. **Location resolve** (`LocationResolver`, ST-7b) — resolves start-location refs to coordinates via `/locations/bulk`, cached indefinitely in `ProviderLocation`.
5. **Price resolve** (`PriceResolver`, ST-7c/BRI-165) — attaches the "from" price per product from `/availability/schedules/{code}` (see the price section below).
6. **Validate / quarantine** (`TourValidator`, ST-8) — passing tours proceed; bad rows are persisted to `QuarantinedTour` and counted.
7. **Upsert** (`TourUpsertService.upsertBatch`, ST-9) — idempotent per-page upsert into `Tour`. A once-per-**run** `finalizeGuardedSoftDelete` handles soft-deletes behind a mass-deletion guard, and `ExperienceLinker` links the committed catalogue to curated `City`/`Experience` rows.

**Memory discipline (BRI-170 → BRI-176).** Two production OOM-kills on Render's 512 MiB free tier drove the current shape. BRI-170 stopped buffering the whole crawl in memory (stream every stage per page; scope-filter before accumulating). BRI-176 then found the residual growth was in `undici`'s HTTP response decoding, released cleanly only when a `fetchModifiedSince` generator *naturally* completes — so a run is now split into short-lived **OS-process segments**: `ImportRunService` spawns a fresh `segment-worker.cli.ts` child per segment (`IMPORT_CRAWL_RESTART_PAGES` pages each), and a process exiting *is* a natural release. `finalizeGuardedSoftDelete`/`ExperienceLinker` run once, only in the process whose segment reports `done: true`, reconstructing the run's full incoming-id set from the DB (rows sharing the run's `fetchedAt`) rather than carrying it across process boundaries.

**Scheduling.** The nightly run is fired by the Railway `@folio/api-cron` service (`.railway/railway.ts`): cron `0 3 * * *` UTC, restart policy `NEVER`, running `trigger-import.cli.js --trigger scheduled`. That CLI boots a headless Nest context (no HTTP listener), runs `ImportRunService`, prints the `ImportRun` record and exits. Run it by hand with `pnpm --filter @folio/api import:run` (it builds first); `--trigger scheduled|manual` sets the `trigger` recorded on the run and defaults to `manual`. There is no HTTP trigger endpoint: `apps/api` has no import controller. `ImportScheduler` (`scheduler.ts`, ST-10/BRI-107) still registers an in-process nightly job, env-driven (`IMPORT_CRON_SCHEDULE`, `IMPORT_CRON_ENABLED`), and reaps runs left `running` by a crashed process at boot. BRI-173's external wake trigger and self-heartbeat (a Render free-tier idle-sleep workaround) were removed with the Railway migration. Each firing is recorded as an `ImportRun`. See `apps/api/AGENTS.md` for the deployment detail.

### Open policy question: `/products/bulk` vs `/products/modified-since`

Viator's own docs **contradict themselves** on whether a partner ingesting a small curated subset should use `/products/bulk` (content for a known code set) or `/products/modified-since` (full-catalogue delta). The Workflows guide sanctions bulk for a "small subset"; three endpoint-reference notes forbid bulk-for-ingestion with no such exception. The pipeline currently uses `/products/modified-since` + the per-page scope filter (unambiguously sanctioned, and the fix that resolved the OOM). Do **not** switch models without resolving this with Viator directly — their ingestion strategy is a **certification requirement** reviewed before production access. Full analysis and quotes: `docs/13-viator-api-audit.md`.

## Ownership boundary: match, don't overwrite

The normalizer only ever sets **provider-sourced** fields + provenance (`title`, rating, `affiliate_url`, price, images) — never Atlas-owned fields (editor rating, curated tags, slug, curation status). Crucially, the provider's `title`/`description` are **not** the canonical public copy: the canonical `/destinations/:slug` page renders Atlas's own editorial copy (the reason the site can honestly say "independently written" and the reason it cleared OTA review). The ingested `Tour` is intended to supply only price/image/`affiliateUrl` onto those editorial cards (BRI-168). This "match, don't overwrite" rule is the same one the hand-authored path follows — see `docs/07`.

## Price is endpoint-specific (verified live, BRI-165)

The `/products/search` **summary** returns `pricing.summary.fromPrice`. The Full-Access **product _detail_** shape (`GET /products/{code}` and the `/products/modified-since` crawl the ingest pipeline consumes) does **not** carry a price at all — a real detail payload has `pricingInfo` = `{ type, ageBands }` (booking constraints only, no amount). The "from" price for a detail-ingested product lives in a separate per-product endpoint, `GET /availability/schedules/{code}` → `{ "currency": "USD", "summary": { "fromPrice": 28 } }`. The normalizer therefore leaves price null and the price resolver attaches it from `/availability/schedules`, exactly as the location resolver attaches coordinates. Do not assume the search-summary price path holds for detail payloads — it doesn't, and assuming it did quarantined 100% of real imports before BRI-165.

The aggregate `reviews` object (`combinedAverageRating` + `totalReviews`, sourced from Viator + TripAdvisor), `flags` (e.g. `FREE_CANCELLATION`), `duration`, and `images` **are** present on the detail payload and safe to surface — they carry no duplicate-content risk (unlike the supplier `title`/`description`, which Atlas deliberately does not show as canonical copy). What is separately gated is the dedicated `/reviews/product` endpoint (individual review *content*), not the aggregate rating.

## A compliance constraint worth knowing before you show reviews

Viator requires that **reviews and anything in the `viatorUniqueContent` object never appear in page source** — not in HTML, not inline in `<script>` tags. It must load via an *external* JS file that is itself blocked in `robots.txt`, so search engines can't index Viator's proprietary content. Atlas doesn't display individual review content today, so this doesn't bite yet — but it sits in real tension with an SSR-everything approach to SEO. The pattern when the time comes: reviews fetched client-side from a separate, robots-disallowed endpoint, while everything else stays server-rendered for indexing.

## Front-end shape (recommended, not mandatory)

Viator's own guide recommends **Landing page → Search Results Page (SRP) → Product Display Page (PDP)**, which already matches Atlas's sitemap (destinations → experience list → detail):

- **SRP** (destination pages): rating, thumbnail, teaser, free-cancellation flag, price, category filters via tags, destination breadcrumb.
- **PDP** (if built): title, rating, 3-level breadcrumb (country/region/city), photos, "price from," cancellation policy, duration, languages, overview, inclusions/exclusions, itinerary, nearby attractions.

## Known follow-ups from the audit (`docs/13`)

Flagged there, not yet implemented — each a scoped decision for Roy, not a doc-only guess:

- **Bulk price fetch** — `/availability/schedules/bulk` (500 codes/request) would replace the per-product price-resolver fanout; the exact bulk response envelope needs one live call to verify first.
- **Request timeouts** — no timeout is configured on any Viator call (`viator.client.ts`, `price-resolver.ts`, `location-resolver.ts`, `allowlist-fetch.ts`); a hung request can occupy a concurrency slot indefinitely. Recommend a timeout well under Viator's booking-specific 120s ceiling for these read-only endpoints.
- **Explicit `status`/`confirmationType` gates** — the scope filter now excludes `INACTIVE` and manual-confirmation products deliberately (BRI-171), closing the two gaps the audit raised.
