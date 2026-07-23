# Atlas — System Architecture Specification

**Living Document 02 of 3** · Derived from [Master Product Specification v1.0](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md)
**Scope:** How the system is built — Domain, Requirements, APIs, Services, Data, Search, Maps, Affiliate, SEO, AI, Security, Performance, Infra, Observability, Testing, Analytics.
**Owner:** Roy Mkhabela · **Version:** 1.0 · **Updated:** 2026-07-05

> Answers **how**. For **why** see [Product Bible](01-product-bible.md); for **what/when** see [Engineering Specification](03-engineering-specification.md).

**Requirement ID convention:** `FR-<area>-<n>` (functional), `NFR-<area>-<n>` (non-functional), `CON-<n>` (constraint), `ASM-<n>` (assumption). Every requirement is unambiguous, testable, and traceable to a Business Goal (`BG-*`, [Product Bible §1.4](01-product-bible.md#14-business-goals)).

---

## Contents
1. [Domain Model](#1-domain-model)
2. [Functional Requirements](#2-functional-requirements)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [API Specification](#4-api-specification)
5. [Backend Services](#5-backend-services)
6. [Data Pipeline](#6-data-pipeline)
7. [Database Design](#7-database-design)
8. [Search Architecture](#8-search-architecture)
9. [Maps Architecture](#9-maps-architecture)
10. [Affiliate Engine](#10-affiliate-engine)
11. [SEO Architecture](#11-seo-architecture)
12. [AI Content Generation](#12-ai-content-generation)
13. [CMS & Admin](#13-cms--admin)
14. [Security](#14-security)
15. [Performance](#15-performance)
16. [Infrastructure](#16-infrastructure)
17. [Observability](#17-observability)
18. [Technical Debt Register](#18-technical-debt-register)
19. [Technical Glossary](#19-technical-glossary)
20. [Appendices](#20-appendices)

---

# 1. Domain Model

The domain model is the moat — deliberately **richer than the OTA source**.

## 1.1 Core entities

| Entity | Description | Key relationships |
|--------|-------------|-------------------|
| **Country** | Territory grouping | has many Cities |
| **City** (Destination) | Primary discovery unit | belongs to Country; has Experiences, Location |
| **Experience** | Atlas-curated concept aggregating provider Tours | belongs to City; has Tours, Categories, Tags, Images, Location |
| **Tour** | Single bookable OTA offering | belongs to Experience; has Provider, Price, Availability, AffiliateLink |
| **Provider** | OTA / affiliate source | has Tours, AffiliateProvider config |
| **Category** | Taxonomy (Food, Adventure, Culture…) | m:n Experience |
| **Tag** | Intent/attribute (romantic, family, hidden-gem, under-50, sunset) | m:n Experience |
| **Review** | Imported aggregate + editorial rating (no UGC v1) | belongs to Experience/Tour |
| **Image** | CDN media, attributed | belongs to Experience/Tour/City |
| **Route** | Ordered path (walking/itinerary) | references Locations |
| **Location** | Geospatial point/polygon (lat/lng, geohash, bbox) | referenced widely |
| **Currency / Language** | ISO + FX / localization | referenced by Price / Content |
| **Guide / Author** | Editorial long-form + identity (E-E-A-T) | Author writes Guides |
| **Collection** | Curated grouping | m:n Experience |
| **Itinerary** | User-built ordered plan | has Stops |
| **MapLayer** | Map rendering config | references Experiences |
| **AffiliateProvider / Price / Availability** | Commission config / snapshots | per Provider / per Tour |
| **AffiliateClick** | Append-only click event | references Tour |

## 1.2 Lifecycles
- **Tour:** `imported → normalized → deduped(→ linked Experience) → pending_review → approved/rejected → published → refreshed → soft-deleted`.
- **Experience:** `draft → enriched → published → featured? → archived`.
- **Guide:** `draft → in_review → scheduled → published → updated → archived`.
- **AffiliateClick:** append-only, never mutated.

## 1.3 Ownership rules
- **OTA owns:** price, availability, booking, inclusions, cancellation (mirrored as timestamped snapshots, never authoritative).
- **Atlas owns:** Experience concept, categories, tags, editor rating, walking distance, best-season, hidden-gem flag, AI summary, curation status, slug, SEO metadata.
- **Dedup authority:** Import/Dedup service assigns a canonical Experience per cluster; `provider_tour_id` is immutable.

## 1.4 Enrichment attributes (differentiators)
On `Experience`: `editor_rating (0–5)`, `intent_tags[]`, `walking_distance_center_m`, `best_months[]`, `is_hidden_gem`, `ai_summary`, `seasonal_notes`, `typical_duration_min`, `difficulty`, `family_suitability`, `solo_suitability`, `price_band (free|$|$$|$$$)`.

Full ER diagram: [Appendix A](#a-er-diagram-textual).

---

# 2. Functional Requirements

Priority = MoSCoW. IDs are stable and never reused. Traced to `BG-*`.

## 2.1 Destination pages
- **FR-DEST-1 (Must):** Render a destination page for every published City with hero media, intro, map, and paginated published Experiences. _(BG-1, BG-3)_
- **FR-DEST-2 (Must):** Destination pages are SSR/SSG and include structured data. _(BG-1)_
- **FR-DEST-3 (Must):** Each Experience card shows title, primary image, editor rating, price band, top categories/tags, affiliate CTA. _(BG-2, BG-3)_
- **FR-DEST-4 (Should):** Allow comparison of 2–4 Tours by price, duration, rating, provider, inclusions.
- **FR-DEST-5 (Should):** Users save Experiences to a Collection/Itinerary, persisted anonymously (local + server once authenticated).

## 2.2 Search & filters
- **FR-SRCH-1 (Must):** Global search returns Experiences and Destinations ranked by relevance + popularity. _(BG-1)_
- **FR-SRCH-2 (Must):** Filters: category, intent tag, price band, duration, rating, family/solo suitability.
- **FR-SRCH-3 (Must):** Autocomplete for destinations/experiences/intents, P95 < 150 ms.
- **FR-SRCH-4 (Should):** Fuzzy matching + synonyms ("kid-friendly" ≈ "family").
- **FR-SRCH-5 (Should):** Geo "near me" / "near {landmark}".
- **FR-SRCH-6 (Could):** Natural-intent search ("romantic under $50 at sunset").
- **FR-FILT-1 (Must):** Filters are composable, URL-reflected (shareable), applied to list + map simultaneously.

## 2.3 Map
- **FR-MAP-1 (Must):** Render pins for all Experiences matching the active filter, clustered by zoom. _(BG-3)_ _(Clustering is 2D-only; the 3D-first map used at curation scale has no cluster primitive — see [docs/11](11-map-and-planner-direction.md).)_
- **FR-MAP-2 (Must):** Clicking a pin opens an Experience card without full reload.
- **FR-MAP-3 (Should):** Show nearby attractions and (where data allows) restaurants for a selected pin.
- **FR-MAP-4 (Should):** Walking radius + ordered route between Trip Planner stops.
- **FR-MAP-5 (Could):** Heat-map layer of density/popularity.

## 2.4 Recommendations & reviews
- **FR-REC-1 (Should):** "Similar experiences" (same city, shared categories/tags, comparable price band).
- **FR-REC-2 (Could):** "Best for {persona/intent}" and "Best in {month}".
- **FR-REV-1 (Must):** Display imported aggregate ratings + counts with provider attribution.
- **FR-REV-2 (Won't-v1):** User-generated reviews out of scope.

## 2.5 Import pipeline
- **FR-IMPORT-1 (Must):** Import Tours from ≥1 OTA on a scheduled nightly job. _(BG-3)_
- **FR-IMPORT-2 (Must):** Normalize provider fields to Atlas schema; record provenance (provider, provider_tour_id, fetched_at).
- **FR-IMPORT-3 (Must):** Update prices/availability; soft-delete tours no longer returned.
- **FR-IMPORT-4 (Must):** Log failed imports; make them re-runnable from Admin.
- **FR-IMPORT-5 (Should):** Deduplicate near-identical tours into a canonical Experience.

## 2.6 CMS, Admin, Auth
- **FR-CMS-1 (Must):** Editors approve/reject imported tours and edit enrichment before publishing.
- **FR-CMS-2 (Must):** Editors create/publish/schedule Guides and Collections with SEO metadata.
- **FR-ADMIN-1 (Must):** Admins view import logs, failed jobs, click/revenue analytics, and re-run imports.
- **FR-ADMIN-2 (Must):** Admin access is role-gated ([§14.3](#143-authorization-model-rbac)).
- **FR-AUTH-1 (Must):** Admin/editor auth via email+password, JWT sessions, RBAC.
- **FR-AUTH-2 (Should):** Public users may create accounts to persist collections.
- **FR-AUTH-3 (Should):** OAuth (Google) for public accounts.

## 2.7 Affiliate, Analytics, SEO
- **FR-AFF-1 (Must):** Every affiliate CTA routes through `/go/:tourId`, which logs the click **before** a 302 to the provider deep link. _(BG-2)_
- **FR-AFF-2 (Must):** Build provider-correct deep links with configured affiliate ID.
- **FR-AFF-3 (Should):** Broken/expired links fall back to provider search + flag for review.
- **FR-ANALYTICS-1 (Must):** Record page views, searches (incl. zero-result), filter usage, pin clicks, affiliate clicks as structured events.
- **FR-SEO-1 (Must):** Emit canonical URLs, meta, OG, Schema.org for all indexable pages; maintain auto-generated XML sitemap. _(BG-1)_

## 2.8 Non-goals (functional)
- **FR-NG-1:** No booking/payment/cancellation/refund/support flows; all → OTA.
- **FR-NG-2:** No availability guarantee beyond the last imported (timestamped, disclaimed) snapshot.

---

# 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-PERF-1 | API read P95 < 200 ms (cached) / < 500 ms (uncached) |
| NFR-PERF-2 | Search/autocomplete P95 < 150 ms |
| NFR-PERF-3 | Destination LCP < 2.5 s (P75 mobile 4G); CLS < 0.1; INP < 200 ms |
| NFR-PERF-4 | Affiliate redirect < 200 ms server time |
| NFR-PERF-5 | Nightly full import < 2 h/provider (50k tours) |
| NFR-AVAIL-1 | API availability 99.5% (v1); error budget tracked |
| NFR-SEC-1 | OWASP Top-10 controls; secrets never in repo; IPs hashed |
| NFR-A11Y-1 | Public pages WCAG 2.1 AA |
| NFR-SCALE-1 | Modular monolith; modules extractable to services without data-layer coupling |

---

# 4. API Specification

## 4.1 Conventions
- **Base:** `https://api.<domain>/v1` · JSON · UTF-8 · `snake_case`.
- **Auth:** public reads unauthenticated + rate-limited; admin/write require `Authorization: Bearer <JWT>`.
- **Pagination:** cursor — `?limit=` (default 20, max 100) + `?cursor=`; `{ data, page_info:{ next_cursor, has_next } }`.
- **Errors:** RFC 9457 Problem Details.
- **Versioning:** URL (`/v1`). **Idempotency:** mutating admin endpoints accept `Idempotency-Key`.

## 4.2 Error codes
`400` bad params · `401` no/invalid JWT · `403` role · `404` unknown · `409` conflict/idempotency · `422` validation · `429` rate limit (+`Retry-After`) · `500` unhandled · `503` dependency down.

## 4.3 Public endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/destinations` | List countries/cities (`type`, `q`) |
| GET | `/destinations/:country` | Country + cities |
| GET | `/destinations/:country/:city` | City detail (`include=experiences,map`) |
| GET | `/experiences` | Browse (`city,category,tag,price_band,min_rating,sort`) |
| GET | `/experiences/:slug` | Experience detail (aggregated tours) |
| GET | `/tours/:slug` | Tour detail |
| GET | `/search` | Unified search (`q`, filters, `bbox`, `near`, `sort`) |
| GET | `/search/autocomplete` | Typeahead |
| GET | `/recommendations` | Similar / best-for |
| GET | `/map/experiences` | Geo pins (`bbox` required, filters, `zoom`) |
| GET | `/collections[/:slug]` | Collections |
| GET | `/guides[/:slug]` | Guides |
| GET | `/go/:tourId` | **Affiliate redirect** (log → 302) |

**Example `GET /map/experiences?bbox=2.2,48.8,2.5,48.9&category=food`:**
```json
{ "data":[{"id":"exp_123","lat":48.86,"lng":2.3376,"category":"food","price_band":"$$","editor_rating":4.4,"cluster":false}],
  "page_info":{"has_next":false} }
```
**`GET /go/:tourId`:** writes `affiliate_click`, then `302 Location: https://www.viator.com/tours/…?pid=<AFFILIATE_ID>`, `Cache-Control: no-store`, no body.

## 4.4 Admin / write endpoints (JWT + role)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` · `/auth/refresh` | JWT issue / rotate |
| POST | `/imports/run` · GET `/imports[/:id]` · POST `/imports/:id/retry` | Import control |
| GET | `/admin/tours` · PATCH `/tours/:id` · DELETE `/tours/:id` | Moderation |
| POST/PATCH | `/experiences[/:id]` | Curate/dedupe |
| POST/PATCH | `/collections[/:id]` · `/guides[/:id]` | CMS |
| GET | `/admin/analytics/*` | Clicks, revenue, funnels |
| GET/POST | `/admin/affiliates` | Provider config + link health |

## 4.5 Rate limits & auth
- Public 60/min/IP (burst 120); `/search` 30/min; autocomplete 120/min; admin 600/min/token.
- Access JWT 15-min TTL (`sub`, `role`, `jti`); refresh httpOnly 7-day, rotated on use, `jti` denylist. Roles: `admin`, `editor`, `viewer`.

---

# 5. Backend Services

v1.0 = **modular monolith (NestJS)** with clean module boundaries for later extraction. Modules communicate via typed application-service interfaces, **never** by reaching into each other's tables.

| Module | Responsibility | Extract early? |
|--------|----------------|----------------|
| Destination | Country/City, city pages, featuring | Later |
| Experience | Concept, enrichment, publish lifecycle | Later |
| Tour | Records, price/availability snapshots | Later |
| **Search** | Index sync + query | **Yes** |
| Recommendation | Similar/best-for | Later |
| **Import** | Fetch, normalize, dedupe, upsert (workers+queue) | **Yes** |
| SEO | Sitemaps, metadata, structured data | Module |
| Analytics | Event ingest + aggregation | Later |
| Auth | Login, JWT, RBAC | Module |
| CMS | Guides, collections, workflow | Module |
| Maps | Geo queries, clustering, routing | Module |
| Image | Ingest/attribute/transform → CDN | Module |
| Affiliate | Deep-links, click logging, link health | Module |
| Observability | Logs, tracing, metrics | Cross-cutting |
| Notification | Ops alerts | Later |

---

# 6. Data Pipeline

Nightly (and on-demand) ingestion — the backend's most interesting subsystem.

```
OTA APIs → Import Workers (queue) → Normalizer → Validator → Enrichment
        → Deduplication → PostgreSQL (upsert + soft-delete) → Search Index → Cache invalidate → Frontend
```

## 6.1 Stages
1. **Fetch** — paged, rate-limited, ETag/If-Modified-Since; raw payloads to object storage (`raw/{provider}/{date}/{page}.json`) for replay.
2. **Normalize** — provider → Atlas fields; record `provider`, `provider_tour_id`, `fetched_at`, `source_hash`.
3. **Validate** — reject/quarantine missing title/geo/price, bad coords, non-positive price; quarantine surfaced in Admin.
4. **Enrich** — categories/tags (rules + optional LLM), walking distance from center, best-season, AI summary (queued, human-approved before publish).
5. **Deduplicate** — cluster by geo proximity + title similarity + provider → assign canonical Experience (deterministic + reviewable).
6. **Upsert** — idempotent by `(provider, provider_tour_id)`; update snapshots; soft-delete absent tours.
7. **Index** — push changed docs to search engine; remove deleted.
8. **Invalidate** — bust Redis keys for affected cities/experiences; regenerate affected sitemap shards.

## 6.2 Safety
- Each run = `import_run` record with `status`, `counts`, timestamps, `cursor`.
- Runs are **resumable** (persisted cursor) and **replayable** (from raw payloads).
- A run that would soft-delete > X% of a provider's catalogue **aborts and alerts** (guards against upstream errors wiping data).

## 6.3 Scheduling
Cron nightly full sync per provider (staggered); hourly light price/availability sync for featured (Should). All work goes through the queue; no synchronous bulk imports.

---

# 7. Database Design

**PostgreSQL 16 + PostGIS + `pg_trgm`.** ORM: Prisma/TypeORM. Migrations versioned, forward-only in prod.

## 7.1 Conventions
Plural `snake_case` tables · ULID/uuid `id` · `created_at`/`updated_at`/`deleted_at` (soft delete) · money as integer minor units + `currency` · every FK/slug indexed · junction tables `a_b`.

## 7.2 Core tables (abridged)
```sql
CREATE TABLE cities (
  id text PRIMARY KEY, country_id text NOT NULL REFERENCES countries(id),
  slug text NOT NULL, name text NOT NULL, summary text, hero_image_id text,
  geom geography(Point,4326) NOT NULL, bbox geography(Polygon,4326),
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  UNIQUE (country_id, slug));
CREATE INDEX cities_geom_gix ON cities USING gist (geom);

CREATE TABLE experiences (
  id text PRIMARY KEY, city_id text NOT NULL REFERENCES cities(id),
  slug text NOT NULL, title text NOT NULL, summary text, ai_summary text,
  editor_rating numeric(2,1), price_band text CHECK (price_band IN ('free','$','$$','$$$')),
  walking_distance_center_m integer, best_months int[], is_hidden_gem boolean DEFAULT false,
  difficulty text, family_suitability text, solo_suitability text, typical_duration_min integer,
  geom geography(Point,4326) NOT NULL, status text DEFAULT 'draft', is_featured boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  UNIQUE (city_id, slug));
CREATE INDEX experiences_geom_gix ON experiences USING gist (geom);
CREATE INDEX experiences_title_trgm ON experiences USING gin (title gin_trgm_ops);

CREATE TABLE tours (
  id text PRIMARY KEY, experience_id text REFERENCES experiences(id),
  provider_id text NOT NULL REFERENCES providers(id), provider_tour_id text NOT NULL,
  slug text NOT NULL, title text NOT NULL, description text, duration_min integer,
  rating_avg numeric(2,1), rating_count integer, price_minor integer, currency char(3),
  affiliate_url text, geom geography(Point,4326), source_hash text, fetched_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  UNIQUE (provider_id, provider_tour_id));

CREATE TABLE affiliate_clicks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tour_id text NOT NULL, provider_id text NOT NULL,
  session_id text, referrer text, user_agent text, ip_hash text, created_at timestamptz DEFAULT now());
CREATE INDEX affiliate_clicks_created_idx ON affiliate_clicks (created_at);

CREATE TABLE import_runs (
  id text PRIMARY KEY, provider_id text NOT NULL, status text NOT NULL,
  counts jsonb DEFAULT '{}', cursor jsonb, error text,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz DEFAULT now());

CREATE TABLE users (
  id text PRIMARY KEY, email citext UNIQUE NOT NULL, password_hash text,
  role text NOT NULL DEFAULT 'viewer', created_at timestamptz DEFAULT now());
```
Full DDL (categories, tags, junctions, images, guides, collections): [MPS §12.2](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md#12-database-design).

## 7.3 Indexing
GiST on all `geography`; GIN+`pg_trgm` on searchable text; B-tree on FKs/slugs/`status`/`is_featured`/time; partial index on `experiences(city_id) WHERE status='published' AND deleted_at IS NULL`.

## 7.4 Migrations / soft delete
Forward-only, CI-run on ephemeral DB, expand/contract for zero-downtime. All reads filter `deleted_at`. Future `tour_price_history` for snapshots.

---

# 8. Search Architecture

- **Phase A (MVP):** Postgres FTS + `pg_trgm` — no extra infra.
- **Phase B:** **Meilisearch** (DX) or **Typesense** (typo + geo). Elasticsearch only if scale demands.
- **Capabilities:** autocomplete (prefix + typo), fuzzy + synonyms, geo/near, faceted filters.
- **Ranking:** `text_relevance·w1 + editor_rating·w2 + popularity(clicks)·w3 + featured_boost + freshness`; featured content can pin above organic. Zero-result queries logged → content/tag gaps.
- **Index sync:** import pushes changed docs; nightly reconciliation verifies index ⇄ DB parity.

---

# 9. Maps Architecture

The map is a **query interface**, not decoration.

> **Direction update (see [docs/11](11-map-and-planner-direction.md)).** The map is now
> **3D-first** (Google Photorealistic 3D), **scoped to a curation** (a destination or a single
> curated tour), rendered **client-side from our own `lat`/`lng`** and **loaded on interaction**
> (Map Tiles cost + CWV — amplifies TD-7). The bbox/PostGIS, backend-driven, 2D-**clustered**
> map described below is **deferred**, not dropped: it becomes the **Full-Access-era** discovery
> surface for `/search` and cross-city browse (`Map3DElement` has no clustering primitive, and
> the backend it needs does not exist at Basic Access — TD-11).

- **Stack:** Google Maps JS API (base + globe/places) behind a `MapProvider` interface (MapLibre/Mapbox swappable). Client requests pins via `GET /map/experiences?bbox=…&filters` — **viewport drives the geo query**.
- **Features:** markers styled by category/price; clustering by zoom; pin→card (no reload); nearby attractions/restaurants; walking radius/isochrone; itinerary routes; heat map; bbox→query; GeoJSON layers. (FR-MAP-1…5)
- **Performance:** bbox-bounded + capped pin queries (cluster server-side beyond N); debounced pan/zoom; Redis cache by (bbox-grid, filter-hash); Maps key restricted by referrer + quota/alerts (cost — TD-7).
- **Trip Planner:** add stops → server orders (nearest-neighbor v1) → route + walking segments → per-stop affiliate CTA.

---

# 10. Affiliate Engine

Commercial core: **monetize the click, not the booking.**

```
User → CTA → GET /go/:tourId → INSERT affiliate_click → build deep link (affiliate ID) → 302 (no-store) → OTA checkout → OTA network attributes commission
```

- **AffiliateProvider config:** partner ID, deep-link template, tracking params, commission rate.
- **Deep-link builder:** provider-correct URLs (FR-AFF-2), validated against provider spec.
- **Click logging:** append-only `affiliate_clicks`, written **before** redirect (FR-AFF-1).
- **Redirect:** `/go/:tourId`, `noindex`, < 200 ms (NFR-PERF-4).
- **Attribution:** reconcile OTA network reports (CSV/API) into `affiliate_earnings` (future) for revenue analytics; we can't see actual bookings, so commission is estimated then confirmed.
- **Fallback:** missing/expired URL → provider search + flag (FR-AFF-3). Scheduled link-health job pings a sample.
- **Compliance:** clear affiliate disclosure on all CTA pages + `/legal/affiliate-disclosure`; respect OTA program terms (no cloaking beyond standard `/go`).

---

# 11. SEO Architecture

Primary acquisition channel (BG-1). Two products: interactive map (users) + thousands of destination pages (Google).

- **URLs:** clean hierarchy; one canonical per concept; filter states `rel=canonical` to base or `noindex` for thin combos; stable slugs (301 on change).
- **Programmatic SEO:** generate from structured data — destination pages, intent pages ("Things to do in {city}", "{category} in {city}", "Best {tag} in {city}", "Best time to visit {city}"), collections. Unique substantive content per page (data + AI summary + editorial).
- **Structured data (JSON-LD):** `TouristAttraction`/`TouristTrip`, `Product`+`Offer`, `AggregateRating`, `BreadcrumbList`, `ItemList`, `Article`, `Organization`, `WebSite`+`SearchAction`; validated in CI.
- **On-page:** semantic HTML, single `h1`, templated+editable meta, OG/Twitter cards, topical internal linking, enrichment-derived `alt`, lazy CDN images.
- **Technical:** SSR/SSG (crawlable without JS); auto-generated sharded `sitemap.xml`; `robots.txt` disallows `/go/*`, `/admin/*`, filter noise; CWV budgets; hreflang reserved for future localization.
- **Content governance:** programmatic pages must clear a quality gate (min words, unique summary, ≥1 image, ≥3 experiences) before indexing; else `noindex`.

---

# 12. AI Content Generation

Human-in-the-loop by design.

- **Uses:** destination/experience summaries, seasonal notes, tag/category suggestions, dedup similarity assist, quality scoring.
- **Guardrails:** **human approval before publish** (FR-CMS-1); AI content stored as drafts (`ai_summary`, `status='enriched'`) until promoted; provenance recorded (model, prompt version, generated_at); batched/queued/rate-limited with cost alerts; prompts constrained to provided structured data (never fabricate prices/availability).
- **Model choice:** provider-agnostic `LLMProvider` interface; latest capable model for user-facing content, cheaper/faster model for high-volume assistive tasks; prompt versions tracked for reproducibility.

---

# 13. CMS & Admin

## 13.1 CMS (Editor P-10)
Tour moderation (approve/reject/edit) · experience enrichment + merge/dedupe + canonical · guides (markdown + embedded cards/map anchors + SEO fields) · collections (build/order/feature) · media (upload/attribute/hero) · scheduling · featured content. Workflow `draft → in_review → scheduled → published → updated → archived`, fully audited; publish triggers cache invalidation + sitemap regen.

## 13.2 Admin dashboard (`admin.<domain>`, noindex, auth-gated)
Overview KPIs · Imports (runs, logs, failed jobs, **re-run**, quarantine) · Tours moderation · Experiences dedupe · Analytics (clicks, top items, search terms incl. zero-result, funnels, CTR) · Affiliates (config, link health, est vs confirmed commission) · Content · Users/roles · Settings (API keys write-only, feature flags). Destructive actions confirm + audit-log.

---

# 14. Security

## 14.1 Authentication
Argon2id (or bcrypt ≥12) password hashing · JWT access (15 min) + rotating refresh (httpOnly, secure, sameSite) with `jti` denylist · OAuth Google for public accounts (Should).

## 14.2 Sessions/tokens
Access in memory/httpOnly cookie; refresh always httpOnly; CSRF protection on cookie flows.

## 14.3 Authorization model (RBAC)
| Role | Can |
|------|-----|
| `admin` | Everything incl. users, settings, API keys |
| `editor` | Content: approve tours, enrich, publish; no users/settings |
| `viewer` | Read-only admin/analytics |
Enforced at API layer via guards/decorators; never trust the client; object-level checks where needed.

## 14.4 AppSec
Input validation on every endpoint (DTO + param allowlist, reject unknown fields) · parameterized queries only (SQLi) · output encoding + sanitized markdown + strict CSP (XSS) · CSRF · SSRF (import fetch restricted to known hosts) · rate limiting + login throttling/lockout · CORS allowlist.

## 14.5 Secrets & privacy
All secrets in env/secret manager, never in repo; `.env.example` documents vars; Maps key referrer-restricted; OTA/LLM keys server-side only. **No raw IPs** (hash to `ip_hash`); minimal PII; cookie consent gating analytics/affiliate cookies; data-deletion path (future).

## 14.6 Monitoring/response
Alerts on auth-failure spikes, rate-limit hits, anomalous import deletions; Dependabot/`npm audit` in CI with a critical-patch policy.

---

# 15. Performance

Budgets in [§3](#3-non-functional-requirements). Techniques:
- **Cache (Redis):** hot destination/experience payloads, map bbox tiles (grid+filter hash), popular search results; explicit invalidation on publish/import.
- **CDN:** static + images (Cloudflare/Vercel/image CDN); never serve images from the app.
- **Rendering:** SSG for stable pages (revalidate on publish); SSR for search/map; minimal hydration.
- **Pagination/lazy:** cursor pagination; lazy images; per-viewport pin loading.
- **Images:** responsive sizes, AVIF/WebP, explicit dimensions (CLS).
- **Compression:** gzip/brotli, HTTP/2.
- **DB:** proper indexes, batched loaders (no N+1), read replicas later.

---

# 16. Infrastructure

| Layer | Choice |
|-------|--------|
| Frontend | Next.js (React), Vercel |
| Backend | NestJS modular monolith (TS) |
| Database | PostgreSQL 16 + PostGIS (Neon/RDS/Supabase) |
| Cache/Queue | Redis + BullMQ |
| Search | Postgres FTS → Meilisearch/Typesense |
| Object storage | S3-compatible (R2/S3) |
| CDN | Cloudflare/Vercel/image CDN |
| Maps | Google Maps JS API (abstracted) |
| Container/CI | Docker + GitHub Actions |
| Monitoring | Sentry + logs + uptime |

**Environments:** local (Docker Compose) · preview (per-PR) · staging · production; config via env vars only.
**Deploy:** frontend → Vercel; backend + workers → container platform; migrations gated in CI/CD before rollout (expand/contract); rolling/blue-green with auto-rollback on health-check failure.

**Topology**
```
[Browser]→[CDN]→[Next.js]→[NestJS API]→┬→[Postgres+PostGIS]
                                        ├→[Redis]
                                        ├→[Search]
                                        └→[Object storage]
[Scheduler]→[Queue(Redis)]→[Import Workers]→[OTA APIs] + DB/Search writes
```

---

# 17. Observability

- **Logging:** structured JSON with correlation/request IDs; no PII/secrets; every line actionable.
- **Tracing:** OpenTelemetry across API → DB/queue/search; spans on import stages.
- **Metrics:** API latency/error rates, import durations/counts, queue depth/lag, cache hit ratio, search latency, affiliate click volume, CWV (RUM).
- **Health/alerts:** `/health` (liveness), `/ready` (DB/Redis/search readiness); **Sentry** error reporting (org standard, issue URLs in triage); alerts on import failure/abort, soft-delete guard trip, auth-failure spikes, SLO breach, LLM/Maps cost thresholds.
- **SLOs:** API availability 99.5%; import success ≥ 99% of scheduled runs.

---

# 18. Technical Debt Register

| ID | Item | Rationale | Revisit |
|----|------|-----------|---------|
| TD-1 | Postgres FTS not dedicated search | Avoid infra early | M6 |
| TD-2 | Modular monolith not microservices | Faster learning/iteration | Post-V2 |
| TD-3 | Anonymous collections in local storage | Ship saving without auth | M7 |
| TD-4 | Rule-based enrichment before LLM | Cost/quality control | M8 |
| TD-5 | Single OTA at launch | Reduce integration surface | V1 |
| TD-6 | Estimated commission (no booking visibility) | We don't own checkout | OTA reporting API |
| TD-7 | **Google Maps cost exposure** (amplified by 3D photoreal / Map Tiles — [docs/11](11-map-and-planner-direction.md)) | Moat feature | Load 3D map **on interaction** only + caching (M6) + key restrictions + budget alerts **now** |
| TD-8 | No UGC reviews | Scope control | Post-V2 |
| TD-9 | No multi-language | Focus | V3 (hreflang reserved) |
| TD-10 | Nearby-restaurants data/cost risk | Places cost | Spike in M3 |
| TD-11 | No backend/DB yet; frontend fetches & caches Viator data directly (Next.js ISR / build-time enrichment) | Basic Access lacks bulk ingestion (`/products/modified-since`), so a backend had nothing to manage — FR-IMPORT-1/2 deferred | Full Access approval |
| TD-12 | AI trip-planner may surface **unvetted** place suggestions for uncovered cities ([docs/11](11-map-and-planner-direction.md)) | Planner UX beyond curated coverage; the moat is trust (BG-3, §7.3) | **Provenance wall required** (distinct marker/label, no affiliate CTA) before M8 planner ships; uncovered cities logged as curation demand signal |

> **Commercial↔learning tension:** M6 concepts (queues/cache/search) are learning-motivated but also needed by M3–M5 traffic. Land map/search caching no later than the SEO ramp (M5) to control Maps cost (TD-7).

---

# 19. Technical Glossary

- **SSR/SSG** — Server-Side Rendering / Static Site Generation.
- **PostGIS** — geospatial extension for PostgreSQL.
- **bbox** — bounding box; map viewport as a rectangle used to query pins.
- **Deep link** — provider URL with affiliate params landing on the specific tour.
- **Idempotent upsert** — safe insert-or-update keyed on `(provider, provider_tour_id)`.
- **Soft delete** — mark `deleted_at` instead of removing a row.
- **RBAC / JWT** — Role-Based Access Control / JSON Web Token.
- **Queue/Worker** — async job processing (BullMQ) for imports/enrichment.
- **CWV** — Core Web Vitals (LCP/CLS/INP). **JSON-LD** — structured-data format for Schema.org.

_Business glossary in [Product Bible §9](01-product-bible.md#9-business-glossary)._

---

# 20. Appendices

## A. ER Diagram (textual)
```
Country 1─* City 1─* Experience 1─* Tour *─1 Provider
                        │               ├─1 Price(snapshot)
                        │               ├─1 Availability(snapshot)
                        │               └─1 AffiliateLink
                        ├─* ExperienceCategory *─1 Category
                        ├─* ExperienceTag *─1 Tag
                        ├─* Image
                        ├─1 Location(geom)
                        └─* Review
Collection *─* Experience     Guide *─1 Author
Itinerary 1─* Stop *─1 Experience;  Stop *─1 Route
Provider 1─1 AffiliateProvider      Tour 1─* AffiliateClick
ImportRun 1─* (touches) Tour        User(admin|editor|viewer)
```

## B. Sequence — Affiliate Redirect
```
User→Frontend: click CTA
Frontend→API: GET /go/:tourId
API→DB: INSERT affiliate_click
API→Frontend: 302 Location (deep link + affiliate ID)
Frontend→OTA: redirect → checkout
```

## C. Sequence — Nightly Import
```
Scheduler→Queue→Worker→OTA API→Normalize→Validate→Enrich→Dedup→Upsert(DB)→Index(Search)→Invalidate(Cache)→Alert(if guard tripped)
```

## D. Four-systems architecture
```
OTA APIs → [Data Ingestion: workers/queue/normalize/dedup]
        → [PostgreSQL+PostGIS: the curated product / moat]
        → [NestJS API: auth/search/filter/maps/affiliate]
        → [Next.js + Maps: consumer of YOUR API only] → User
```

## E. Open technical questions
1. Launch OTA: Viator or GetYourGuide? (program approval + API access — blocks M1)
2. Google Maps vs Mapbox/MapLibre at scale? (abstract now; decide by M3 — TD-7)
3. Meilisearch vs Typesense at M6? (Typesense favored: geo + typo tolerance)
4. Public accounts at M7: email/password + Google OAuth, or Google-only?
5. Nearby-restaurants source/cost: Google Places vs OSM? (spike M3 — TD-10)

---
_End of System Architecture Specification v1.0._
