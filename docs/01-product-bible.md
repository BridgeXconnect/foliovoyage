# Atlas — Product Bible

**Living Document 01 of 3** · Derived from [Master Product Specification v1.0](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md)
**Scope:** Why the product exists and what it should become — Vision, Business, Users, UX, Monetization, Roadmap.
**Owner:** Roy Mkhabela · **Version:** 1.0 · **Updated:** 2026-07-05

> This document answers **why**. For **how** it's built see [System Architecture Specification](02-system-architecture-specification.md); for **what** gets built and when see [Engineering Specification](03-engineering-specification.md).

---

## Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision](#3-product-vision)
4. [User Personas](#4-user-personas)
5. [User Journeys](#5-user-journeys)
6. [Information Architecture](#6-information-architecture)
7. [Monetization](#7-monetization)
8. [Roadmap (Product View)](#8-roadmap-product-view)
9. [Business Glossary](#9-business-glossary)

---

# 1. Executive Summary

## 1.1 Product Vision
> **Atlas is the world's most visually intuitive destination-discovery platform** — a data platform that happens to have a travel website on top.

We are **not** building a travel website. We are building a **curated travel data platform** whose primary surface is a map-first discovery experience, and whose revenue derives from affiliate commissions on tours booked through OTAs.

## 1.2 Mission
Help travelers **discover and understand** what to do at a destination — spatially, seasonally, and by intent — better than an OTA listing page, a blog, or a Google SERP can.

## 1.3 Elevator Pitch
OTAs (Viator, GetYourGuide) have thousands of tours but list them as flat grids. Blogs have opinion but no live pricing. Google has links but no structure. **Atlas ingests OTA tour data, enriches it with editorial intelligence (ratings, tags, walking distance, best-time-to-go, hidden gems, AI summaries), and presents it on an interactive globe/map** so travelers explore a destination the way they would in real life. We don't handle bookings — we hand off to the OTA and earn commission.

## 1.4 Business Goals

| Goal ID | Goal | 12-Month Target |
|---------|------|-----------------|
| BG-1 | Organic SEO as primary acquisition channel | 25,000 organic sessions/month |
| BG-2 | Generate affiliate revenue | First $1,000 cumulative commission |
| BG-3 | Build a defensible enriched dataset (the moat) | 50,000+ curated tours, 100+ cities |
| BG-4 | Portfolio-grade demonstration of full-system backend engineering | Public repo + live deploy + case study |

> **Dual intent.** This is both a **commercial product** and a **learning/portfolio project**. Where they conflict, the tradeoff is flagged in the [Tech Debt Register](02-system-architecture-specification.md#18-technical-debt-register). The architecture grows from a modular monolith toward services so each concept is learned in context.

## 1.5 Long-Term Vision (3–5 yrs)
- Expand from tours into **AI-assisted itinerary planning** ("3 days in Rome" → optimized, mapped, walkable plan).
- Become the **canonical spatial index of "things to do."**
- Diversify monetization (multi-provider, hotels, insurance, sponsored placements).

## 1.6 Competitive Landscape

| Competitor | Strength | Weakness Atlas exploits |
|------------|----------|--------------------------|
| Viator / GetYourGuide | Inventory, booking, trust | Flat listings, no spatial/editorial intelligence, no cross-provider curation |
| TripAdvisor | Reviews, brand | Cluttered, ad-heavy, weak map-first discovery |
| Travel blogs | SEO content, opinion | No live price/availability, unstructured, not interactive |
| Google Things-to-do | Distribution | No curation, no voice, no persistence |
| Wanderlog / itinerary apps | Planning UX | Weak discovery/SEO surface, thinner commercial content |

## 1.7 Differentiators (The Moat)
1. **Enriched schema richer than the OTA** — editor ratings, intent tags, walking distance, best-season, hidden-gem flags, AI summaries.
2. **Map-as-a-query** — the map is a spatial interface to the database (geo-search, clustering, nearby, walking radius, routes).
3. **Programmatic SEO at scale** — thousands of intent-targeted pages from structured data.
4. **Cross-provider curation** — one Atlas Experience reconciles multiple OTA tours.

---

# 2. Problem Statement

## 2.1 Core problem
Travelers stitch together fragmented sources: OTA listings (inventory), blogs (opinion), Google Maps (geography), forums (hidden gems). No single surface answers *"What's genuinely worth doing here, where is it, when should I go, and how do I book it?"*

## 2.2 Problems with OTAs
Flat presentation · duplication/noise · no editorial trust (sponsored ranking) · no cross-provider view.

## 2.3 Problems with blogs
Stale prices/links · unstructured (no filter/map/compare) · unscalable (human-written, thin coverage).

## 2.4 Problems with Google
Links not answers · no persistence (no save/compare/plan) · volatile ranking.

## 2.5 Problems with trip planning
Spatial reasoning is manual · no intent lens (romantic/family/under-$50/sunset aren't first-class filters) · fragmented booking.

## 2.6 Why another travel site?
The opportunity isn't "another listing site" — it's a **curated spatial data layer** over commodity OTA inventory. Value is in enrichment + map-first interface, both structurally absent from incumbents. The affiliate model lets us launch without inventory, payments, or support.

---

# 3. Product Vision

## 3.1 What the platform becomes
> **The world's most visually intuitive destination-discovery platform.**

A traveler lands on a destination and sees a **living map**: pins for every worthwhile experience, clustered and colored by category, filterable by intent and budget, each opening into a rich card with photos, editorial notes, nearby attractions, and one affiliate CTA. From discovery they can build a **mapped, walkable itinerary**, and every booking hands off to the OTA.

## 3.2 Product pillars
1. **Discovery is spatial** — the map is the primary interface.
2. **Data is curated, not mirrored** — we enrich, dedupe, rank.
3. **SEO is a product** — destination pages are a first-class surface.
4. **We monetize the click, not the booking** — zero booking liability.

## 3.3 Explicit non-goals (v1.0)
- No booking, payments, cancellations, refunds, or support (all → OTA).
- No user-generated reviews at launch (editorial + imported ratings only).
- No native mobile app (responsive web only).
- No multi-currency checkout (display conversion only).

---

# 4. User Personas

Each persona lists motivations, frustrations, goals, and jobs-to-be-done (JTBD). Personas drive [Journeys](#5-user-journeys) and prioritization.

| ID | Persona | JTBD (abridged) |
|----|---------|-----------------|
| P-1 | **Backpacker** (Sam) | Find cheap/free things nearby without overspending. |
| P-2 | **Luxury Traveler** (Vivian) | Get a shortlist of best-in-class experiences; don't waste limited time. |
| P-3 | **Family** (The Okafors) | Activities filtered for family suitability, grouped geographically. |
| P-4 | **Digital Nomad** (Deza) | Save and gradually work through the best experiences over a long stay. |
| P-5 | **Solo Traveler** (Ravi) | Solo/social-friendly experiences that are safe. |
| P-6 | **Adventure Traveler** (Mara) | Filter by intensity and adventure type. |
| P-7 | **Weekend Traveler** (Tom) | A compact, mapped 48-hour highlight itinerary. |
| P-8 | **Travel Researcher** (Nadia) | Compare and save experiences into collections over time. |
| P-9 | **Blogger / Affiliate Partner** (Chris) | A structured source to link/embed curated recommendations _(future partner API)_. |
| P-10 | **Editor / Operator** (You) | Enrich and edit imported tours, and author and publish guides and collections, from one dashboard. |

Full persona detail (motivations/frustrations/goals) is preserved in [MPS §4](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md#4-user-personas).

---

# 5. User Journeys

Notation: `→` = user-visible step. Each journey references requirements defined in [Architecture §8](02-system-architecture-specification.md#2-functional-requirements).

- **J-1 Discover a destination (SEO entry):** Google → `/destinations/kyoto` → hero + map + top experiences → filter → open card → affiliate CTA → OTA. _Refs: FR-DEST-\*, FR-SEO-\*, FR-AFF-1._
- **J-2 Search:** type "family food tour rome" → autocomplete → results (list + map) → refine → card → CTA. _Refs: FR-SRCH-\*._
- **J-3 Explore the map:** open map → clusters → pin → card w/ nearby → similar → CTA. _Refs: FR-MAP-\*._
- **J-4 Read a guide:** SEO guide → inline cards → map anchor → internal links → CTAs. _Refs: FR-SEO-\*, FR-CMS-\*._
- **J-5 Compare tours:** select 2–4 → comparison (price/duration/rating/provider/inclusions) → CTA. _Refs: FR-DEST-4._
- **J-6 Save itinerary/collection:** save → collection → mapped view → reorder → share. _Refs: FR-DEST-5, FR-AUTH-\*._
- **J-7 Click affiliate → purchase:** CTA → `/go/:tourId` (log click) → 302 deep link → OTA checkout. _Refs: FR-AFF-\*, NFR-PERF-4._
- **J-8 Return later:** saved collections restored; "new since last visit" for saved destinations. _Refs: FR-DEST-5._
- **J-9 (internal) Curate imports:** admin → tours list (no approval queue) → enrich/edit or remove a tour → feature → author + publish guides and collections. AI tour copy is not reviewed per item; it publishes automatically behind an eligibility gate and is checked by a sampled eval harness ([Architecture §12](02-system-architecture-specification.md#12-ai-content-generation)). _Refs: FR-CMS-\*, FR-ADMIN-\*._

---

# 6. Information Architecture

## 6.1 Public sitemap
```
/                                    Home (globe + featured collections + search)
/destinations                        Country/city index
/destinations/:country               Country page
/destinations/:country/:city         City page (map + experiences)
/experiences                         Browse experiences
/experiences/:slug                   Experience detail (aggregates tours)
/tours/:slug                         Single OTA tour detail
/collections  /collections/:slug     Curated collections (generated, rule-curated; BRI-152)
/guides       /guides/:slug          Guides (SEO; generated, BRI-152)
/trip-planner                        Interactive itinerary builder
/search                              Results (list + map)
/map                                 Full-screen map / globe
/go/:tourId                          Affiliate redirect (noindex)
/about  /legal/*                     About + privacy/terms/affiliate disclosure/cookies
/sitemap.xml  /robots.txt            SEO infra
```

## 6.2 Admin sitemap (`admin.<domain>`, noindex, auth-gated)
```
/admin  /admin/imports  /admin/tours  /admin/experiences  /admin/destinations
/admin/collections  /admin/guides  /admin/analytics  /admin/affiliates
/admin/users  /admin/settings
```

## 6.3 Navigation & URL rules
- **Primary nav:** Destinations · Experiences · Collections · Guides · Trip Planner · Search · Map.
- Persistent global search on all public pages; breadcrumbs on destination/experience/guide pages (also emitted as `BreadcrumbList` schema).
- Map toggle (list ⇄ map) on every destination and search page.
- Slugs: lowercase, hyphenated, ASCII-folded, **stable once published** (301 on change). Canonical hierarchy country → city → experience. `/go/*` is `noindex, nofollow`, excluded from sitemaps.

---

# 7. Monetization

## 7.1 Primary (v1.0)
**Affiliate commission** on OTA tours (Viator/GetYourGuide). Zero booking/payment liability. This is the entire v1 revenue model.

## 7.2 Secondary (future)

| Stream | Description | Stage |
|--------|-------------|-------|
| Display ads | Contextual ads on high-traffic guides | V2 |
| Sponsored listings | Paid featured placement (labeled) | V2 |
| Premium | Ad-free / advanced trip planner subscription | V3 |
| Travel insurance | Affiliate insurance partners | V2 |
| Hotels / Flights | Additional affiliate verticals | V2/V3 |
| Marketplace / Partner API | Data/embed API for bloggers (P-9) | Future |

## 7.3 Principles
Disclosure and trust first; sponsored content always labeled; never compromise editorial ranking for a single sponsor (the moat is trust).

---

# 8. Roadmap (Product View)

Milestones are **deployable at every stage**; each introduces one new backend concept. Technical detail lives in the [Engineering Spec](03-engineering-specification.md).

| Milestone | Theme | Ships (product outcome) |
|-----------|-------|-------------------------|
| **M0 Foundations** | Skeleton | Deployed shell; one hardcoded destination page |
| **M1 Ingest (MVP)** | One OTA import | Destination pages populated from real imported tours |
| **M2 Discovery** | Search + filters | Users can search & filter experiences |
| **M3 The Map** | Map-first UX | Interactive map with pins, clusters, cards |
| **M4 Affiliate** | Revenue | Working affiliate CTAs + click tracking (first revenue possible) |
| **M5 SEO** | Traffic | Programmatic destination pages indexed; organic traffic begins |
| **M6 Scale-out** | Backend depth | Faster search & map via queues/cache/search engine |
| **M7 CMS/Admin** | Operations | ~~Editor can enrich, edit, and publish guides and collections at scale~~ Role-gated admin login and import/revenue analytics _(EP-13 CMS canceled, BRI-118; guides and collections are generated, BRI-152, M8)_ |
| **M8 Intelligence** | AI + planner | AI summaries + recommendations + trip planner |
| **M9 Hardening** | Production-grade | Observability, load-tested, security-reviewed |

**Release tiers:** MVP = M0–M4 · V1 = M5–M7 · V2 = M8 · V3+ = M9+.

---

# 9. Business Glossary

- **OTA** — Online Travel Agency (Viator, GetYourGuide); source of inventory and booking.
- **Affiliate commission** — revenue when a referred user books on the OTA.
- **Moat** — durable competitive advantage; here, enriched dataset + map-first UX.
- **Experience** — Atlas's curated concept for a thing-to-do; may aggregate multiple provider tours.
- **Tour** — a single bookable OTA offering mapped to an Experience.
- **Collection** — a curated group of experiences, selected by a deterministic rule and generated, not hand-assembled (BRI-152).
- **Programmatic SEO** — generating many pages at scale from structured data.
- **E-E-A-T** — Experience, Expertise, Authoritativeness, Trust (Google quality signals).

_Technical glossary in [Architecture §19](02-system-architecture-specification.md#19-technical-glossary)._

---
_End of Product Bible v1.0._
