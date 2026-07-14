# Atlas — Engineering Specification

**Living Document 03 of 3** · Derived from [Master Product Specification v1.0](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md)
**Scope:** What gets built, in what order — Milestones → Epics → User Stories → Acceptance Criteria, traced to `FR-*`/`NFR-*` IDs.
**Owner:** Roy Mkhabela · **Version:** 1.0 · **Updated:** 2026-07-05

> Answers **what/when**. For **why** see [Product Bible](01-product-bible.md); for **how** see [System Architecture Specification](02-system-architecture-specification.md).

---

## How to read this document

**Hierarchy.** `Milestone (M#) → Epic (EP-#) → Story (ST-#)`. Each story has:
- **As-a / I-want / So-that** framing.
- **Traces:** the `FR-*`/`NFR-*` IDs it implements (defined in [Architecture §2–3](02-system-architecture-specification.md#2-functional-requirements)).
- **Acceptance Criteria (AC):** Given/When/Then, testable, unambiguous.

**Definition of Ready (DoR):** a story is ready when it has an owner, traces to ≥1 requirement, has AC, and its dependencies are done.
**Definition of Done (DoD):** code + tests (per [Architecture §... Testing](02-system-architecture-specification.md)) merged via PR, CI green (lint, typecheck, unit, integration, relevant E2E/SEO/a11y gates), deployed to preview, docs/IDs updated. No story is "done" without passing acceptance tests.

**ID conventions:** `EP-<n>` epics (global, stable), `ST-<n>` stories (global, stable). Milestones group them but IDs don't restart per milestone.

**Estimation:** relative story points (1,2,3,5,8,13). Points are guidance, not commitment.

---

## Contents
- [Milestone map](#milestone-map)
- [M0 — Foundations](#m0--foundations)
- [M1 — Ingest (MVP)](#m1--ingest-mvp)
- [M2 — Discovery](#m2--discovery)
- [M3 — The Map](#m3--the-map)
- [M4 — Affiliate](#m4--affiliate)
- [M5 — SEO](#m5--seo)
- [M6 — Scale-out](#m6--scale-out)
- [M7 — CMS / Admin](#m7--cms--admin)
- [M8 — Intelligence](#m8--intelligence)
- [M9 — Hardening](#m9--hardening)
- [Traceability matrix](#traceability-matrix)
- [Cross-cutting Definition of Done](#cross-cutting-definition-of-done)

---

## Milestone map

| M | Theme | Epics | Exit criteria (demoable) |
|---|-------|-------|--------------------------|
| M0 | Foundations | EP-1, EP-2 | Deployed shell; one hardcoded destination page renders in prod; CI green |
| M1 | Ingest (MVP) | EP-3, EP-4 | Real tours imported from one OTA; a city page renders from the DB |
| M2 | Discovery | EP-5, EP-6 | User searches + filters experiences; experience/tour detail pages |
| M3 | The Map | EP-7 | Interactive map: pins, clusters, bbox query, pin→card |
| M4 | Affiliate | EP-8 | CTA → `/go/:tourId` logs click → deep-link redirect to OTA |
| M5 | SEO | EP-9 | Programmatic destination pages with schema + sitemap, indexable |
| M6 | Scale-out | EP-10, EP-11 | Imports on queue/workers; Redis cache; dedicated search engine |
| M7 | CMS / Admin | EP-12, EP-13, EP-14 | Editor logs in, moderates imports, enriches, publishes; analytics visible |
| M8 | Intelligence | EP-15, EP-16, EP-17 | AI summaries (approved), recommendations, trip planner |
| M9 | Hardening | EP-18, EP-19 | Observability, load-tested to budgets, security review passed |

**Blocking dependency:** EP-3 (OTA integration) is blocked by [Open Question #1](02-system-architecture-specification.md#e-open-technical-questions) — pick + get affiliate-program/API approval for the launch OTA before M1.

---

## M0 — Foundations
_Goal: a deployable full-stack skeleton with CI. New concept: full-stack deploy + CI._

### EP-1 — Project scaffold & CI/CD
- **ST-1 (3)** — _As a developer, I want a monorepo with Next.js + NestJS scaffolds, so that frontend and backend build and run locally._
  - Traces: NFR-SCALE-1.
  - AC: Given a clean clone, when I run the documented dev command, then both apps start; a `/health` endpoint returns 200; the web app renders a placeholder home.
- **ST-2 (3)** — _As a developer, I want Docker Compose (app, Postgres, Redis), so that local env matches prod dependencies._
  - AC: `docker compose up` starts Postgres + Redis; the API connects on boot; `/ready` returns 200 only when both are reachable.
- **ST-3 (3)** — _As a developer, I want GitHub Actions CI, so that lint, typecheck, and unit tests gate every PR._
  - AC: Given a PR, when CI runs, then failing lint/typecheck/test blocks merge; green CI allows it.
- **ST-4 (2)** — _As a developer, I want preview + production deploys, so that every branch is viewable and main ships._
  - AC: A PR produces a preview URL; merging to main deploys to production; a failed health check auto-rolls back.

### EP-2 — First vertical slice
- **ST-5 (3)** — _As a visitor, I want one hardcoded destination page, so that the end-to-end path (browser→frontend→API→DB) is proven._
  - Traces: FR-DEST-1 (partial).
  - AC: `/destinations/france/paris` renders server-side with a title, hero, and a static list of experiences fetched from one API endpoint reading one seeded DB row.

**M0 exit:** deployed shell, one destination page in prod, CI green.

---

## M1 — Ingest (MVP)
_Goal: real curated data. New concept: REST + ORM + cron._
_Blocked by: launch-OTA decision + API access._

### EP-3 — OTA integration (one provider)
- **ST-6 (5)** — _As the platform, I want an OTA client for the launch provider, so that I can fetch tours with pagination + rate-limit backoff._
  - Traces: FR-IMPORT-1.
  - AC: Given valid API creds, when the client runs, then it fetches paged tours, backs off on 429, and stores raw payloads to object storage for replay.
- **ST-7 (5)** — _As the platform, I want a normalizer, so that provider fields map to the Atlas `Tour` schema with provenance._
  - Traces: FR-IMPORT-2.
  - AC: Golden-file test: given a recorded provider payload, when normalized, then output matches the expected `Tour` record incl. `provider`, `provider_tour_id`, `fetched_at`, `source_hash`.
- **ST-8 (3)** — _As the platform, I want a validator, so that malformed rows are quarantined not published._
  - AC: Rows missing title/geo/price, or with out-of-range coords / non-positive price, are quarantined and counted; valid rows pass.
- **ST-9 (5)** — _As the platform, I want an idempotent upsert + soft-delete, so that re-runs don't duplicate and gone tours are retired safely._
  - Traces: FR-IMPORT-3.
  - AC: Re-running the same import creates 0 new rows; a tour absent from a run gets `deleted_at` set; a run that would soft-delete > X% aborts + alerts.
- **ST-10 (2)** — _As the platform, I want a nightly cron trigger, so that imports run unattended._
  - AC: A scheduled job triggers the import; an `import_run` record captures status + counts + timestamps.

### EP-4 — Data-backed destination pages
- **ST-11 (3)** — _As a visitor, I want city pages rendered from imported data, so that content is real, not hardcoded._
  - Traces: FR-DEST-1, FR-DEST-2, FR-DEST-3.
  - AC: `/destinations/:country/:city` SSR-renders published experiences from the DB with title, image, editor rating (nullable), price band, tags, and a CTA placeholder; paginated.
- **ST-12 (2)** — _As a visitor, I want an experience → tours relationship visible, so that one concept can show multiple provider offerings._
  - Traces: FR-IMPORT-5 (basic linkage).
  - AC: An Experience detail lists its linked Tours (even if 1:1 at MVP).

**M1 exit:** real tours imported from one OTA; a city page renders from the DB.

---

## M2 — Discovery
_Goal: users can find things. New concept: full-text search + faceting._

### EP-5 — Search & autocomplete
- **ST-13 (5)** — _As a traveler, I want free-text search, so that I can find experiences and destinations._
  - Traces: FR-SRCH-1.
  - AC: `GET /search?q=` returns Experiences + Destinations ranked by relevance + popularity; empty query returns featured content; response < 500 ms (Phase-A Postgres FTS).
- **ST-14 (3)** — _As a traveler, I want autocomplete, so that I get suggestions as I type._
  - Traces: FR-SRCH-3, NFR-PERF-2.
  - AC: `GET /search/autocomplete?q=` returns destination/experience/intent suggestions; P95 < 150 ms on the seed dataset.
- **ST-15 (3)** — _As a traveler, I want fuzzy + synonym matching, so that typos and phrasing still work._
  - Traces: FR-SRCH-4.
  - AC: "kid-friendly" returns "family" results; a 1-char typo still matches (via `pg_trgm`).

### EP-6 — Filters & detail pages
- **ST-16 (5)** — _As a traveler, I want composable filters reflected in the URL, so that I can refine and share results._
  - Traces: FR-SRCH-2, FR-FILT-1.
  - AC: Filters (category, tag, price band, duration, rating, suitability) combine; state is in the URL; reloading the URL reproduces results.
- **ST-17 (3)** — _As a traveler, I want experience and tour detail pages, so that I can evaluate an option._
  - Traces: FR-DEST-3, FR-REV-1.
  - AC: Experience page shows enrichment facts, aggregated tours, imported rating + count with provider attribution; tour page shows price snapshot (timestamped) + inclusions.
- **ST-18 (3)** — _As a traveler, I want to compare 2–4 tours, so that I can choose confidently._
  - Traces: FR-DEST-4.
  - AC: Selecting 2–4 tours opens a comparison of price, duration, rating, provider, inclusions.

**M2 exit:** search + filters + detail/compare pages work on the seed dataset.

---

## M3 — The Map
_Goal: map-first discovery (the moat). New concept: PostGIS geo queries._

### EP-7 — Interactive map
- **ST-19 (5)** — _As a traveler, I want a bbox geo endpoint, so that the map loads only pins in view._
  - Traces: FR-MAP-1, NFR-PERF-1.
  - AC: `GET /map/experiences?bbox=…&filters` returns only experiences within the bbox (PostGIS `ST_Within`), capped at N with server-side clustering beyond that.
- **ST-20 (5)** — _As a traveler, I want pins + clustering on the map, so that I can explore spatially._
  - Traces: FR-MAP-1.
  - AC: Panning/zooming re-queries (debounced); pins cluster by zoom; pins styled by category/price band.
- **ST-21 (3)** — _As a traveler, I want pin → card without reload, so that exploration is fluid._
  - Traces: FR-MAP-2.
  - AC: Clicking a pin opens an Experience card client-side; the active filter applies to both list and map (FR-FILT-1).
- **ST-22 (5)** — _As a traveler, I want nearby attractions for a pin, so that I understand the area._
  - Traces: FR-MAP-3, TD-10.
  - AC: A selected pin shows nearby Atlas experiences within radius; restaurants shown only if the data spike (see below) proves feasible/affordable.
- **ST-23 (2, spike)** — _Spike: evaluate nearby-restaurant data source + cost (Google Places vs OSM)._
  - Traces: TD-10, Open Q#5. AC: a written recommendation with cost estimate; decision recorded in [Architecture §20.E](02-system-architecture-specification.md#e-open-technical-questions).

**M3 exit:** interactive map with pins, clusters, bbox query, pin→card.

---

## M4 — Affiliate
_Goal: first revenue path. New concept: redirect + attribution + event logging._

### EP-8 — Affiliate engine
- **ST-24 (5)** — _As the business, I want a `/go/:tourId` redirect that logs before redirecting, so that no click is lost._
  - Traces: FR-AFF-1, NFR-PERF-4.
  - AC: `GET /go/:tourId` writes an `affiliate_click` row (tour, provider, session, referrer, hashed IP, ts) **before** issuing a 302; response is `no-store`; server time < 200 ms.
- **ST-25 (3)** — _As the business, I want provider-correct deep links, so that commission is attributable._
  - Traces: FR-AFF-2.
  - AC: The deep link includes the configured affiliate/partner ID and required tracking params per provider spec (unit-tested against fixtures).
- **ST-26 (3)** — _As the business, I want fallback + link-health, so that broken links don't lose users or revenue._
  - Traces: FR-AFF-3.
  - AC: Missing/expired `affiliate_url` redirects to provider search for the Experience and flags the tour; a scheduled job pings a sample and flags failures in a report.
- **ST-27 (2)** — _As the business, I want affiliate disclosure, so that we're compliant._
  - Traces: FR-AFF (compliance).
  - AC: Every page with a CTA shows disclosure; `/legal/affiliate-disclosure` exists.

**M4 exit:** CTA → `/go` logs click → deep-link redirect; disclosure live.

---

## M5 — SEO
_Goal: organic traffic. New concept: programmatic SEO + structured data._

### EP-9 — SEO surface
- **ST-28 (5)** — _As Google, I want structured data on indexable pages, so that Atlas earns rich results._
  - Traces: FR-SEO-1.
  - AC: Destination/experience/guide pages emit valid JSON-LD (`TouristAttraction`/`Product`+`Offer`/`AggregateRating`/`BreadcrumbList`/`ItemList`/`Article`); CI validates schema.
- **ST-29 (5)** — _As the business, I want programmatic destination + intent pages, so that we cover long-tail keywords._
  - Traces: FR-SEO-1, FR-DEST-2.
  - AC: Pages generated for each published city + intent templates ("Things to do in {city}", "{category} in {city}", "Best {tag} in {city}"); each renders unique substantive content.
- **ST-30 (3)** — _As the business, I want a content quality gate, so that thin pages aren't indexed._
  - AC: A page failing min-words / unique-summary / ≥1 image / ≥3 experiences is `noindex` until enriched.
- **ST-31 (3)** — _As Google, I want sitemaps + robots, so that crawling is efficient._
  - AC: Auto-generated sharded `sitemap.xml` regenerates on publish/import; `robots.txt` disallows `/go/*`, `/admin/*`, filter noise.
- **ST-32 (3)** — _As a visitor on mobile, I want fast pages, so that CWV pass._
  - Traces: NFR-PERF-3.
  - AC: Destination LCP < 2.5 s (P75 mobile 4G), CLS < 0.1, INP < 200 ms in a Lighthouse CI check.

**M5 exit:** programmatic pages with schema + sitemap, indexable, CWV pass.

---

## M6 — Scale-out
_Goal: backend depth + performance. New concept: queues, caching, dedicated search._

### EP-10 — Async import pipeline
- **ST-33 (5)** — _As the platform, I want imports on a queue with workers, so that large syncs don't block and are resumable._
  - Traces: FR-IMPORT-1, NFR-PERF-5.
  - AC: Import work enqueues to BullMQ; workers process in parallel; a killed worker resumes from the persisted cursor; 50k-tour sync completes < 2 h.
- **ST-34 (5)** — _As the platform, I want deduplication into canonical Experiences, so that the dataset isn't noisy._
  - Traces: FR-IMPORT-5.
  - AC: Near-identical tours (geo proximity + title similarity + provider) cluster to one canonical Experience; the assignment is deterministic and reviewable; golden-file tested.

### EP-11 — Cache & dedicated search
- **ST-35 (5)** — _As a visitor, I want cached hot payloads + map tiles, so that pages and the map are fast and Maps cost is controlled._
  - Traces: NFR-PERF-1, TD-7.
  - AC: Redis caches destination/experience payloads and map bbox results (grid+filter-hash key); publish/import invalidates affected keys; cache hit ratio observable.
- **ST-36 (5)** — _As a traveler, I want a dedicated search engine, so that search is instant and typo-tolerant at scale._
  - Traces: FR-SRCH-1…5, NFR-PERF-2, TD-1.
  - AC: Meilisearch/Typesense indexed from the import pipeline; search P95 < 150 ms; a nightly reconciliation verifies index ⇄ DB parity and repairs drift.

**M6 exit:** imports async/resumable; Redis cache live; dedicated search serving.

---

## M7 — CMS / Admin
_Goal: operate at scale. New concept: auth/RBAC + dashboards._

### EP-12 — Auth & RBAC
- **ST-37 (5)** — _As an operator, I want secure login with roles, so that only authorized people manage content._
  - Traces: FR-AUTH-1, FR-ADMIN-2, NFR-SEC-1.
  - AC: Email+password (Argon2id), JWT access (15 min) + rotating refresh (httpOnly); `admin/editor/viewer` roles enforced by API guards; login throttling + lockout.

### EP-13 — CMS
- **ST-38 (5)** — _As an editor, I want a moderation queue, so that I approve/reject/edit imported tours before they're public._
  - Traces: FR-CMS-1.
  - AC: Queue lists pending tours; approve publishes; reject hides; edits to enrichment fields persist + audit-log who/when.
- **ST-39 (5)** — _As an editor, I want experience enrichment + merge/dedupe, so that the moat data stays high-quality._
  - Traces: FR-CMS-1, FR-IMPORT-5.
  - AC: Editor can edit rating/tags/categories/summaries/flags, merge duplicate experiences, and set the canonical; changes invalidate cache + sitemap.
- **ST-40 (5)** — _As an editor, I want guides + collections with scheduling + SEO fields, so that editorial content ships on time._
  - Traces: FR-CMS-2.
  - AC: Markdown guide editor with embedded experience cards/map anchors + SEO overrides; publish/schedule/unpublish works; workflow states audited.

### EP-14 — Admin analytics
- **ST-41 (5)** — _As an operator, I want import + revenue analytics, so that I can monitor health and money._
  - Traces: FR-ADMIN-1, FR-ANALYTICS-1.
  - AC: Dashboard shows import runs/failures with **re-run**, click volume over time, top experiences/cities, search terms incl. **zero-result**, CTR, and estimated vs confirmed commission.

**M7 exit:** editor logs in, moderates, enriches, publishes; analytics visible.

---

## M8 — Intelligence
_Goal: AI + planning. New concept: LLM integration + routing._

### EP-15 — AI content (human-in-the-loop)
- **ST-42 (5)** — _As an editor, I want AI-generated summaries as drafts, so that I enrich faster without losing control._
  - Traces: FR-CMS-1 (AI), Architecture §12.
  - AC: Enrichment generates `ai_summary` as `status='enriched'` draft with provenance (model, prompt version, ts); **nothing publishes without editor approval**; prompts constrained to provided data (no fabricated prices/availability); cost alerts wired.

### EP-16 — Recommendations
- **ST-43 (3)** — _As a traveler, I want "similar experiences", so that I keep discovering._
  - Traces: FR-REC-1.
  - AC: Experience pages show same-city experiences sharing categories/tags with comparable price band.
- **ST-44 (3)** — _As a traveler, I want "best for {intent}" / "best in {month}", so that discovery matches my need._
  - Traces: FR-REC-2.
  - AC: Server-computed lists for intent + month render on relevant pages.

### EP-17 — Trip planner
- **ST-45 (8)** — _As a weekend traveler, I want a mapped, ordered itinerary, so that I plan efficiently._
  - Traces: FR-DEST-5, FR-MAP-4.
  - AC: Add stops → server orders (nearest-neighbor v1) → route + walking segments render → each stop keeps its affiliate CTA → itinerary saves (anonymous local first; server-side once authenticated).

**M8 exit:** approved AI summaries, recommendations, working trip planner.

---

## M9 — Hardening
_Goal: production-grade. New concept: SRE + testing depth._

### EP-18 — Observability & reliability
- **ST-46 (5)** — _As an operator, I want tracing, metrics, and alerts, so that I detect issues before users do._
  - Traces: Architecture §17, NFR-AVAIL-1.
  - AC: OpenTelemetry traces API→DB/queue/search; Sentry captures errors with issue URLs; alerts fire on import abort, soft-delete guard trip, auth-failure spikes, SLO breach, Maps/LLM cost thresholds.
- **ST-47 (5)** — _As the business, I want load tests to the budgets, so that we know our limits._
  - Traces: NFR-PERF-1…5.
  - AC: k6 tests on `/search` and `/map/experiences` confirm P95 budgets at target concurrency; import throughput meets NFR-PERF-5.

### EP-19 — Security & quality gates
- **ST-48 (5)** — _As the business, I want a security review + automated gates, so that we ship safely._
  - Traces: NFR-SEC-1, Architecture §14.
  - AC: OWASP Top-10 checklist passed; Dependabot + `npm audit` gate CI on criticals; secrets absent from repo (scanner in CI); a11y (axe) + SEO-validation gates green on public pages.

**M9 exit:** observability live, load-tested to budgets, security review passed.

---

## Traceability matrix

Every `FR-*` maps to at least one story (upward: story → FR → `BG-*`). Coverage summary:

| Requirement | Stories | Requirement | Stories |
|-------------|---------|-------------|---------|
| FR-DEST-1 | ST-5, ST-11 | FR-IMPORT-1 | ST-6, ST-10, ST-33 |
| FR-DEST-2 | ST-11, ST-29 | FR-IMPORT-2 | ST-7 |
| FR-DEST-3 | ST-11, ST-17 | FR-IMPORT-3 | ST-9 |
| FR-DEST-4 | ST-18 | FR-IMPORT-4 | ST-41 |
| FR-DEST-5 | ST-45 | FR-IMPORT-5 | ST-12, ST-34, ST-39 |
| FR-SRCH-1 | ST-13, ST-36 | FR-CMS-1 | ST-38, ST-39, ST-42 |
| FR-SRCH-2 | ST-16 | FR-CMS-2 | ST-40 |
| FR-SRCH-3 | ST-14 | FR-ADMIN-1 | ST-41 |
| FR-SRCH-4 | ST-15 | FR-ADMIN-2 | ST-37 |
| FR-FILT-1 | ST-16, ST-21 | FR-AUTH-1 | ST-37 |
| FR-MAP-1 | ST-19, ST-20 | FR-AUTH-2/3 | ST-45 (accounts), backlog |
| FR-MAP-2 | ST-21 | FR-AFF-1 | ST-24 |
| FR-MAP-3 | ST-22, ST-23 | FR-AFF-2 | ST-25 |
| FR-MAP-4 | ST-45 | FR-AFF-3 | ST-26 |
| FR-REC-1/2 | ST-43, ST-44 | FR-ANALYTICS-1 | ST-24, ST-41 |
| FR-REV-1 | ST-17 | FR-SEO-1 | ST-28…ST-31 |

**Not yet scheduled (backlog, post-v1):** FR-SRCH-6 (natural-intent search), FR-MAP-5 (heat map), FR-AUTH-3 (Google OAuth as standalone), FR-REV-2 (UGC — Won't-v1).

---

## Cross-cutting Definition of Done

Applies to **every** story in addition to its AC:

1. Code merged via reviewed PR; branch deleted.
2. CI green: lint + typecheck + unit + integration; E2E on critical-path stories; SEO/a11y gates on public-page stories.
3. New/changed endpoints conform to [Architecture §4](02-system-architecture-specification.md#4-api-specification) (versioned, paginated, RFC 9457 errors).
4. Migrations forward-only, reviewed, run in CI on an ephemeral DB.
5. No secrets in repo; new config documented in `.env.example`.
6. Observability: meaningful logs/metrics for new critical paths; no PII/secrets logged.
7. Requirement IDs + this doc's traceability updated.
8. Deployed to preview and demoed against AC before close.

---
_End of Engineering Specification v1.0._
