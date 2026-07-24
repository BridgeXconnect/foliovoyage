# 11 — Map & AI-Planner Direction

**Type:** Decision record (sits alongside the 01/02/03 spine, like the 06–10 briefs).
**Status:** Agreed direction, not yet built. **Updated:** 2026-07-24.
**Supersedes, where they conflict:** the *default* reading of `02 §9 Maps Architecture` and
`03 M3/EP-7`. Those describe a 2D, backend-driven map; this doc records why we are going
3D-first and how the 2D plan is deferred rather than dropped. Cross-refs: `02 §2.3 FR-MAP-*`,
`02 §18 TD-7 / TD-12`, `03 M8 / EP-17`.

> **⚠️ Revision note — 2026-07-24 (BRI-162): Google Photorealistic 3D dropped.**
> The first version of this doc made the map **3D-first on Google Photorealistic 3D Maps**
> (`<gmp-map-3d>` / `Map3DElement` / `Polyline3DElement` / `flyCameraTo` / the Map Tiles API,
> wired via `@vis.gl/react-google-maps`). That premise conflicted with the map-provider decision
> in **BRI-161** — **MapLibre GL JS + OpenFreeMap** (open-source, no API key, no usage cap, no
> billing). **BRI-162 reconciles the two by rebuilding the 3D story natively inside MapLibre:**
> terrain + building extrusion + a cinematic `flyTo`/`easeTo` camera, plus hand-placed **Three.js
> GLTF models** for the handful of hero landmarks a curated itinerary actually features. The whole
> map stack now stays inside MapLibre GL JS + OpenFreeMap — **no new accounts, keys, or billing.**
>
> **Deferred, not deleted:** the one thing this trades away is *citywide photorealistic imagery*.
> **Google Photorealistic 3D remains an explicit future option** — if the business ever wants true
> photoreal 3D across a whole city, it can be revisited as a paid, provider-specific layer. It is
> out of scope now because the curated-landmark approach below delivers the "step into it" moment
> without a per-session bill or a Google dependency. **Cesium OSM Buildings** (and any other
> citywide 3D-Tiles building dataset) was also **considered and declined for now** — see §6.

---

## 1. Decision summary

The map is **3D-first, built natively in MapLibre GL JS** over our OpenFreeMap basemap. For a
scoped curation — a single destination, or a single curated tour — the 3D scene is composed from
MapLibre-native ingredients plus a small set of hand-made models, with **no external 3D map
provider**:

- **Terrain** — a `raster-dem` source drives `map.setTerrain({ source, exaggeration })`, with a
  `hillshade` layer for relief, giving real elevation under the route. (OpenFreeMap serves the
  *vector* basemap; the DEM is a **separate** free `raster-dem` source — e.g. Mapterhorn, as used
  in MapLibre's own terrain example. Validate the chosen DEM host's terms/uptime — see §6.)
- **Building massing** — a `fill-extrusion` layer over OpenFreeMap's own `building` source-layer
  (`render_height` / `render_min_height`) extrudes the city around the route. No extra dataset:
  the height data already ships in OpenFreeMap's tiles (this is exactly MapLibre's "Display
  buildings in 3D" example, which itself renders on the OpenFreeMap style).
- **Sky / atmosphere** — a `sky` layer for visual polish at high pitch.
- **Hero landmarks** — a `CustomLayerInterface` Three.js layer per destination places
  **hand-curated, georeferenced GLTF models** (positioned with `MercatorCoordinate.fromLngLat`
  and dropped onto terrain via `map.queryTerrainElevation`) for the **3–5 landmarks that actually
  appear in that destination's curated itineraries** — not a comprehensive city model. This
  follows MapLibre's documented *"Adding 3D models using three.js on terrain"* pattern.

It is also:

- **Scoped to a curation** — a single destination, or a single curated tour — never a global
  pin-cloud or a whole-city model of everything.
- **Driven by our own data** — we render pins and place landmarks from the `lat`/`lng` we already
  store on every `Destination` (and, later, per `Experience`). No runtime geocoding and no LLM are
  needed for the core map; we already know where things are.
- **A client-only island that loads on interaction** — the SSR/indexable page renders first; the
  3D map mounts on an explicit "view in 3D" action, never auto-loading above the fold.

**Reference patterns** are now MapLibre's own official examples — *"Adding 3D models using
three.js on terrain"*, *"Display buildings in 3D"*, and *"3D terrain"* — **not** the earlier
Google `mcp-maps-3d` demo, which is dropped (along with the two live keys it shipped; there is now
no Google/Gemini key surface in the core map at all).

## 2. Why scoped-to-curation, not citywide 3D

Two independent reasons converge on the same answer — the 3D scene is **scoped to a curation**,
never a global model:

1. **Pin density at zoom-out (unchanged).** Clustering is a **2D** concern; a pitched 3D scene has
   no cluster primitive. Global discovery across hundreds → thousands of pins is a **2D clustered**
   job, **deferred not dropped** — it becomes the Full-Access-era surface for `/search` and
   cross-city browse (`02 §9`, `03 EP-7` as written), which also needs the backend/PostGIS we do
   not have yet (`TD-11`).
2. **Modeled landmarks are hand-made.** Each hero GLTF is sourced or built per landmark. That is
   affordable and on-brand for **3–5 landmarks per curated destination**; it does **not** scale to
   "every building in every city" — and it doesn't need to.

| Scale | Approach | Verdict |
|---|---|---|
| One curated destination / one curated tour | terrain + building extrusion + 3–5 Three.js landmark models | **3D wins** — tight geography, storytelling, low model count |
| Global discovery / cross-city search | 2D clustered pins | 3D doesn't apply — no clustering, and citywide bespoke models don't scale |

This makes the **"curated, not comprehensive"** positioning literal: we model the few places our
itineraries actually feature, richly, rather than streaming a whole city's worth of generic
geometry.

## 3. Cost & performance — load on interaction (now for CWV, not billing)

The MapLibre + OpenFreeMap stack has **no per-session or per-tile fee**, so the original
Map-Tiles-billing pressure is **gone** — this is what reframed **`TD-7`** from "Google Maps cost
exposure" to a tile-provider **resilience** concern (`02 §18`). One rule survives, now purely for
**Core Web Vitals**:

**Rule:** the 3D map + Three.js models load only on an explicit user action ("View this tour in
3D"). Terrain tiles, `fill-extrusion` geometry, and GLTF assets are heavy; auto-loading them on
every organic SEO landing would wreck LCP/INP on the exact pages we need to rank (`BG-1`). Loading
on interaction keeps the indexable page fast and makes the 3D map a deliberate "step into it"
moment. (The residual tile concern is now OpenFreeMap's **no-SLA** availability, mitigated by
caching and MapLibre's provider-agnostic tile swap — `02 §9`, `TD-7` — not per-load cost.)

## 4. Flagship — the curated-tour 3D fly-through (MapLibre-native)

The first thing to build, and the best use of the tech: reading a curated tour opens an
interactive MapLibre 3D scene of that experience. More than pins:

- **The scene** — terrain drape + `fill-extrusion` building massing + a `sky` layer around the
  tour's area, pitched for a low, cinematic angle.
- **Numbered stops** in tour order (markers, or small Three.js markers in the custom layer).
- **A route line** connecting the stops — a GeoJSON `line` layer draped on terrain, or a Three.js
  tube in the custom layer for a raised 3D ribbon. (This replaces Google's `Polyline3DElement`.)
- **Hero landmark models** — the 1–5 georeferenced GLTF models for that tour's signature sights,
  dropped onto terrain elevation via the Three.js custom layer.
- **"Play the tour"** — a scripted **`flyTo` / `easeTo` sequence** keyframed through each stop
  (`center` + `zoom` + `pitch` + `bearing` per stop) for the "fly over the route" walk-through.
  This replaces Google's `flyCameraTo`; MapLibre's camera easing produces the same cinematic
  effect with no proprietary API.

Fully buildable at Basic Access: it uses our own coordinates, needs no backend, has no Viator
dependency, and requires **no Google Cloud project**.

## 5. AI chat → trip-planner add-on

An **LLM + tool-calling loop** (provider-agnostic — e.g. Claude or another model behind our own
API; not tied to any map vendor) is **not** core map plumbing — it is the seed of a **trip-planner
add-on** that extends the existing planner (`03 M8 / EP-17`, `FR-DEST-5`, `FR-MAP-4`): the user
chats, and the agent shows curated experiences on the MapLibre 3D map, ordering them into a
mapped, walkable itinerary with a per-stop affiliate CTA.

**Hard requirement — the provenance wall.** The moat is trust (`01 §7.3`) and our promise is
*researched, vetted, fact-checked*. When the agent suggests places for a city we have not curated,
those suggestions must be **visually and legally distinct** from curated content:

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

## 6. Fit with our stack — and options considered

- **Framework** — a **React client component** (`"use client"`) mounting a MapLibre `Map`, loaded
  via `dynamic(() => …, { ssr: false })`. The 3D custom layer and camera scripting are plain
  MapLibre + Three.js calls. `@vis.gl/react-google-maps` is **not** used.
- **Dependencies** — `maplibre-gl` (already the map library) **+ `three`** (with its
  `GLTFLoader` addon) for the landmark custom layer. **`three` is not yet in `package.json` — it
  needs adding** when this ships. No Google SDKs.
- **SEO** — the destination/tour page stays SSR/indexable (guide, cards, JSON-LD); the map is a
  client island mounted on interaction.
- **Keys/ops** — **none new.** OpenFreeMap needs no key; the `raster-dem` terrain source is a free
  public endpoint (confirm the chosen DEM host's terms and uptime before shipping). No Google
  Cloud project, no billing account, no Map Tiles enablement.

**Options considered and declined (for now) — recorded so they aren't re-litigated:**

- **Google Photorealistic 3D Maps** — true citywide photoreal imagery, but a Google-proprietary,
  **per-session-billed** dependency needing a Google Cloud project + keys and its own `Map3DElement`
  API. **Declined now; deferred, not deleted** — revisit only if the business decides photoreal
  citywide 3D is worth the cost and the vendor lock-in. Nothing in the MapLibre-native design
  blocks adding it later as an optional premium layer.
- **Cesium OSM Buildings / citywide 3D-Tiles building datasets** — global 3D building coverage,
  but (a) it is **comprehensive, not curated** — the opposite of our positioning; (b) it streams
  every building in a city when our itineraries only feature a handful of landmarks; (c) it adds a
  new account/dependency (Cesium ion / dataset hosting) for coverage the hand-curated landmark set
  doesn't need. **Declined for now.** MapLibre's own `fill-extrusion` over OpenFreeMap already
  gives us "enough" building massing for context, for free, with no extra account.

## 7. Near-term sequencing

Given the depth of the spec versus **Basic Access** (which gates the whole ingestion/CMS spine —
`TD-11`), the buildable, high-leverage path is:

1. **Ship the current slice.** Review the live affiliate links, then deploy (Roy's gate — see
   `no-deploy-without-go-ahead`). Banks `M4` + most of `M5`; starts the SEO clock and the
   traffic/data evidence for the Full-Access application.
2. **Light Viator enrichment.** Surface `fromPrice` / aggregate rating / free-cancellation —
   already returned by `/products/search` at Basic tier (see `06`), no duplicate-content risk.
3. **3D map POC** on one destination — the MapLibre-native curated-tour fly-through (§4): terrain
   + extrusion + a `flyTo` camera sequence, plus one or two hand-made GLTF landmark models.
   Buildable now, entirely inside MapLibre + OpenFreeMap + Three.js, with no Google dependency and
   nothing to pay for beyond one-time model sourcing/creation.
4. **Apply for Full Access** once live with some traffic.
5. **Then** the backend spine (`M1`/`M6`/`M7`) + the 2D clustered discovery map (`EP-7`) + the
   AI planner (`M8`).

Through-line: *don't build the backend into a wall.* At Basic Access the content + affiliate links
+ MapLibre 3D map are the product; the data-platform spine waits until Full Access can feed it.

> This sequencing lives here for now. It can be lifted into `01 §8 Roadmap` later if the canonical
> roadmap should carry it (that would mean splitting `M3` and marking Basic-Access gating on
> `M1`/`M6`/`M7` in the spine).
