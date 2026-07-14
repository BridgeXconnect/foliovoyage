# Travel Affiliate Platform — Master Product Specification

**Version:** 1.0
**Status:** Draft — Source of Truth
**Document Owner:** Roy Mkhabela
**Last Updated:** 2026-07-05
**Codename:** _Atlas_ (working title)

---

## About This Document

This is the **Master Product Specification (MPS)** — the single source of truth for the Travel Affiliate Platform. It is written for **spec-driven development**: every Roadmap item, Milestone, Epic, User Story, Technical Spec, Task, GitHub Issue, and Pull Request derives from this document and nothing bypasses it.

```
Master Product Specification
          │
          ▼
    Product Roadmap
          │
          ▼
      Milestones
          │
          ▼
        Epics
          │
          ▼
    User Stories
          │
          ▼
    Technical Specs
          │
          ▼
    Tasks / Subtasks
          │
          ▼
     GitHub Issues
          │
          ▼
    Pull Requests
```

**Authoring principles.** Every requirement in this document must be:

- **Unambiguous** — exactly one reasonable interpretation.
- **Testable** — you can verify whether it is implemented.
- **Traceable** — linked to a business goal upstream and to epics/stories downstream via a stable ID.
- **Versioned** — changes tracked over time in the Change Log.

**Requirement ID convention.** `FR-<area>-<n>` (functional), `NFR-<area>-<n>` (non-functional), `CON-<n>` (constraint), `ASM-<n>` (assumption). Areas: `SRCH`, `MAP`, `IMPORT`, `AFF`, `SEO`, `CMS`, `AUTH`, `ADMIN`, `DEST`, `ANALYTICS`. IDs are stable and never reused.

**Companion documents.** Per the "living documents" recommendation, this MPS is the umbrella. As the project matures, three derived living documents are maintained in `/docs`:

1. **Product Bible** — Vision, Business, UX, Roadmap (Sections 1–6, 26–27).
2. **System Architecture Specification** — Domain, APIs, services, data, infra, security (Sections 7–23).
3. **Engineering Specification** — Milestones, epics, stories, acceptance criteria (derived, not in this file).

Until those are split out, this document is authoritative for all of them.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision](#3-product-vision)
4. [User Personas](#4-user-personas)
5. [User Journeys](#5-user-journeys)
6. [Information Architecture](#6-information-architecture)
7. [Domain Model](#7-domain-model)
8. [Functional Requirements](#8-functional-requirements)
9. [API Specification](#9-api-specification)
10. [Backend Services](#10-backend-services)
11. [Data Pipeline](#11-data-pipeline)
12. [Database Design](#12-database-design)
13. [Search Architecture](#13-search-architecture)
14. [Maps Architecture](#14-maps-architecture)
15. [Affiliate Engine](#15-affiliate-engine)
16. [SEO Strategy](#16-seo-strategy)
17. [AI Content Generation](#17-ai-content-generation)
18. [CMS](#18-cms)
19. [Admin Dashboard](#19-admin-dashboard)
20. [Security](#20-security)
21. [Performance](#21-performance)
22. [Infrastructure](#22-infrastructure)
23. [Observability](#23-observability)
24. [Testing Strategy](#24-testing-strategy)
25. [Analytics](#25-analytics)
26. [Monetization](#26-monetization)
27. [Roadmap](#27-roadmap)
28. [Technical Debt Register](#28-technical-debt-register)
29. [Glossary](#29-glossary)
30. [Appendices](#30-appendices)

---

# 1. Executive Summary

## 1.1 Product Vision

> **Atlas is the world's most visually intuitive destination-discovery platform** — a data platform that happens to have a travel website on top.

We are **not** building a travel website. We are building a **curated travel data platform** whose primary consumer surface is a map-first discovery experience, and whose revenue derives from affiliate commissions on tours and experiences booked through Online Travel Agencies (OTAs).

## 1.2 Mission

Help travelers **discover and understand** what to do at a destination — spatially, seasonally, and by intent — better than an OTA listing page, a blog, or a Google search results page can.

## 1.3 Elevator Pitch

> OTAs like Viator and GetYourGuide have thousands of tours but list them as flat, undifferentiated grids. Blogs have opinion but no live pricing or availability. Google has links but no structure. **Atlas ingests OTA tour data, enriches it with editorial intelligence (ratings, tags, walking distance, best-time-to-go, hidden gems, AI summaries), and presents it on an interactive globe/map** so travelers explore a destination the way they'd explore it in real life. We don't handle bookings — we hand off to the OTA and earn commission.

## 1.4 Business Goals

| Goal ID | Goal | 12-Month Target |
|---------|------|-----------------|
| BG-1 | Establish organic SEO traffic as the primary acquisition channel | 25,000 organic sessions/month |
| BG-2 | Generate affiliate revenue | First $1,000 cumulative commission |
| BG-3 | Build a defensible enriched dataset ("the moat") | 50,000+ curated tours across 100+ cities |
| BG-4 | Serve as a portfolio-grade demonstration of full-system backend engineering | Public repo + live deploy + case study |

> **Note on dual intent.** This is simultaneously a **commercial product** and a **learning/portfolio project**. Where the two conflict, the spec flags the tradeoff explicitly (see [§28 Technical Debt Register](#28-technical-debt-register)). The architecture is intentionally allowed to grow from a modular monolith toward services so the builder learns each concept in context.

## 1.5 Long-Term Vision (3–5 years)

- Expand from tours/experiences into **complete AI-assisted itinerary planning** ("3 days in Rome" → optimized, mapped, walkable plan with booking links at each stop).
- Become the **canonical spatial index of "things to do"** — a place travelers start, not a place they pass through.
- Diversify monetization beyond single-OTA affiliate (multi-provider, hotels, insurance, sponsored placements).

## 1.6 Competitive Landscape

| Competitor | Strength | Weakness Atlas exploits |
|------------|----------|--------------------------|
| Viator / GetYourGuide (OTAs) | Inventory, booking, trust | Flat listings, no spatial/editorial intelligence, no cross-provider curation |
| TripAdvisor | Reviews, brand | Cluttered UX, ad-heavy, weak map-first discovery |
| Travel blogs / affiliate sites | SEO content, opinion | No live price/availability, no structured data, not interactive |
| Google Things-to-do | Distribution | No curation, no editorial voice, no persistence/personalization |
| Wanderlog / itinerary apps | Planning UX | Weak discovery/SEO surface, thinner commercial content |

## 1.7 Differentiators (The Moat)

1. **Enriched schema richer than the OTA** — editor ratings, intent tags, walking distance, best-season, hidden-gem flags, AI summaries. None of this exists in the source data.
2. **Map-as-a-query** — the map is not decoration; it is a spatial interface to the database (geo-search, clustering, nearby, walking radius, routes).
3. **Programmatic SEO at scale** — thousands of intent-targeted destination/experience pages generated from structured data.
4. **Cross-provider curation** — one Atlas "experience" can reconcile multiple OTA tours; the user sees the best option, we keep attribution.

---

# 2. Problem Statement

## 2.1 The traveler's core problem

Travelers researching "what to do" at a destination must stitch together fragmented sources: OTA listings for inventory, blogs for opinion, Google Maps for geography, and forums for hidden gems. No single surface answers *"What's genuinely worth doing here, where is it, when should I go, and how do I book it?"*

## 2.2 Problems with OTAs

- **Flat presentation** — tours are a sortable grid, not a spatial or intent-driven experience.
- **Duplication & noise** — the same landmark appears as dozens of near-identical listings.
- **No editorial trust** — sponsored ranking, not curated recommendation.
- **No cross-provider view** — you're locked into one marketplace's inventory.

## 2.3 Problems with blogs

- **Stale** — prices and availability drift; links rot.
- **Unstructured** — no filtering, no map, no comparison.
- **Unscalable** — human-written, so coverage is thin and inconsistent.

## 2.4 Problems with Google

- **Links, not answers** — the SERP is a routing layer, not a discovery layer.
- **No persistence** — you can't save, compare, or plan across sessions.
- **Volatile** — algorithm changes reshuffle discovery constantly.

## 2.5 Problems with trip planning

- **Spatial reasoning is manual** — travelers mentally map attractions to geography.
- **No intent lens** — "romantic," "family-friendly," "under $50," "sunset" aren't first-class filters anywhere.
- **Fragmented booking** — planning happens in one place, booking in another.

## 2.6 Why another travel site?

Because the opportunity is not "another listing site" — it's a **curated spatial data layer** over commodity OTA inventory. The value is in the enrichment and the map-first interface, both of which are structurally absent from incumbents. The affiliate model means we can launch without inventory, payments, or support obligations.

---

# 3. Product Vision

## 3.1 What the platform becomes

> **The world's most visually intuitive destination-discovery platform.**

A traveler lands on a destination and sees not a list but a **living map**: pins for every worthwhile experience, clustered and colored by category, filterable by intent and budget, each opening into a rich card with photos, editorial notes, nearby attractions, and a single affiliate CTA. From discovery they can build a **mapped, walkable itinerary**, and every booking action hands off cleanly to the OTA.

## 3.2 Product pillars

1. **Discovery is spatial.** The map is the primary interface, not a secondary tab.
2. **Data is curated, not mirrored.** We enrich, dedupe, and rank; we never just proxy the OTA.
3. **SEO is a product, not a growth hack.** Destination/experience pages are a first-class surface built for both humans and crawlers.
4. **We monetize the click, not the booking.** Zero booking/payment liability; commission on referral.

## 3.3 Explicit non-goals (v1.0)

- **No booking, payments, cancellations, refunds, or customer support.** All handed to the OTA. (See [§8.10](#810-explicit-non-goals-functional).)
- **No user-generated reviews at launch** (editorial + imported ratings only).
- **No native mobile app** (responsive web only).
- **No multi-currency checkout** — display conversion only; transactions occur on the OTA in its currency.

---

# 4. User Personas

Each persona lists **motivations**, **frustrations**, **goals**, and **jobs-to-be-done (JTBD)**. Personas drive [§5 User Journeys](#5-user-journeys) and prioritization.

### 4.1 Persona P-1: The Backpacker ("Sam")
- **Motivations:** Maximize experiences per dollar; authenticity over polish.
- **Frustrations:** OTA prices feel inflated; hard to find cheap/free gems.
- **Goals:** Find budget experiences and hidden gems near hostels.
- **JTBD:** "When I arrive somewhere new with little cash, I want to find cheap and free things to do nearby, so I can experience the place without overspending."

### 4.2 Persona P-2: The Luxury Traveler ("Vivian")
- **Motivations:** Curated, high-quality, time-efficient experiences.
- **Frustrations:** Sifting through low-quality listings; no taste signal.
- **Goals:** Premium tours, skip-the-line, private guides.
- **JTBD:** "When I plan a trip, I want a shortlist of the best-in-class experiences, so I don't waste my limited time on mediocre ones."

### 4.3 Persona P-3: The Family ("The Okafors")
- **Motivations:** Kid-appropriate, safe, logistically simple.
- **Frustrations:** Unclear age suitability; scattered logistics.
- **Goals:** Family-friendly activities grouped by area.
- **JTBD:** "When I travel with young kids, I want activities filtered for family suitability and grouped geographically, so we minimize transit and meltdowns."

### 4.4 Persona P-4: The Digital Nomad ("Deza")
- **Motivations:** Blend work and exploration over longer stays.
- **Frustrations:** Tourist-trap noise; wants local depth over weeks.
- **Goals:** Rotating weekend experiences; a saved, evolving list.
- **JTBD:** "When I stay somewhere for a month, I want to save and gradually work through the best experiences, so I explore deeply without planning it all upfront."

### 4.5 Persona P-5: The Solo Traveler ("Ravi")
- **Motivations:** Safety, social experiences, flexibility.
- **Frustrations:** Solo-suitability is opaque; group tours feel awkward.
- **Goals:** Social, safe, solo-friendly experiences.
- **JTBD:** "When I travel alone, I want experiences flagged as solo/social-friendly, so I meet people and stay safe."

### 4.6 Persona P-6: The Adventure Traveler ("Mara")
- **Motivations:** Adrenaline, nature, physical challenge.
- **Frustrations:** Difficulty/fitness level rarely specified.
- **Goals:** Filter by activity intensity and outdoor category.
- **JTBD:** "When I want a thrill, I want to filter by intensity and adventure type, so I book something that matches my fitness and appetite for risk."

### 4.7 Persona P-7: The Weekend Traveler ("Tom")
- **Motivations:** Short trips, high efficiency.
- **Frustrations:** Hard to plan a tight 48-hour itinerary.
- **Goals:** A ready-made 2-day plan for a city.
- **JTBD:** "When I have a weekend in a new city, I want a compact, mapped itinerary, so I see the highlights without research overhead."

### 4.8 Persona P-8: The Travel Researcher ("Nadia")
- **Motivations:** Deep pre-trip research; comparison.
- **Frustrations:** Comparing across sources is tedious.
- **Goals:** Compare tours, save collections, revisit.
- **JTBD:** "When I plan months ahead, I want to compare and save experiences into collections, so I can refine my plan over time."

### 4.9 Persona P-9: The Travel Blogger / Affiliate Partner ("Chris")
- **Motivations:** Content and referral revenue.
- **Frustrations:** Sourcing structured, linkable destination data.
- **Goals:** Reference Atlas pages; potential embeds/API.
- **JTBD:** "When I write travel content, I want a reliable structured source of curated experiences, so I can link/embed high-quality recommendations." *(Future: partner API — see [§27](#27-roadmap).)*

### 4.10 Internal Persona P-10: The Editor / Operator ("You")
- **Motivations:** Curate quality; grow the moat; monitor revenue.
- **Frustrations:** Raw imports are noisy; need approval + editing workflow.
- **Goals:** Approve tours, edit AI content, feature collections, watch import health and revenue.
- **JTBD:** "When new tours are imported, I want to review, enrich, and publish them from one dashboard, so the public dataset stays high-quality."

---

# 5. User Journeys

Journeys are documented as ordered steps with the **entry point**, **success outcome**, and **key requirements** referenced. Notation: `→` = user-visible step.

## 5.1 J-1: Discover a destination (organic search entry)
**Entry:** Google SERP → destination landing page (SEO).
`Land on /destinations/kyoto` → see hero + map + top experiences → filter by intent → open experience card → click affiliate CTA → OTA checkout.
**Success:** Affiliate click logged with attribution. **Refs:** FR-DEST-*, FR-SEO-*, FR-AFF-1.

## 5.2 J-2: Search
**Entry:** Global search bar.
`Type "family food tour rome"` → autocomplete suggests destination + intent → results page (list + map) → refine filters → open card → affiliate CTA.
**Success:** Relevant results < 300 ms; click logged. **Refs:** FR-SRCH-*.

## 5.3 J-3: Explore the map
**Entry:** Destination map or global globe.
`Open map` → pins cluster by zoom → click cluster → expand → click pin → card with nearby attractions/restaurants → similar experiences → affiliate CTA.
**Success:** Interactive exploration; pin→card→click funnel. **Refs:** FR-MAP-*.

## 5.4 J-4: Read a guide
**Entry:** SEO guide page ("Things to do in Kyoto").
`Read guide` → inline experience cards → map anchor → internal links to sub-topics → affiliate CTAs throughout.
**Success:** Dwell time + internal navigation + click. **Refs:** FR-SEO-*, FR-CMS-*.

## 5.5 J-5: Compare tours
**Entry:** Experience or search results.
`Select 2–4 tours` → comparison view (price, duration, rating, provider, inclusions) → choose → affiliate CTA.
**Success:** Comparison completed; click logged. **Refs:** FR-DEST-4.

## 5.6 J-6: Save an itinerary / collection
**Entry:** Any experience card (auth optional at v1 via local storage, account later).
`Click save` → add to collection/itinerary → view saved map → reorder → export/share.
**Success:** Persisted collection. **Refs:** FR-DEST-5, FR-AUTH-*.

## 5.7 J-7: Click affiliate → purchase
**Entry:** Affiliate CTA anywhere.
`Click CTA` → `/go/:tourId` redirect (click logged, deep link built) → OTA checkout → (commission attributed by OTA network).
**Success:** Redirect < 200 ms; click row written before redirect. **Refs:** FR-AFF-*, NFR-PERF-4.

## 5.8 J-8: Return later
**Entry:** Direct/email/bookmark.
`Return` → saved collections restored → "new since last visit" for saved destinations.
**Success:** Retention loop. **Refs:** FR-DEST-5, FR-ANALYTICS-*.

## 5.9 J-9 (internal): Curate imported tours
**Entry:** `admin.<domain>` login.
`Review import queue` → approve/reject → edit AI description/tags → feature → publish.
**Success:** Public dataset updated. **Refs:** FR-CMS-*, FR-ADMIN-*.

---

# 6. Information Architecture

## 6.1 Sitemap (public)

```
/                                   Home (globe + featured collections + search)
/destinations                       Destination index (countries → cities)
/destinations/:countrySlug          Country page
/destinations/:countrySlug/:citySlug City / destination page (map + experiences)
/experiences                        Experience index / browse
/experiences/:experienceSlug        Experience detail (aggregates tours)
/tours/:tourSlug                    Tour detail (single OTA offering)
/collections                        Curated collections index
/collections/:collectionSlug        Collection (e.g. "Best sunset spots in Santorini")
/guides                             Guides index
/guides/:guideSlug                  Editorial guide (SEO long-form)
/trip-planner                       Interactive itinerary builder
/search                             Search results (list + map)
/map                                Full-screen map / globe explorer
/go/:tourId                         Affiliate redirect (no index)
/about                              About / how it works / disclosure
/legal/*                            Privacy, terms, affiliate disclosure, cookies
/sitemap.xml, /robots.txt          SEO infra
```

## 6.2 Sitemap (admin / internal — `admin.<domain>`, noindex, auth-gated)

```
/admin                              Dashboard (KPIs, import health, revenue)
/admin/imports                      Import runs, logs, failed jobs, re-run
/admin/tours                        Tour moderation queue + editor
/admin/experiences                  Experience curation (merge/dedupe)
/admin/destinations                 Destination management + featuring
/admin/collections                  Collection builder
/admin/guides                       Guide/CMS editor
/admin/analytics                    Clicks, revenue, funnels, search terms
/admin/affiliates                   Provider config, link health, reporting
/admin/users                        Admin user & role management
/admin/settings                     API keys, feature flags, system config
```

## 6.3 Navigation model

- **Primary nav:** Destinations · Experiences · Collections · Guides · Trip Planner · Search · Map.
- **Persistent global search** in the header on all public pages.
- **Breadcrumbs** on all destination/experience/guide pages (also emitted as `BreadcrumbList` schema — see [§16](#16-seo-strategy)).
- **Map toggle** available on every destination and search page (list ⇄ map).

## 6.4 URL & slug rules

- Lowercase, hyphenated, ASCII-folded slugs. Stable once published (redirect on change).
- Canonical hierarchy: country → city → experience. Tours canonicalize to their parent experience where a dedupe cluster exists.
- Affiliate redirect paths (`/go/*`) are `noindex, nofollow` and excluded from sitemaps.

---

# 7. Domain Model

The domain model is the heart of the moat. It is deliberately **richer than the OTA source**.

## 7.1 Core entities

| Entity | Description | Key relationships |
|--------|-------------|-------------------|
| **Country** | Sovereign/territory grouping | has many Cities |
| **City** (Destination) | Primary discovery unit | belongs to Country; has many Experiences; has Location |
| **Experience** | **Atlas-curated concept** (e.g. "Eiffel Tower Summit Access") that may aggregate multiple provider Tours | belongs to City; has many Tours; has Categories, Tags, Images, Location |
| **Tour** | A **single bookable OTA offering** mapped to an Experience | belongs to Experience; has Provider, Price, Availability, AffiliateLink |
| **Provider** | OTA / affiliate source (Viator, GetYourGuide) | has many Tours; has AffiliateProvider config |
| **Category** | Taxonomy (Food, Adventure, Culture, Nightlife…) | many-to-many with Experience |
| **Tag** | Intent/attribute (romantic, family-friendly, hidden-gem, under-50, sunset) | many-to-many with Experience |
| **Review** | Rating (imported aggregate + editorial), no UGC at v1 | belongs to Experience/Tour |
| **Image** | Media asset (CDN-hosted, attributed) | belongs to Experience/Tour/City |
| **Route** | Ordered path (walking/itinerary) | references Locations |
| **Location** | Geospatial point/polygon (lat/lng, geohash, bbox) | referenced by City/Experience/Tour |
| **Currency** | ISO currency + FX snapshot | referenced by Price |
| **Language** | ISO language (content localization future) | referenced by Guide/Content |
| **Guide** | Editorial long-form SEO content | authored by Author; links Experiences |
| **Author** | Editorial identity (E-E-A-T signal) | writes Guides |
| **Collection** | Curated grouping (e.g. "Best of Rome") | many-to-many with Experience |
| **Itinerary** | User-built ordered plan | has many Stops (Experience + time + Route) |
| **MapLayer** | Rendering configuration for map (categories, heat, clusters) | references Experiences |
| **AffiliateProvider** | Commission/tracking config per Provider | one per Provider |
| **Price** | Amount + Currency + snapshot time | belongs to Tour |
| **Availability** | Availability window/status snapshot | belongs to Tour |
| **AffiliateClick** | Logged click event for attribution | references Tour, session |

## 7.2 Entity lifecycles

- **Tour:** `imported → normalized → deduped(→ linked to Experience) → pending_review → approved/rejected → published → (price/availability refreshed nightly) → stale/deleted (soft)`.
- **Experience:** `draft → enriched(AI+editorial) → published → featured? → archived`.
- **Guide:** `draft → in_review → scheduled → published → updated → archived`.
- **AffiliateClick:** append-only; never mutated.

## 7.3 Ownership & source-of-truth rules

- **OTA owns:** price, availability, booking, inclusions, cancellation policy (mirrored as snapshots, never authoritative).
- **Atlas owns:** Experience concept, categories, tags, editor rating, walking distance, best-season, hidden-gem flag, AI summary, curation status, slug, SEO metadata.
- **Dedupe authority:** the Import/Dedup service assigns a canonical Experience per cluster; a Tour may be re-linked but its `provider_tour_id` is immutable.

## 7.4 Enrichment attributes (the differentiators)

Stored on `Experience` (and cached where useful): `editor_rating (0–5)`, `intent_tags[]`, `walking_distance_from_center_m`, `best_months[]`, `is_hidden_gem`, `ai_summary`, `seasonal_notes`, `typical_duration_min`, `difficulty_level`, `family_suitability`, `solo_suitability`, `price_band (free|$|$$|$$$)`.

## 7.5 ER overview

See [§30 Appendix A](#a-er-diagram-textual) for the full textual ER diagram and [§12](#12-database-design) for physical schema.

---

# 8. Functional Requirements

Requirements use **MoSCoW** priority (Must/Should/Could/Won't-v1) and carry stable IDs. Each is unambiguous and testable.

## 8.1 Destination pages
- **FR-DEST-1 (Must):** The system shall render a destination page for every published City with hero media, intro, map, and a paginated list of published Experiences.
- **FR-DEST-2 (Must):** Destination pages shall be server-rendered (SSR/SSG) for crawlability and shall include structured data ([§16](#16-seo-strategy)).
- **FR-DEST-3 (Must):** Each Experience card shall show title, primary image, editor rating, price band, top categories/tags, and an affiliate CTA.
- **FR-DEST-4 (Should):** The system shall allow comparison of 2–4 selected Tours by price, duration, rating, provider, and inclusions.
- **FR-DEST-5 (Should):** Users shall save Experiences to a Collection/Itinerary, persisted anonymously (local + server-side once authenticated).

## 8.2 Search
- **FR-SRCH-1 (Must):** Global search shall accept free-text and return Experiences and Destinations ranked by relevance and popularity.
- **FR-SRCH-2 (Must):** Search shall support filters: category, intent tag, price band, duration, rating, family/solo suitability.
- **FR-SRCH-3 (Must):** Autocomplete shall suggest destinations, experiences, and intents within 150 ms P95.
- **FR-SRCH-4 (Should):** Search shall support fuzzy matching and synonyms ("kid-friendly" ≈ "family").
- **FR-SRCH-5 (Should):** Search shall support geo/"near me" and "near {landmark}" queries.
- **FR-SRCH-6 (Could):** Natural-intent search ("romantic under $50 at sunset").

## 8.3 Filters
- **FR-FILT-1 (Must):** Filters shall be composable, reflected in the URL (shareable/bookmarkable), and applied on both list and map views simultaneously.

## 8.4 Map
- **FR-MAP-1 (Must):** The map shall render pins for all Experiences matching the active filter, clustered by zoom level.
- **FR-MAP-2 (Must):** Clicking a pin shall open an Experience card without a full page reload.
- **FR-MAP-3 (Should):** The map shall show nearby attractions and (where data allows) nearby restaurants for a selected pin.
- **FR-MAP-4 (Should):** The map shall render a walking radius and, in Trip Planner, an ordered route between stops.
- **FR-MAP-5 (Could):** Heat-map layer of experience density/popularity.

## 8.5 Recommendations
- **FR-REC-1 (Should):** Each Experience shall list "similar experiences" (same city, shared categories/tags, comparable price band).
- **FR-REC-2 (Could):** "Best for {persona/intent}" and "Best in {month}" server-computed lists.

## 8.6 Reviews
- **FR-REV-1 (Must):** The system shall display imported aggregate ratings and review counts with clear provider attribution.
- **FR-REV-2 (Won't-v1):** User-generated reviews are out of scope for v1.0.

## 8.7 Import pipeline (functional surface)
- **FR-IMPORT-1 (Must):** The system shall import Tours from at least one OTA provider on a scheduled nightly job.
- **FR-IMPORT-2 (Must):** Imports shall normalize provider fields into the Atlas schema and record provenance (provider, provider_tour_id, fetched_at).
- **FR-IMPORT-3 (Must):** Imports shall update prices/availability and soft-delete tours no longer returned by the provider.
- **FR-IMPORT-4 (Must):** Failed imports shall be logged and re-runnable from the Admin dashboard.
- **FR-IMPORT-5 (Should):** Imports shall deduplicate near-identical tours into a canonical Experience.

## 8.8 CMS & Admin
- **FR-CMS-1 (Must):** Editors shall approve/reject imported tours and edit Experience enrichment fields before publishing.
- **FR-CMS-2 (Must):** Editors shall create/publish/schedule Guides and Collections with SEO metadata.
- **FR-ADMIN-1 (Must):** Admins shall view import logs, failed jobs, click/revenue analytics, and re-run imports.
- **FR-ADMIN-2 (Must):** Admin access shall be role-gated (see [§20](#20-security)).

## 8.9 Authentication
- **FR-AUTH-1 (Must):** Admin/editor auth shall use email+password with JWT sessions and role-based access control.
- **FR-AUTH-2 (Should):** Public users may create accounts to persist collections across devices.
- **FR-AUTH-3 (Should):** Support OAuth (Google) for public accounts.

## 8.10 Explicit non-goals (functional)
- **FR-NG-1:** No booking, payment, cancellation, refund, or support flows are built. All booking actions redirect to the OTA.
- **FR-NG-2:** No inventory or availability guarantees are made to the user beyond the last imported snapshot, which is timestamped and disclaimed.

## 8.11 Affiliate tracking (functional)
- **FR-AFF-1 (Must):** Every affiliate CTA shall route through `/go/:tourId`, which logs the click (tour, provider, session, referrer, timestamp) **before** issuing a 302 to the provider deep link with correct affiliate parameters.
- **FR-AFF-2 (Must):** The system shall build provider-correct deep links with the configured affiliate/partner ID.
- **FR-AFF-3 (Should):** Broken/expired affiliate links shall fall back to the Experience/provider search URL and be flagged for review.

## 8.12 Analytics & SEO (functional)
- **FR-ANALYTICS-1 (Must):** The system shall record page views, searches (incl. zero-result terms), filter usage, pin clicks, and affiliate clicks as structured events.
- **FR-SEO-1 (Must):** The system shall emit canonical URLs, meta tags, Open Graph, and Schema.org structured data for all indexable pages, and maintain an auto-generated XML sitemap.

---

# 9. API Specification

## 9.1 Conventions

- **Base URL:** `https://api.<domain>/v1`
- **Format:** JSON; UTF-8; `snake_case` fields.
- **Auth:** Public read endpoints are unauthenticated + rate-limited. Admin/write endpoints require `Authorization: Bearer <JWT>`.
- **Pagination:** cursor-based — `?limit=` (default 20, max 100) + `?cursor=`; responses include `{ data, page_info: { next_cursor, has_next } }`.
- **Filtering:** query params documented per endpoint; unknown params rejected with `400`.
- **Errors:** RFC 9457 Problem Details — `{ type, title, status, detail, instance, errors[] }`.
- **Versioning:** URL-versioned (`/v1`). Breaking changes → `/v2`.
- **Idempotency:** mutating admin endpoints accept `Idempotency-Key` header.

## 9.2 Standard error codes

| HTTP | Meaning | When |
|------|---------|------|
| 400 | Bad Request | Invalid params/body |
| 401 | Unauthorized | Missing/invalid JWT |
| 403 | Forbidden | Role lacks permission |
| 404 | Not Found | Unknown resource/slug |
| 409 | Conflict | Duplicate/idempotency clash |
| 422 | Unprocessable | Validation failed |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unhandled |
| 503 | Unavailable | Dependency (OTA/search) down |

## 9.3 Public endpoints

| Method | Path | Purpose | Key params |
|--------|------|---------|-----------|
| GET | `/destinations` | List countries/cities | `type=country\|city`, `q`, pagination |
| GET | `/destinations/:countrySlug` | Country detail + cities | — |
| GET | `/destinations/:countrySlug/:citySlug` | City detail | `include=experiences,map` |
| GET | `/experiences` | Browse experiences | `city`, `category`, `tag`, `price_band`, `min_rating`, `sort` |
| GET | `/experiences/:slug` | Experience detail (aggregated tours) | — |
| GET | `/tours/:slug` | Single tour detail | — |
| GET | `/search` | Unified search | `q`, filters, `bbox`, `near`, `sort`, pagination |
| GET | `/search/autocomplete` | Typeahead suggestions | `q` |
| GET | `/recommendations` | Similar / best-for | `experience_id` \| `city` \| `intent` \| `month` |
| GET | `/map/experiences` | Geo query for pins | `bbox` (required), filters, `zoom` |
| GET | `/collections` / `/collections/:slug` | Curated collections | — |
| GET | `/guides` / `/guides/:slug` | Editorial guides | — |
| GET | `/go/:tourId` | **Affiliate redirect** (logs click → 302) | — |

**Example — `GET /destinations/france/paris?include=experiences`:**
```json
{
  "data": {
    "id": "city_par", "slug": "paris", "name": "Paris",
    "country": { "slug": "france", "name": "France" },
    "location": { "lat": 48.8566, "lng": 2.3522, "bbox": [2.224,48.816,2.470,48.902] },
    "summary": "…", "hero_image_url": "https://cdn…/paris.jpg",
    "experience_count": 342,
    "experiences": [
      { "id":"exp_eiffel","slug":"eiffel-tower-summit","title":"Eiffel Tower Summit Access",
        "editor_rating":4.6,"price_band":"$$","tags":["landmark","romantic"],
        "primary_image_url":"https://cdn…/eiffel.jpg","tour_count":7 }
    ]
  },
  "page_info": { "next_cursor": "eyJvIjoyMH0", "has_next": true }
}
```

**Example — `GET /map/experiences?bbox=2.2,48.8,2.5,48.9&category=food`:**
```json
{ "data": [
  { "id":"exp_123","lat":48.8600,"lng":2.3376,"category":"food",
    "price_band":"$$","editor_rating":4.4,"cluster":false }
], "page_info": { "has_next": false } }
```

**Example — `GET /go/:tourId` behavior:** writes an `affiliate_click` row, then `302 Location: https://www.viator.com/tours/…?pid=<AFFILIATE_ID>&mcid=…`. No body. `Cache-Control: no-store`.

## 9.4 Admin / write endpoints (JWT + role)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` | Obtain JWT (email+password) |
| POST | `/auth/refresh` | Rotate access token |
| POST | `/imports/run` | Trigger import (enqueues job) |
| GET | `/imports` / `/imports/:id` | List/inspect import runs |
| POST | `/imports/:id/retry` | Re-run failed import |
| GET | `/admin/tours` | Moderation queue |
| PATCH | `/tours/:id` | Edit/approve/reject/enrich |
| DELETE | `/tours/:id` | Soft-delete |
| POST | `/experiences` / `PATCH /experiences/:id` | Curate experiences (merge/dedupe) |
| POST | `/collections` / `PATCH /collections/:id` | Manage collections |
| POST | `/guides` / `PATCH /guides/:id` | CMS guide authoring |
| GET | `/admin/analytics/*` | Clicks, revenue, funnels |
| GET/POST | `/admin/affiliates` | Provider config + link health |

## 9.5 Rate limits

- Public: 60 req/min/IP (burst 120), stricter on `/search` (30/min).
- Autocomplete: 120 req/min/IP.
- Admin: 600 req/min/token.
- `429` returns `Retry-After`.

## 9.6 Authentication detail

- Access token: JWT, 15-min TTL, `sub`, `role`, `jti`. Refresh token: httpOnly, 7-day, rotated on use, revocable via `jti` denylist.
- Roles: `admin`, `editor`, `viewer` (see [§20.3](#203-authorization-model)).

---

# 10. Backend Services

v1.0 ships as a **modular monolith** (NestJS) with clear module boundaries so services can later be extracted. Each "service" below is a bounded module/domain.

| Service / Module | Responsibility | Extractable to microservice? |
|------------------|----------------|------------------------------|
| **Destination Service** | Country/City CRUD, city pages, featuring | Later |
| **Experience Service** | Experience concept, enrichment fields, publish lifecycle | Later |
| **Tour Service** | Tour records, price/availability snapshots | Later |
| **Search Service** | Index sync + query (Postgres FTS → Meilisearch/Typesense) | **Yes (early)** |
| **Recommendation Service** | Similar/best-for computation | Later |
| **Import Service** | OTA fetch, normalize, dedupe, upsert (workers + queue) | **Yes (early)** |
| **SEO Service** | Sitemaps, metadata, structured data generation | Module |
| **Analytics Service** | Event ingestion + aggregation | **Yes (later)** |
| **Auth Service** | Login, JWT, RBAC | Module |
| **CMS Service** | Guides, collections, editorial workflow | Module |
| **Maps Service** | Geo queries, clustering, routing helpers | Module |
| **Image Service** | Ingest/attribute/transform media → CDN | Module |
| **Affiliate Service** | Deep-link building, click logging, link health | Module |
| **Logging/Observability** | Structured logs, tracing, metrics | Cross-cutting |
| **Notification Service** | Ops alerts (import failures, revenue milestones) | Later |

**Module contract rule:** modules communicate via typed application services (interfaces), never by reaching into each other's tables. This preserves the extraction path.

---

# 11. Data Pipeline

The ingestion pipeline is the backend's most interesting subsystem. It runs nightly (and on-demand via Admin).

```
   OTA APIs (Viator, GetYourGuide)
              │  (paged fetch, rate-limited)
              ▼
       Import Workers            ← queue-backed (BullMQ/Redis)
              │
              ▼
        Normalizer               ← provider fields → Atlas schema
              │
              ▼
        Validator                ← required fields, geo sanity, price sanity
              │
              ▼
        Enrichment               ← categories, tags, walking distance, best-season, AI summary
              │
              ▼
        Deduplication            ← cluster near-identical tours → canonical Experience
              │
              ▼
         PostgreSQL              ← upsert; soft-delete missing; provenance recorded
              │
              ▼
        Search Index             ← sync changed docs to Meilisearch/Typesense
              │
              ▼
           Cache                 ← invalidate affected keys (Redis)
              │
              ▼
          Frontend               ← reads fresh data
```

## 11.1 Pipeline stages (detailed)

1. **Fetch** — per-provider client with pagination, rate-limit backoff, ETag/If-Modified-Since where supported. Raw payloads stored to object storage for replay (`raw/{provider}/{date}/{page}.json`).
2. **Normalize** — map provider schema to Atlas `Tour` fields; record `provider`, `provider_tour_id`, `fetched_at`, `source_hash`.
3. **Validate** — reject/quarantine rows failing: missing title/geo/price, out-of-range coordinates, non-positive price. Quarantine surfaced in Admin.
4. **Enrich** — derive categories/tags (rules + optional LLM), compute walking distance from city center, infer best-season, generate AI summary (queued, human-approved before publish — see [§17](#17-ai-content-generation)).
5. **Deduplicate** — cluster by (geo proximity + title similarity + provider); assign/attach canonical `Experience`. Deterministic + reviewable.
6. **Upsert** — idempotent write by `(provider, provider_tour_id)`. Update price/availability snapshots. Soft-delete tours absent from this run (`deleted_at` set; retained for reporting).
7. **Index** — push changed Experience/Tour docs to the search engine; remove deleted.
8. **Invalidate** — bust Redis keys for affected cities/experiences; regenerate affected sitemap shards.

## 11.2 Idempotency & safety

- Every run has an `import_run` record: `status`, `provider`, `counts {fetched, created, updated, soft_deleted, quarantined, failed}`, `started_at`, `finished_at`.
- Runs are **resumable** (page cursor persisted) and **replayable** (from stored raw payloads).
- A run that would soft-delete > X% of a provider's catalogue **aborts and alerts** (guards against upstream API errors wiping data).

## 11.3 Scheduling

- Cron: nightly full sync per provider (staggered). Hourly light sync for price/availability of "featured" experiences (Should).
- All scheduled work goes through the queue; no synchronous bulk imports.

---

# 12. Database Design

**Engine:** PostgreSQL 16 with **PostGIS** (geo) and `pg_trgm` (fuzzy text). ORM: Prisma or TypeORM (NestJS). Migrations are versioned and forward-only in production.

## 12.1 Conventions

- Table names plural `snake_case`; PKs are `id` (`text`/ULID or `uuid`).
- Timestamps: `created_at`, `updated_at` (UTC), `deleted_at` (nullable → soft delete).
- Every FK indexed; every slug unique per parent scope.
- Money stored as integer minor units + `currency` code (never floats). FX snapshots separate.
- Naming: junction tables `a_b`. Enums via Postgres `enum` or lookup tables.

## 12.2 Core tables (abridged DDL)

```sql
CREATE TABLE countries (
  id          text PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  iso2        char(2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cities (
  id           text PRIMARY KEY,
  country_id   text NOT NULL REFERENCES countries(id),
  slug         text NOT NULL,
  name         text NOT NULL,
  summary      text,
  hero_image_id text,
  geom         geography(Point,4326) NOT NULL,
  bbox         geography(Polygon,4326),
  is_published boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (country_id, slug)
);
CREATE INDEX cities_geom_gix ON cities USING gist (geom);

CREATE TABLE experiences (
  id            text PRIMARY KEY,
  city_id       text NOT NULL REFERENCES cities(id),
  slug          text NOT NULL,
  title         text NOT NULL,
  summary       text,
  ai_summary    text,
  editor_rating numeric(2,1),           -- 0.0–5.0
  price_band    text CHECK (price_band IN ('free','$','$$','$$$')),
  walking_distance_center_m integer,
  best_months   int[] ,                 -- 1–12
  is_hidden_gem boolean NOT NULL DEFAULT false,
  difficulty    text,                   -- easy|moderate|hard
  family_suitability text,              -- low|medium|high
  solo_suitability   text,
  typical_duration_min integer,
  geom          geography(Point,4326) NOT NULL,
  status        text NOT NULL DEFAULT 'draft', -- draft|enriched|published|archived
  is_featured   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (city_id, slug)
);
CREATE INDEX experiences_geom_gix ON experiences USING gist (geom);
CREATE INDEX experiences_title_trgm ON experiences USING gin (title gin_trgm_ops);

CREATE TABLE providers (
  id    text PRIMARY KEY,
  slug  text UNIQUE NOT NULL,          -- viator|getyourguide
  name  text NOT NULL
);

CREATE TABLE tours (
  id               text PRIMARY KEY,
  experience_id    text REFERENCES experiences(id),
  provider_id      text NOT NULL REFERENCES providers(id),
  provider_tour_id text NOT NULL,
  slug             text NOT NULL,
  title            text NOT NULL,
  description      text,
  duration_min     integer,
  rating_avg       numeric(2,1),
  rating_count     integer,
  price_minor      integer,            -- snapshot
  currency         char(3),
  affiliate_url    text,
  geom             geography(Point,4326),
  source_hash      text,
  fetched_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (provider_id, provider_tour_id)
);

CREATE TABLE categories ( id text PRIMARY KEY, slug text UNIQUE, name text );
CREATE TABLE tags       ( id text PRIMARY KEY, slug text UNIQUE, name text, kind text );

CREATE TABLE experience_categories (
  experience_id text REFERENCES experiences(id),
  category_id   text REFERENCES categories(id),
  PRIMARY KEY (experience_id, category_id)
);
CREATE TABLE experience_tags (
  experience_id text REFERENCES experiences(id),
  tag_id        text REFERENCES tags(id),
  PRIMARY KEY (experience_id, tag_id)
);

CREATE TABLE images (
  id text PRIMARY KEY, url text NOT NULL, cdn_url text, alt text,
  attribution text, owner_type text, owner_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_clicks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tour_id      text NOT NULL,
  provider_id  text NOT NULL,
  session_id   text,
  referrer     text,
  user_agent   text,
  ip_hash      text,                   -- hashed, not raw IP (privacy)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_clicks_created_idx ON affiliate_clicks (created_at);
CREATE INDEX affiliate_clicks_tour_idx    ON affiliate_clicks (tour_id);

CREATE TABLE guides (
  id text PRIMARY KEY, slug text UNIQUE, title text, body_md text,
  author_id text, status text DEFAULT 'draft', published_at timestamptz,
  seo_title text, seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collections (
  id text PRIMARY KEY, slug text UNIQUE, title text, description text,
  is_featured boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE collection_experiences (
  collection_id text REFERENCES collections(id),
  experience_id text REFERENCES experiences(id),
  position integer,
  PRIMARY KEY (collection_id, experience_id)
);

CREATE TABLE import_runs (
  id text PRIMARY KEY, provider_id text NOT NULL,
  status text NOT NULL,                 -- queued|running|success|failed|aborted
  counts jsonb NOT NULL DEFAULT '{}',
  cursor jsonb, error text,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id text PRIMARY KEY, email citext UNIQUE NOT NULL, password_hash text,
  role text NOT NULL DEFAULT 'viewer',  -- admin|editor|viewer
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## 12.3 Indexing strategy

- **GiST** on all `geography` columns (map/geo queries).
- **GIN + `pg_trgm`** on searchable text (fuzzy fallback before dedicated search engine).
- B-tree on all FKs, slugs, `status`, `is_featured`, and time columns used in analytics.
- Partial index on `experiences (city_id) WHERE status='published' AND deleted_at IS NULL`.

## 12.4 Migrations, soft deletes, versioning

- Migrations are code-reviewed, forward-only, run in CI against an ephemeral DB.
- Soft delete everywhere via `deleted_at`; all read queries filter it out (repository base scope).
- Historical price/rating retained via periodic snapshots (future `tour_price_history`).

---

# 13. Search Architecture

## 13.1 Progressive strategy

- **Phase A (MVP):** Postgres FTS + `pg_trgm` for fuzzy matching. No extra infra.
- **Phase B:** Dedicated engine — **Meilisearch** (simplest DX) or **Typesense** (typo-tolerant, geo). Elasticsearch only if scale demands.

## 13.2 Capabilities

- **Autocomplete** on destinations, experiences, intents (prefix + typo tolerance).
- **Fuzzy matching** (`family` ≈ `kid-friendly` via synonym map).
- **Synonyms & intents** — curated synonym dictionary; intent tags are first-class facets.
- **Geo search** — "near me" / "near {landmark}" using bbox + radius (PostGIS or engine geo).
- **Faceted filtering** — category, tag, price band, rating, duration, suitability.

## 13.3 Ranking signals

Weighted score = `text_relevance × w1 + editor_rating × w2 + popularity(clicks) × w3 + featured_boost + freshness`. Featured/editorial content can pin above organic. Zero-result queries are logged (see [§25](#25-analytics)) to drive content/tag gaps.

## 13.4 Index sync

The Import pipeline pushes changed docs to the engine ([§11.1 step 7](#111-pipeline-stages-detailed)). A reconciliation job nightly verifies index ⇄ DB parity and repairs drift.

---

# 14. Maps Architecture

The map is a **query interface**, not decoration — this is a core differentiator (see [§1.7](#17-differentiators-the-moat)).

## 14.1 Rendering stack

- **Google Maps JavaScript API** for base map + globe/3D and place data (per user's stated moat idea). Abstract behind a `MapProvider` interface so MapLibre/Mapbox remain swappable.
- Client requests pins via `GET /map/experiences?bbox=…&filters` — **the map viewport drives a geo query**.

## 14.2 Features

| Feature | Description | Req |
|---------|-------------|-----|
| Markers | One per Experience, styled by category/price band | FR-MAP-1 |
| Clustering | Server- or client-side clustering by zoom | FR-MAP-1 |
| Cards | Click pin → Experience card (no reload) | FR-MAP-2 |
| Nearby | Nearby attractions/restaurants for a pin | FR-MAP-3 |
| Walking radius | Draw radius / isochrone around a point | FR-MAP-4 |
| Routes | Ordered route between itinerary stops | FR-MAP-4 |
| Heat map | Density/popularity layer | FR-MAP-5 |
| Bounding boxes | Viewport → bbox query param | FR-MAP-1 |
| GeoJSON | Server returns GeoJSON for layers | — |

## 14.3 Performance

- Pin queries are **bbox-bounded and capped** (max N pins; beyond that, cluster server-side).
- Tile/marker rendering debounced on pan/zoom; results cached in Redis by (bbox-grid, filter-hash).
- Google Maps API key restricted by HTTP referrer + usage quotas/alerts (cost control — see [§28](#28-technical-debt-register)).

## 14.4 Trip Planner integration

Trip Planner composes map + routes: user adds stops → server orders/optimizes (nearest-neighbor v1) → route + walking segments rendered → each stop retains its affiliate CTA. (See [§5.6](#56-j-6-save-an-itinerary--collection).)

---

# 15. Affiliate Engine

The commercial core. **We monetize the click, not the booking.**

## 15.1 Flow

```
User → Experience/Tour card → clicks CTA
     → GET /go/:tourId
          → write affiliate_click (tour, provider, session, referrer, ts)
          → build provider deep link with affiliate/partner ID
          → 302 redirect (no-store)
     → OTA checkout
     → OTA network attributes commission
```

## 15.2 Components

- **AffiliateProvider config** — per provider: partner/affiliate ID, deep-link template, tracking params, commission rate (for reporting estimates).
- **Deep-link builder** — constructs correct URL per provider (`FR-AFF-2`); validated against provider spec.
- **Click logging** — append-only `affiliate_clicks`; written **before** redirect (`FR-AFF-1`).
- **Redirect service** — `/go/:tourId`, `noindex`, `< 200 ms` (`NFR-PERF-4`).
- **Commission attribution** — reconciled from the OTA network's reporting (import/CSV/API) into `affiliate_earnings` (future table) for revenue analytics.
- **Fallback logic** — if a tour's affiliate URL is missing/expired, redirect to provider search for the Experience and flag for review (`FR-AFF-3`).
- **Link health** — scheduled job pings a sample of affiliate URLs; broken links flagged in Admin.

## 15.3 Attribution reporting

Atlas cannot see the actual booking; it estimates via click→commission reconciliation from OTA reports. Admin surfaces: clicks, click→provider CTR, estimated vs. confirmed commission, top-earning experiences/cities.

## 15.4 Compliance

- Clear **affiliate disclosure** on all pages with CTAs and a dedicated `/legal/affiliate-disclosure` page (FTC-style).
- Respect each OTA's affiliate program terms (link formatting, brand usage, no cloaking beyond the standard `/go` redirect).

---

# 16. SEO Strategy

SEO is the **primary acquisition channel** (BG-1). Think of the site as two products: an interactive map (for users) and thousands of destination pages (for Google).

## 16.1 URL & canonical strategy

- Clean hierarchy `/destinations/{country}/{city}`, `/experiences/{slug}`, `/guides/{slug}`.
- One canonical URL per concept; parameterized filter states use `rel=canonical` back to the base page (or `noindex` for thin filter combos).
- Stable slugs; 301 on any change.

## 16.2 Programmatic SEO

Generate at scale from structured data:
- **Destination pages** — every published city.
- **Intent pages** — "Things to do in {city}", "{category} in {city}", "Best {tag} experiences in {city}", "Best time to visit {city}".
- **Collections** — "Best sunset spots in {city}".
Templates ensure each page has unique, substantive content (data + AI summary + editorial), never thin/duplicate.

## 16.3 Structured data (Schema.org)

- `TouristAttraction` / `TouristTrip`, `Product` + `Offer` (price), `AggregateRating`, `BreadcrumbList`, `ItemList`, `Article` (guides), `Organization`, `WebSite` + `SearchAction`.
- Emitted as JSON-LD, validated in CI (SEO validation test — see [§24](#24-testing-strategy)).

## 16.4 On-page

- Semantic HTML, single `h1`, logical heading hierarchy.
- Meta title/description templated + editable per page.
- Open Graph + Twitter cards with hero image.
- Internal linking: destination ⇄ experiences ⇄ collections ⇄ guides (topical clusters); breadcrumb links.
- Image `alt` from enrichment; lazy-loaded, CDN-served.

## 16.5 Technical SEO

- SSR/SSG (Next.js) so content is crawlable without JS.
- Auto-generated, sharded `sitemap.xml` (+ index) regenerated on publish/import.
- `robots.txt` allows content, disallows `/go/*`, `/admin/*`, filter noise.
- Core Web Vitals budgets (see [§21](#21-performance)).
- hreflang reserved for future localization ([§17](#17-ai-content-generation)/roadmap).

## 16.6 Content governance

Programmatic pages must clear a **quality gate** (min word count, unique summary, ≥1 image, ≥3 experiences) before indexing; otherwise `noindex` until enriched. Prevents thin-content penalties.

---

# 17. AI Content Generation

_Future-leaning, but designed now with a human-in-the-loop._

## 17.1 Use cases

- LLM **destination/experience summaries** and **seasonal notes**.
- **Tag/category generation** from tour text (assistive, reviewed).
- **Travel tips** and **best-time** inference.
- **Duplicate detection** assistance (semantic similarity) feeding [§11 dedup](#11-data-pipeline).
- **Quality scoring** of generated/imported content.

## 17.2 Guardrails

- **Human approval required** before AI content is published (`FR-CMS-1`; Editor persona P-10).
- Generated content is **stored as drafts** (`experiences.ai_summary`, `status='enriched'`) until an editor promotes it.
- Provenance recorded (model, prompt version, generated_at). Regenerable.
- Cost controls: batched, queued, rate-limited; monitored spend with alerts (see [§28](#28-technical-debt-register)).
- Factuality: prompts constrained to provided structured data; no fabricated prices/availability (those come only from OTA snapshots).

## 17.3 Model choice

Provider-agnostic via an `LLMProvider` interface. Default to the latest capable model for quality where content ships to users; use a cheaper/faster model for high-volume assistive tasks (tag suggestions, dedup scoring). Prompt versions are tracked so output is reproducible and auditable.

---

# 18. CMS

Editorial workflow for the Editor/Operator (P-10).

## 18.1 Capabilities

- **Tour moderation** — approve/reject imported tours; edit before publish.
- **Experience enrichment** — edit rating, tags, categories, summaries, flags; merge duplicates; set canonical.
- **Guides** — long-form markdown editor with embedded experience cards + map anchors; SEO fields.
- **Collections** — build/order curated groupings; feature on home.
- **Media** — upload/attribute images; select hero images.
- **Scheduling** — publish now or schedule; unpublish/archive.
- **Featured content** — pin experiences/collections/destinations.

## 18.2 Editorial workflow

`draft → in_review → scheduled → published → updated → archived`. Every state change is audited (who/when). Publishing triggers cache invalidation + sitemap regeneration.

## 18.3 SEO editing

Editors override templated `seo_title`/`seo_description`, canonical, and OG image per page. Quality-gate warnings surface inline (word count, missing image, etc.).

---

# 19. Admin Dashboard

Operations cockpit at `admin.<domain>` (auth-gated, `noindex`).

## 19.1 Panels

| Panel | Content |
|-------|---------|
| **Overview** | KPIs: sessions, affiliate clicks, est. revenue, published experiences, import health |
| **Imports** | Runs, statuses, counts, logs, failed jobs, **re-run** button, quarantine queue |
| **Tours** | Moderation queue, filters, bulk approve/reject, editor |
| **Experiences** | Dedup/merge, enrichment, featuring |
| **Analytics** | Clicks over time, top experiences/cities, search terms (incl. zero-result), funnels, CTR |
| **Affiliates** | Provider config, link health, estimated vs confirmed commission |
| **Content** | Guides, collections, scheduling |
| **Users** | Admin/editor management, roles |
| **Settings** | API keys, feature flags, system config |

## 19.2 Requirements

- **FR-ADMIN-1/2** (see [§8.8](#88-cms--admin)). All destructive actions confirm + audit-log. Secrets (API keys) are write-only in UI (never rendered back).

---

# 20. Security

## 20.1 Authentication

- Passwords hashed with **Argon2id** (or bcrypt cost ≥ 12). No plaintext, ever.
- **JWT** access tokens (15 min) + rotating refresh tokens (httpOnly, secure, sameSite). Refresh rotation + `jti` denylist for revocation.
- OAuth (Google) for public accounts (Should).

## 20.2 Session & token handling

- Access token in memory (SPA) or httpOnly cookie; refresh always httpOnly.
- CSRF protection on cookie-based flows (double-submit token / SameSite=strict).

## 20.3 Authorization model (RBAC)

| Role | Can |
|------|-----|
| `admin` | Everything incl. user management, settings, API keys |
| `editor` | Content: approve tours, enrich, publish guides/collections; no user/settings |
| `viewer` | Read-only admin/analytics |

Enforced at the API layer via guards/decorators; never trust the client. Object-level checks where needed.

## 20.4 Application security

- **Input validation** on every endpoint (DTO validation, allowlist params). Reject unknown fields.
- **SQL injection** — parameterized queries/ORM only; no string-built SQL.
- **XSS** — output encoding; sanitize markdown (guides) via allowlist; strict CSP.
- **CSRF** — as above.
- **SSRF** — import fetchers restricted to known provider hosts.
- **Rate limiting** — per [§9.5](#95-rate-limits); stricter on auth endpoints (login throttling + lockout/backoff).
- **CORS** — allowlist known origins only.

## 20.5 Secrets & configuration

- All secrets (OTA keys, Google Maps key, DB, JWT signing key, LLM keys) in environment variables / secret manager — **never in the repo**.
- `.env.example` documents required vars; real `.env` gitignored.
- Google Maps key restricted by referrer + API; OTA keys server-side only.

## 20.6 Data protection & privacy

- **No raw IP storage** — hash IPs for click logs (`ip_hash`).
- Minimal PII (email for accounts only). GDPR-conscious: cookie consent, privacy policy, data-deletion path (future).
- Affiliate/analytics cookies gated behind consent banner.

## 20.7 Monitoring & response

- Auth failures, rate-limit hits, and anomalous import deletions alert ops ([§23](#23-observability)).
- Dependency scanning (npm audit / Dependabot) in CI; patch policy for criticals.

---

# 21. Performance

## 21.1 Budgets (NFRs)

| ID | Target |
|----|--------|
| NFR-PERF-1 | API read P95 < 200 ms (cached), < 500 ms (uncached) |
| NFR-PERF-2 | Search/autocomplete P95 < 150 ms |
| NFR-PERF-3 | Destination page LCP < 2.5 s (P75, mobile 4G); CLS < 0.1; INP < 200 ms |
| NFR-PERF-4 | Affiliate redirect < 200 ms server time |
| NFR-PERF-5 | Nightly full import completes < 2 h per provider (50k tours) |

## 21.2 Techniques

- **Caching (Redis):** hot destination/experience payloads, map bbox tiles (by grid+filter hash), search results for popular queries. Explicit invalidation on publish/import.
- **CDN:** static assets + images via Cloudflare/Vercel/image CDN; never serve images from the app.
- **Rendering:** SSG for stable destination/guide pages (revalidate on publish); SSR for search/map; client hydration minimal.
- **Pagination & lazy loading:** cursor pagination; lazy images; map pins loaded per viewport.
- **Image optimization:** responsive sizes, modern formats (AVIF/WebP), width/height set (CLS).
- **Compression:** gzip/brotli; HTTP/2.
- **DB:** proper indexes ([§12.3](#123-indexing-strategy)); avoid N+1 (batched loaders); read replicas later if needed.
- **Streaming:** stream large admin exports.

---

# 22. Infrastructure

## 22.1 Reference stack (v1.0)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **Next.js (React)** | SSR/SSG for SEO; Vercel deploy |
| Backend | **NestJS** (modular monolith) | TypeScript; extractable modules |
| Database | **PostgreSQL 16 + PostGIS** | Managed (Neon/RDS/Supabase) |
| Cache | **Redis** | Cache + queue backing |
| Queue | **BullMQ** (Redis) | Import/enrichment workers |
| Search | Postgres FTS → **Meilisearch/Typesense** | Progressive |
| Object storage | **S3-compatible** (R2/S3) | Raw payloads, media originals |
| CDN | **Cloudflare / Vercel / image CDN** | Assets + images |
| Maps | **Google Maps JS API** | Behind `MapProvider` abstraction |
| Container | **Docker** | Parity dev↔prod |
| CI/CD | **GitHub Actions** | Lint, test, migrate, deploy |
| Monitoring | Sentry + logs + uptime | See [§23](#23-observability) |

> The user is deliberately learning; the stack is chosen to introduce queues, caching, search, and workers **incrementally** (see [§27](#27-roadmap)), keeping the app deployable at every milestone.

## 22.2 Environments

- `local` (Docker Compose: app, Postgres, Redis, Meilisearch), `preview` (per-PR), `staging`, `production`.
- Config strictly via env vars per environment; no environment-specific code branches.

## 22.3 Deployment

- Frontend → Vercel (or containerized). Backend + workers → container platform (Railway/Fly/Render/ECS).
- Migrations run as a gated CI/CD step before app rollout; zero-downtime (expand/contract migration pattern).
- Blue/green or rolling deploys; automated rollback on health-check failure.

## 22.4 Topology

```
[Browser]──HTTPS──▶[CDN/Edge]──▶[Next.js Frontend]──▶[NestJS API]──┬─▶[PostgreSQL+PostGIS]
                                                                    ├─▶[Redis cache]
                                                                    ├─▶[Search engine]
                                                                    └─▶[Object storage]
[Cron/Scheduler]──▶[Queue(Redis)]──▶[Import Workers]──▶[OTA APIs] + writes to DB/Search
```

---

# 23. Observability

## 23.1 Logging

- **Structured JSON logs** with correlation/request IDs; no PII or secrets in logs (per [§20.6](#206-data-protection--privacy) and global logging principle).
- Log levels used purposefully; every log line actionable.

## 23.2 Tracing

- Distributed tracing (OpenTelemetry) across API → DB/queue/search; spans on import stages.

## 23.3 Metrics

- API latency/error rates; import run durations & counts; queue depth/lag; cache hit ratio; search latency; affiliate click volume; Core Web Vitals (RUM).

## 23.4 Health & alerts

- `/health` (liveness) + `/ready` (readiness: DB, Redis, search reachable).
- **Error reporting via Sentry** (org standard) — errors carry Sentry issue URLs in triage.
- Alerts: import failure/abort, > X% soft-delete guard trip, auth-failure spikes, error-rate SLO breach, LLM/Maps cost thresholds.

## 23.5 SLOs

- API availability 99.5% (v1). Error budget tracked. Import success rate ≥ 99% of scheduled runs.

---

# 24. Testing Strategy

Follows the testing pyramid; tests are executable documentation.

| Level | Scope | Tooling |
|-------|-------|---------|
| **Unit** | Services, normalizers, dedup, deep-link builder, ranking | Jest/Vitest — target ≥ 80% on core domain |
| **Integration** | API + DB (ephemeral Postgres), queue workers | Jest + Testcontainers |
| **Contract** | OTA client contracts (recorded fixtures), internal API contracts | Pact / recorded HTTP |
| **E2E** | Critical journeys: search → card → `/go` redirect; destination render | Playwright |
| **Load** | Search & map bbox endpoints, import throughput | k6 |
| **API** | Endpoint conformance to [§9](#9-api-specification) | Supertest / schema validation |
| **Accessibility** | WCAG 2.1 AA on public pages | axe / Playwright a11y |
| **SEO validation** | JSON-LD validity, canonical/meta presence, sitemap integrity | Custom CI checks |

**Quality gates in CI:** lint + typecheck → unit → integration → build → E2E (on preview) → SEO/a11y checks. Merge blocked on failure. Import pipeline has golden-file tests for normalization/dedup.

---

# 25. Analytics

## 25.1 Tracked events

`page_view`, `search` (query, filters, result_count — **including zero-result**), `filter_apply`, `map_pin_click`, `experience_view`, `compare`, `save_collection`, `affiliate_click` (canonical revenue event), `guide_read`.

## 25.2 Derived metrics & funnels

- **Discovery funnel:** land → search/filter → experience_view → affiliate_click → (confirmed commission).
- Top destinations/experiences; search-term analysis; **zero-result terms → content/tag backlog**; CTR (view→click); affiliate click→commission (reconciled); bounce rate; dwell time; map engagement.

## 25.3 Implementation

- First-party event capture to Analytics Service (owns aggregation) + optional GA4/Plausible for web analytics (consent-gated).
- Affiliate clicks are the **source of truth for revenue intent**; reconciled against OTA reports for confirmed commission.
- Heat maps of experience density (product) distinct from behavioral heat maps (optional tooling).

---

# 26. Monetization

## 26.1 Primary (v1.0)

- **Affiliate commission** on OTA tours/experiences (Viator/GetYourGuide). Zero booking/payment liability. This is the entire v1 revenue model.

## 26.2 Secondary (future)

| Stream | Description | Stage |
|--------|-------------|-------|
| Display ads | Contextual ads on high-traffic guides | V2 (careful UX) |
| Sponsored listings | Paid featured placement (clearly labeled) | V2 |
| Premium | Ad-free / advanced trip planner subscription | V3 |
| Travel insurance | Affiliate insurance partners | V2 |
| Hotels / Flights | Additional affiliate verticals | V2/V3 |
| Marketplace / Partner API | Data/embed API for bloggers (P-9) | Future |

## 26.3 Principles

- Disclosure and trust first; sponsored content always labeled.
- Never compromise editorial ranking integrity for a single sponsor (moat is trust).

---

# 27. Roadmap

Milestones are **deployable at every stage** and each introduces one new backend concept (mirrors the user's v0.1→v2.0 idea).

## 27.1 Milestones

| Milestone | Theme | Ships | New concept learned |
|-----------|-------|-------|---------------------|
| **M0 — Foundations** | Skeleton | Next.js + NestJS + Postgres; one destination page hardcoded; deploy | Full-stack deploy, CI |
| **M1 — Ingest (MVP)** | One OTA import | Manual/scheduled import of one provider; Experiences/Tours; destination pages from DB | REST, ORM, cron |
| **M2 — Discovery** | Search + filters | Postgres FTS search, filters, experience/tour pages | Full-text search, faceting |
| **M3 — The Map** | Map-first UX | Google Maps pins, clustering, bbox geo queries, cards | PostGIS, geo queries |
| **M4 — Affiliate** | Revenue | `/go/:tourId`, deep links, click logging, disclosure | Redirects, attribution, event logging |
| **M5 — SEO** | Traffic | SSG/SSR, structured data, sitemaps, programmatic pages | Programmatic SEO, schema |
| **M6 — Scale-out** | Backend depth | Queues + workers, Redis cache, dedicated search engine | Queues, caching, search infra |
| **M7 — CMS/Admin** | Operations | Admin dashboard, moderation, enrichment, analytics | Auth/RBAC, dashboards |
| **M8 — Intelligence** | AI + planner | AI summaries (human-approved), recommendations, trip planner | LLM integration, routing |
| **M9 — Hardening** | Production-grade | Observability, load testing, security review, CI/CD maturity | SRE, testing depth |

## 27.2 Release tiers

- **MVP (M0–M4):** browse + map + search + working affiliate links for one city, one provider.
- **V1 (M5–M7):** SEO surface live, second provider, admin/CMS, caching/queues/search.
- **V2 (M8):** AI content, recommendations, trip planner, secondary monetization.
- **V3+ (M9+):** localization, partner API, additional verticals.

---

# 28. Technical Debt Register

Intentional shortcuts and postponed work, tracked so they're deliberate — not forgotten.

| ID | Item | Rationale | Revisit at |
|----|------|-----------|-----------|
| TD-1 | Postgres FTS instead of dedicated search | Avoid infra early | M6 |
| TD-2 | Modular monolith, not microservices | Faster learning/iteration | Post-V2 if scale demands |
| TD-3 | Anonymous collections in local storage before accounts | Ship saving without auth | M7 (public accounts) |
| TD-4 | Rule-based enrichment before LLM | Cost/quality control | M8 |
| TD-5 | Single OTA at launch | Reduce integration surface | V1 (second provider) |
| TD-6 | Estimated commission (no booking visibility) | We don't own checkout | When OTA reporting API integrated |
| TD-7 | **Google Maps cost exposure** — pin queries can be expensive at scale | Moat feature | Add caching (M6) + strict key restrictions + budget alerts **now** |
| TD-8 | No UGC reviews | Scope control | Post-V2 |
| TD-9 | No multi-language | Focus | V3 (hreflang reserved) |
| TD-10 | Nearby restaurants depend on Places data availability/cost | Data/cost risk | Validate in M3 spike |

> **Flagged risk (commercial↔learning tension):** M6 concepts (queues/cache/search) are learning-motivated but also genuinely needed by M3–M5 traffic. Sequence so caching for map/search lands no later than the SEO traffic ramp (M5) to control Maps API cost (TD-7).

---

# 29. Glossary

**Business terms**

- **OTA** — Online Travel Agency (Viator, GetYourGuide); source of tour inventory and booking.
- **Affiliate commission** — revenue earned when a referred user books on the OTA.
- **Moat** — durable competitive advantage; here, the enriched dataset + map-first UX.
- **Experience** — Atlas's curated concept for a thing-to-do; may aggregate multiple provider tours.
- **Tour** — a single bookable OTA offering mapped to an Experience.
- **Collection** — an editorially curated group of experiences.
- **Programmatic SEO** — generating many pages at scale from structured data.
- **E-E-A-T** — Experience, Expertise, Authoritativeness, Trust (Google quality signals).

**Technical terms**

- **SSR/SSG** — Server-Side Rendering / Static Site Generation (Next.js).
- **PostGIS** — geospatial extension for PostgreSQL.
- **bbox** — bounding box; the map viewport as a rectangle used to query pins.
- **Deep link** — provider URL with affiliate parameters that lands on the specific tour.
- **Idempotent upsert** — safe insert-or-update keyed on `(provider, provider_tour_id)`.
- **Soft delete** — mark `deleted_at` instead of physically removing a row.
- **RBAC** — Role-Based Access Control.
- **JWT** — JSON Web Token for stateless auth.
- **Queue/Worker** — asynchronous job processing (BullMQ) for imports/enrichment.
- **CWV** — Core Web Vitals (LCP/CLS/INP).
- **JSON-LD** — structured data format for Schema.org markup.

---

# 30. Appendices

## A. ER Diagram (textual)

```
Country 1───* City 1───* Experience 1───* Tour *───1 Provider
                              │                 │
                              │                 ├──1 Price(snapshot)
                              │                 ├──1 Availability(snapshot)
                              │                 └──1 AffiliateLink
                              ├──* ExperienceCategory *──1 Category
                              ├──* ExperienceTag *──1 Tag
                              ├──* Image
                              ├──1 Location (geom)
                              └──* Review (imported/editorial)

Collection *──* Experience        Guide *──1 Author
Itinerary 1──* Stop *──1 Experience;  Stop *──1 Route
Provider 1──1 AffiliateProvider
Tour 1──* AffiliateClick
ImportRun 1──* (touches) Tour
User (admin|editor|viewer)
```

## B. Sequence Diagram — Affiliate Redirect

```
User        Frontend       API(/go/:tourId)     DB            OTA
 │  click CTA  │                 │               │              │
 │────────────▶│  GET /go/:id    │               │              │
 │             │────────────────▶│  INSERT click │              │
 │             │                 │──────────────▶│              │
 │             │                 │◀──────────────│  ok          │
 │             │                 │ build deeplink│              │
 │             │◀── 302 Location ─┤ (affiliate ID)│              │
 │────────────────────────────── redirect ──────────────────▶│ checkout
```

## C. Sequence Diagram — Nightly Import

```
Scheduler → Queue → Worker → OTA API → Normalize → Validate → Enrich → Dedup → Upsert(DB) → Index(Search) → Invalidate(Cache) → Alert(if guard tripped)
```

## D. Sample JSON Schemas

**Experience (public response):**
```json
{
  "$id": "Experience",
  "type": "object",
  "required": ["id","slug","title","city","editor_rating","price_band"],
  "properties": {
    "id": {"type":"string"},
    "slug": {"type":"string"},
    "title": {"type":"string"},
    "summary": {"type":["string","null"]},
    "editor_rating": {"type":"number","minimum":0,"maximum":5},
    "price_band": {"enum":["free","$","$$","$$$"]},
    "tags": {"type":"array","items":{"type":"string"}},
    "location": {"type":"object","properties":{"lat":{"type":"number"},"lng":{"type":"number"}}},
    "tour_count": {"type":"integer","minimum":0}
  }
}
```

**Affiliate click (internal event):**
```json
{
  "$id": "AffiliateClick",
  "type": "object",
  "required": ["tour_id","provider_id","created_at"],
  "properties": {
    "tour_id": {"type":"string"},
    "provider_id": {"type":"string"},
    "session_id": {"type":["string","null"]},
    "referrer": {"type":["string","null"]},
    "ip_hash": {"type":["string","null"]},
    "created_at": {"type":"string","format":"date-time"}
  }
}
```

## E. Architecture Diagram (four systems)

```
        OTA APIs (Viator, GetYourGuide)
                   │
            ┌──────▼───────┐
            │ Data Ingestion│  (System 1: workers, queue, normalize, dedup)
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │  PostgreSQL   │  (System 2: the curated product / moat)
            │  + PostGIS    │
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │  NestJS API   │  (System 3: auth, search, filter, maps, affiliate)
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ Next.js + Maps│  (System 4: consumer of YOUR API only)
            └──────┬───────┘
                   ▼
                 User
```

## F. Wireframe notes (v1)

- **Home:** globe/map hero + global search + featured collections strip.
- **Destination:** split view — filters (left) · experience list (center) · map (right/toggle on mobile).
- **Experience:** gallery, enrichment facts, aggregated tours (compare), map with nearby, affiliate CTA, similar experiences.
- **Trip Planner:** map canvas + ordered stop list + route + per-stop CTA.

## G. Change Log

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-07-05 | Roy Mkhabela | Initial Master Product Specification created from discovery discussion. |

## H. Open Questions (to resolve before/within relevant milestones)

1. Which OTA is the **launch provider** — Viator or GetYourGuide? (Affiliate program approval + API access dependency; blocks M1.)
2. Google Maps vs. Mapbox/MapLibre for cost at scale? (Abstract now; decide by M3 — TD-7.)
3. Meilisearch vs. Typesense at M6? (Typesense favored for geo + typo tolerance.)
4. Public accounts at M7 — email/password + Google OAuth, or Google-only?
5. Nearby-restaurants data source and cost (Google Places vs. OSM)? (Spike in M3 — TD-10.)

---

_End of Master Product Specification v1.0._
