# Folio Voyage / Atlas — Linear audit handoff

**Date:** 2026-07-25  
**Project:** [Folio Voyage — Atlas Platform](https://linear.app/bridgexconnect/project/folio-voyage-atlas-platform-0b1ada23aca2)  
**Scope:** Specs (`docs/01–11`, Master Product Spec) × codebase (`apps/web`, `apps/api`) × Linear backlog (72+ issues)  
**Purpose:** Contradictions, gaps, risks, and opinions — **not** the enriched Linear descriptions themselves (those are in Linear).

---

## Executive take

You have **two products living in one backlog**: (1) a shippable **static affiliate content site** that is already doing real work, and (2) a **learning-grade M0→M9 platform spine**. Both are valuable; the backlog and several docs still pretend only (2) exists, while the repo’s public surface is mostly (1). The single most important engineering unblock is **[BRI-165](https://linear.app/bridgexconnect/issue/BRI-165)** (normalizer price path) — without it, the ingest “Done” stories do not produce publishable tours.

---

## What is done vs needs doing

### Done (evidence in repo + Linear)

| Area | Evidence |
| --- | --- |
| Monorepo + Turbo + shared package | ST-1 Done; `apps/web`, `apps/api`, `packages/shared` |
| Docker Compose Postgres(+PostGIS image) + Redis | ST-2 Done |
| CI lint/typecheck/test + migrate | ST-3 Done |
| Vertical slice / seed path | ST-5 Done |
| Viator ingest pipeline (client → normalize → locations → quarantine → upsert → cron) | ST-6..10 Done |
| Experience–tour linkage / lifecycle / geo fallback | ST-11 prereq (BRI-164) Done |
| Map provider decision | BRI-161 Done (MapLibre + OpenFreeMap) |
| 3D strategy reconcile | BRI-162 Done (MapLibre-native 3D; Google Photoreal dropped) |
| Affiliate disclosure | ST-27 marked **Done** this audit (`/legal/disclosure`) |
| Static SEO/content MVP | 6 destinations, blog, legal, sitemap/robots, JSON-LD (static) |
| Partial live CTAs | ~19/48 experiences linked via `viator-links.json` |

### In flight

| Item | State | Note |
| --- | --- | --- |
| ST-11 DB city pages | **In Review** | Code exists; real data blocked by BRI-165 |
| EP-1 / EP-2 / EP-3 / EP-4 | **In Progress** | Updated this audit |
| Project status | **In Progress** | Was Backlog |

### Needs doing next (recommended order)

1. **BRI-165** — fix live `pricingInfo` → `price_minor` (Urgent).  
2. Re-run import → promote → finish **ST-11** / **ST-12**.  
3. **[BRI-166](https://linear.app/bridgexconnect/issue/BRI-166)** — dual-content canonical URL decision.  
4. **[BRI-167](https://linear.app/bridgexconnect/issue/BRI-167)** — MapLibre 3D POC (`docs/11`).  
5. **ST-24 `/go`** — first-party click log (commission already works via `productUrl`).  
6. **[BRI-168](https://linear.app/bridgexconnect/issue/BRI-168)** — enrich static cards (price/rating/free-cancel).  
7. **[BRI-169](https://linear.app/bridgexconnect/issue/BRI-169)** — remove “written by hand” overclaims.  
8. **ST-4** — preview/prod deploy **only after your explicit go-ahead**.

### Not started (spine MVP remainder)

- M2: search, filters, detail, compare (EP-5/6, ST-13..18)  
- M3 spine: PostGIS bbox / clustering / pin→card (ST-19..22) — **deferred after 3D POC**  
- M4 remainder: ST-24, ST-25 completion, ST-26  
- M5 remainder: programmatic SEO, quality gate, Lighthouse CI  
- M6–M9: queues, dedicated search, auth/CMS, AI, SRE  

---

## Contradictions (specs ↔ docs ↔ Linear ↔ code)

### 1. Two MVPs, never formally merged

| Source | Says |
| --- | --- |
| `docs/01` / `docs/03` | MVP = M0–M4 (ingest + search + map + `/go`) |
| `docs/04–07`, `docs/11` §7 | Ship content + live Viator CTAs first; map/backend sequenced differently |
| Code | Content MVP largely shipped; platform MVP partially built |

**Opinion:** Keep both tracks, but **name them** in Linear (Learning spine vs Commercial near-term). Mixing them without labels causes false “we’re behind on M3” anxiety while you’re ahead on content/SEO.

### 2. “Ingest needs Full Access” is stale

| Source | Says |
| --- | --- |
| Linear project (old), M1 milestone (old), docs/06, docs/10 | Don’t build Postgres ingest on Basic Access; need Full Access / `modified-since` |
| docs/02 TD-11 | **RESOLVED** — pipeline exists |
| Code | Real `ViatorClient` + cron ingest |

**Action taken:** M1 milestone + EP-3 descriptions updated.  
**Still stale:** docs/06, docs/10 (and any leftover “no backend” playbook language).

### 3. Affiliate architecture: `/go` vs direct `productUrl`

| Source | Says |
| --- | --- |
| FR-AFF-1 / EP-8 / ST-24 | Log-then-302 via `/go/:tourId` |
| docs/06 | Viator tracks via `productUrl`; `/go` optional for commission |
| Code | Direct links only |

**Opinion:** Docs/06 is right about **commission**; architecture is right about **analytics**. Treat ST-24 as required for BG-2 *measurement*, not for Viator payout. Do not close EP-8 until `/go` exists.

**Update (2026-07-26):** Client-side **PostHog** analytics shipped (PR #22).
`experience_booking_clicked` now captures affiliate-CTA clicks in the browser
(via `trackAffiliateClick` in `apps/web/src/lib/analytics.ts`, carrying
`experience_id` + destination context), so BG-2 finally has *behavioural*
measurement — see the PostHog section in `CLAUDE.md`. This does **not** close
ST-24: PostHog is client-side (ad-blockable, no server-owned ledger); the
`/go/:tourId` log-then-302 remains the durable source of truth and stays **P1 /
EP-8 open**. Affiliate links themselves are still direct `productUrl` (no `/go`
yet), so the "Code | Direct links only" row above still holds for the redirect.

### 4. Map stack: Google vs MapLibre vs “3D-first”

| Source | Says |
| --- | --- |
| Older MPS / M3 text | Google Maps |
| BRI-161 | MapLibre + OpenFreeMap |
| docs/11 (post BRI-162) | MapLibre-native 3D + Three.js landmarks; Google Photoreal deferred |
| Linear ST-19..21 | Classic 2D PostGIS clustering |

**Opinion:** Commercial order should be **BRI-167 (3D POC) → later ST-19..21**. Learning order can stay M3 spine, but don’t block portfolio demos on PostGIS.

### 5. Dual destination URL systems

| Surface | Path |
| --- | --- |
| Static | `/destinations/bangkok` |
| DB | `/destinations/thailand/bangkok` |

Sitemap/JSON-LD cover static only. ST-11 can be “Done” in code and still invisible to SEO.

**Tracked as:** [BRI-166](https://linear.app/bridgexconnect/issue/BRI-166).

### 6. Path / monorepo drift in older briefs

docs/04, 05, 07, 10, `06-blog-eeat` still mention `frontend/` or wrong ports (`:3001` for web). Reality: `apps/web` (:3000), `apps/api` (:3001).

### 7. Voice DoD vs live copy

docs/09 forbids “written by hand”; several marketing components still use it.  
**Tracked as:** [BRI-169](https://linear.app/bridgexconnect/issue/BRI-169).

### 8. PostGIS advertised vs used

Compose/CI use PostGIS image; Prisma stores Float lat/lng. Not wrong for now, but docs/02 DDL and ST-19 assume geography types you don’t have yet.

### 9. Root README understates the API

README still implies health-only API; `app.module.ts` has destinations + import. CLAUDE.md is more accurate.

### 10. Linear ↔ GitHub sync points at the wrong repo

Many Folio issues auto-attach **`BridgeXconnect/b2b-training-platform`** GitHub issues (including newly created BRI-168/169). Project resource correctly links `foliovoyage`.  

**Opinion:** Fix the Linear GitHub integration / team default repo ASAP — otherwise PRs, branch names, and automations will keep polluting the wrong project.

### 11. Open questions that are already decided

MPS/docs still float “Viator vs GYG?” and (in places) Google vs Mapbox. In practice: **Viator + MapLibre**. Close or annotate those open questions to stop re-litigation.

---

## Opinions (judgment calls)

1. **Pull BRI-165 before more M1 ceremony.** Pipeline completeness on fixtures is a false green; production quarantine rate is the real KPI.  
2. **Don’t mark ST-11 Done until one real city publishes priced tours.** In Review is correct.  
3. **Canonical URL:** keep short `/destinations/:slug` for SEO; make DB the data source behind it. Long country/city paths are fine as API identifiers, not as public URLs.  
4. **ST-4 stays gated.** Prep Vercel root/`apps/web` in a PR; don’t ship prod without your say-so.  
5. **Build `/go` sooner than M4 “feels.”** You’re already sending affiliate traffic with zero first-party click ledger — bad for BG-2 learning and for debugging dead links.  
6. **3D POC is the portfolio differentiator.** Search/filters are table stakes later; a load-on-interaction MapLibre fly-through is the demo that matches the “map-first” brand claim.  
7. **Static card enrichment (BRI-168) is higher ROI than M2 search** until the DB corpus is healthy.  
8. **Defer EP-10/11 (queues, Meilisearch)** until import volume or query latency forces it — current scale doesn’t need them for learning value *or* revenue.  
9. **Treat docs/06–10 as “briefs with expiry.”** Add a one-line status banner at the top of each (Current / Historical) so agents stop implementing stale instructions.  
10. **Epic progress % in Linear will lag reality** until child issues are closed; trust the status tables in epic descriptions over the milestone progress bars for the next week.

---

## What was changed in Linear this session

- Project description + status → **In Progress**; reality-check table added.  
- Milestones **M0, M1, M3, M4** descriptions refreshed.  
- Epics enriched: EP-1..9, EP-12, EP-17 (status, code pointers, sequencing).  
- Stories enriched: ST-4, ST-11, ST-19, ST-24, ST-25, ST-28, ST-31.  
- **ST-27 → Done.**  
- New issues: **BRI-166** (dual content), **BRI-167** (MapLibre 3D POC), **BRI-168** (card enrichment), **BRI-169** (copy DoD).

---

## Suggested “this week” board

| Priority | Issue | Why |
| --- | --- | --- |
| P0 | BRI-165 | Unblocks real ingest |
| P0 | ST-11 (BRI-108) | Close after live data |
| P1 | BRI-166 | Prevents SEO/URL debt compounding |
| P1 | BRI-167 | Brand/moat demo |
| P1 | ST-24 | Analytics for money clicks |
| P2 | BRI-168 / BRI-169 | Conversion + trust polish |
| Gate | ST-4 | Only when you greenlight deploy |

---

*End of handoff. Specs remain source of truth for intent; this file is the audit opinion layer.*
