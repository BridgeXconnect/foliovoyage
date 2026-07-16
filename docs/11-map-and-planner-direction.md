# 11 — Map & AI-Planner Direction

**Type:** Decision record (sits alongside the 01/02/03 spine, like the 06–10 briefs).
**Status:** Agreed direction, not yet built. **Updated:** 2026-07-16.
**Supersedes, where they conflict:** the *default* reading of `02 §9 Maps Architecture` and
`03 M3/EP-7`. Those describe a 2D, backend-driven map; this doc records why we are going
3D-first and how the 2D plan is deferred rather than dropped. Cross-refs: `02 §2.3 FR-MAP-*`,
`02 §18 TD-7 / TD-12`, `03 M8 / EP-17`.

---

## 1. Decision summary

The map is **3D-first** — Google Photorealistic 3D Maps (`<gmp-map-3d>` / the `maps3d`
library), the same primitive demonstrated by the `mcp-maps-3d` reference app that inspired the
feature. It is:

- **Scoped to a curation** — a single destination, or a single curated tour — never a global
  pin-cloud of everything.
- **Driven by our own data** — we render pins from the `lat`/`lng` we already store on every
  `Destination` (and, later, per `Experience`). No runtime geocoding and no LLM are needed for
  the core map; we already know where things are.
- **A client-only island that loads on interaction** — the SSR/indexable page renders first;
  the 3D map mounts on an explicit "view in 3D" action, never auto-loading above the fold.

The reference app is an **external reference only** — its code is not vendored into this repo.
Its reusable core is `map_app.ts` → `loadMap` / `_handleViewLocation` / `_handleDirections`
(load the 3D library, fly the camera, place 3D markers, draw a 3D route polyline).

> Security note: the reference zip shipped two live keys (a hardcoded Maps key in
> `map_app.ts:87`; a real `GEMINI_API_KEY` in its `.env.local`). Rotate/restrict both regardless
> of direction; never copy them into this project.

## 2. Why not 3D everywhere — the clustering constraint

The 2D-vs-3D question is not aesthetic; it is **pin density at zoom-out**. Google's marker
**clustering** library works on the 2D `google.maps.Map` only — **`Map3DElement` has no
clustering primitive**. So:

| Scale | Pins | 3D verdict |
|---|---|---|
| One curated destination / one curated tour | a handful → ~dozens | **3D wins** — tight geography, storytelling, low count |
| Global discovery / cross-city search | hundreds → thousands | 3D strains — no clustering, heavy tiles, photoreal at globe-zoom is just a globe |

Because the map in this product is **almost always scoped to a curation**, 3D is the default and
the brand. A **2D clustered discovery map is deferred, not dropped** — it becomes the
Full-Access-era surface for `/search` and cross-city browse (`02 §9`, `03 EP-7` as written),
which also needs the backend/PostGIS we do not have yet (`TD-11`).

## 3. Cost & performance — load on interaction

Photorealistic 3D (Map Tiles API) is **billed per map session/load**, and our acquisition model
is SEO traffic at scale (`BG-1`). Auto-loading a 3D canvas on every organic landing would both
run up the bill and wreck Core Web Vitals (LCP/INP) on the exact pages we need to rank.

**Rule:** the 3D map loads only on an explicit user action ("View this tour in 3D"). This
protects the Map Tiles bill and CWV, and makes the map a deliberate "step into it" moment. This
amplifies **`TD-7` (Google Maps cost exposure)** — see §7.

## 4. Flagship — the curated-tour 3D fly-through

The best use of the tech, and the first thing to build: reading a curated tour opens an
interactive 3D map of that experience. More than pins — reusing the reference app's
`_handleDirections` primitive:

- **Numbered 3D stops** in tour order.
- **A route polyline** (`Polyline3DElement`) connecting them.
- **A "play the tour" `flyCameraTo` walk-through** stepping the camera stop to stop.

This is fully buildable at Basic Access: it uses our own coordinates, needs no backend, and has
no Viator dependency.

## 5. AI chat → trip-planner add-on

The reference app's Gemini + MCP tool loop (`index.tsx` + `mcp_maps_server.ts`) is **not** core
map plumbing — it is the seed of a **trip-planner add-on** that extends the existing planner
(`03 M8 / EP-17`, `FR-DEST-5`, `FR-MAP-4`): the user chats, and the agent shows curated
experiences on the 3D map, ordering them into a mapped, walkable itinerary with a per-stop
affiliate CTA.

**Hard requirement — the provenance wall.** The moat is trust (`01 §7.3`) and our promise is
*researched, vetted, fact-checked*. When the agent suggests places for a city we have not
curated, those suggestions must be **visually and legally distinct** from curated content:

| | Folio curated | AI suggested |
|---|---|---|
| Marker style | branded / primary | clearly different |
| Label | vetted experience | "Suggested by AI — not yet vetted by Folio" |
| Affiliate CTA | yes | **no** |
| Editorial guarantee | yes | none (draft-to-research only) |

This mirrors the `08` voice rule (don't overclaim) one layer up, and reuses the `02 §12` /
`EP-15` AI guardrails (human-in-the-loop, provenance recorded, prompts constrained to provided
data, never fabricate prices/availability).

**Upside:** every uncovered city the agent is asked about is a **curation demand signal** —
telling us what to curate next (feeds `BG-3`, the dataset moat).

## 6. Fit with our stack

- **Framework** — reimplement the reference primitives as a **React client component**
  (`"use client"`) wrapping the `<gmp-map-3d>` custom element (works in React 19), or via
  `@vis.gl/react-google-maps`. The map logic is framework-agnostic DOM/Maps-API calls; the Lit
  chat UI and MCP scaffolding are not reused for the core map.
- **SEO** — the destination/tour page stays SSR/indexable (guide, cards, JSON-LD); the map is a
  `dynamic(() => …, { ssr: false })` island mounted on interaction.
- **Keys/ops** — a Google Cloud project with Maps JS + Geocoding + Map Tiles (Photoreal 3D)
  enabled, billing attached, key **HTTP-referrer + API restricted**.

## 7. Near-term sequencing

Given the depth of the spec versus **Basic Access** (which gates the whole ingestion/CMS spine —
`TD-11`), the buildable, high-leverage path is:

1. **Ship the current slice.** Review the live affiliate links, then deploy (Roy's gate — see
   `no-deploy-without-go-ahead`). Banks `M4` + most of `M5`; starts the SEO clock and the
   traffic/data evidence for the Full-Access application.
2. **Light Viator enrichment.** Surface `fromPrice` / aggregate rating / free-cancellation —
   already returned by `/products/search` at Basic tier (see `06`), no duplicate-content risk.
3. **3D map POC** on one destination — the curated-tour fly-through (§4). Buildable now.
4. **Apply for Full Access** once live with some traffic.
5. **Then** the backend spine (`M1`/`M6`/`M7`) + the 2D clustered discovery map (`EP-7`) + the
   AI planner (`M8`).

Through-line: *don't build the backend into a wall.* At Basic Access the content + affiliate
links + 3D map are the product; the data-platform spine waits until Full Access can feed it.

> This sequencing lives here for now. It can be lifted into `01 §8 Roadmap` later if the
> canonical roadmap should carry it (that would mean splitting `M3` and marking Basic-Access
> gating on `M1`/`M6`/`M7` in the spine).
