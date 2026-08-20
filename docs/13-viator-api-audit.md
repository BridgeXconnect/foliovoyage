# Viator Partner API ingestion audit

> **Reader's note (added later):** this is a point-in-time snapshot from
> 2026-08-18, left intact as a record. Two things it flags as unresolved have
> since shipped: BRI-170's full-catalogue OOM mechanism (the `rawProducts.push`
> buffering it cites at `import.pipeline.ts:105-112` no longer exists — the crawl
> now streams per page and restarts per OS-process segment, BRI-170/176), and the
> missing `status` / `confirmationType` gates in "Additional bugs" #1–#2 (now
> handled explicitly by `scope-filter.ts`, BRI-171). Still open and accurate: the
> `/products/bulk` vs `/products/modified-since` policy contradiction, the
> `/availability/schedules/bulk` price-fetch win, and the missing request
> timeouts. See `docs/06` for the current pipeline shape.

**Date:** 2026-08-18
**Scope:** Every file in `apps/api/src/modules/import/` × the real, live Viator Partner API docs (fetched directly from `docs.viator.com/partner-api/technical/` this session — a JS-rendered Redoc page; `WebFetch` returns only the SPA shell, so this was done via a live browser render, not training-data recall).
**Trigger:** Two real bugs (BRI-165 wrong price path, BRI-170 unscoped full-catalog crawl/OOM) both traced to the pipeline being built against assumption/memory of the API rather than current docs. This is the line-by-line check against source.
**Companion:** `docs/06-viator-api-integration-guide.md` and `docs/07-viator-integration-brief.md` are stale (predate the monorepo move / current pipeline) — not used as a source here.

---

## Headline finding: the `/products/bulk` fix for BRI-170 is not as clean as it first looked — Viator's own docs contradict themselves

The task brief for this audit proposed a specific redesign: stop crawling `/products/modified-since` (full catalog) and instead use `/destinations` + `/products/search` (per-destination code discovery) + `/products/bulk` (content fetch for just the curated set), on the strength of one passage in Viator's **Workflows** guide. That passage is real. But it is contradicted by three other passages in the same documentation set, at the more authoritative (endpoint-reference) level. **I did not rewrite `import.pipeline.ts` or `viator.client.ts` this session** because of this contradiction — per the task brief's own instruction to stop and report rather than guess.

### The evidence, quoted exactly as fetched

**For:** `docs.viator.com/partner-api/technical/` → **Workflows → Ingesting and updating the product catalogue**:

> "The product catalog must be ingested and updated using the `/products/modified-since` endpoint, **unless you are only selling a relatively small subset of the products available in the Viator catalog. If that is the case, you may prefer to use the `/products/bulk` endpoint to ingest your selected products.**"

This is the passage the task brief was built on, and Atlas — 6 curated cities out of Viator's global catalog — is exactly the case it describes.

**Against — three separate places say the opposite, with no stated exception:**

1. **Key concepts → Product content endpoints** (the endpoint-selection overview):
   > "`/products/bulk`: Retrieve content for multiple products, as specified in the request. **Please note: This endpoint must not be used for ingestion; rather, it should only be used to retrieve product details for the selected products when needed.**"

2. **`/products/bulk` endpoint reference itself** (`POST /products/bulk`):
   > "**Note: This endpoint should not be used to ingest or update the product catalog. Instead, please use the `/products/modified-since` endpoint for that purpose.**"

3. **`/products/{product-code}` endpoint reference** carries the identical boilerplate note (not directly relevant to the bulk question, but shows this is a standard, deliberate phrase Viator attaches to every non-`modified-since` content endpoint).

None of these three carve out a "small subset" exception. All three are flatly worded.

**The contrast that makes this a genuine contradiction, not just my misreading:** the parallel guidance for *availability* is **not** contradictory. The `/availability/schedules/bulk` endpoint reference reads:

> "Note: This endpoint should not be used for ingesting or updating the availability and pricing details for **the entire catalog** of Viator products. Instead, please use the `/availability/schedules/modified-since` endpoint for that purpose."

That note is explicitly scoped to "the entire catalog" — leaving room for exactly the small-subset use the Workflows section describes. The product-content notes above have no such scoping; they are unconditional. So Viator's docs are internally consistent on the availability side (bulk is fine for a subset, forbidden only for full-catalog ingestion) and internally **inconsistent** on the product-content side (Workflows says subset-bulk is fine; three endpoint-level notes say bulk-for-ingestion generally is not fine, full stop).

**One more relevant fact, from the same Workflows section, immediately after the passage the task brief cites:**

> "Important: the `/products/{product-code}` endpoint should not be used for bulk ingestion purposes. **Your product ingestion/update strategy is one of our certification requirements and must be verified by us prior to your accessing the production server.** To find out what our certification requirements are, see: Viator Merchant API Certification."

Whatever strategy Atlas lands on is not purely an internal code decision — Viator's own process requires it to be reviewed and certified before production access. That's a strong reason to resolve the ambiguity with Viator directly (support/account manager) rather than pick a reading and build against it.

`/products/search` has the same "not for ingestion" framing as `/products/bulk`'s endpoint reference, with no small-subset exception either:

> "Returns a list of filtered, ordered and sorted product summaries for products that match the given search criteria. **This endpoint must not be used to ingest the catalog of products**, the `/products/modified-since` endpoint must be used for that purpose."

This is about ingesting the *catalog* via search, though — using `/products/search` once to **discover which product codes exist for a curated destination** (a lookup, not a recurring bulk-content ingest) reads as a materially different use from what that sentence forbids, and is exactly what BRI-165's verification script already did successfully. But note this is my inference from the sentence's wording, not something the docs state explicitly either way — flagging it as the same category of ambiguity, just smaller stakes.

### What I did confirm cleanly (no ambiguity)

- **Access tier is not a blocker.** Atlas is a Full-Access Affiliate (confirmed via the "Access to endpoints" table). Full-Access has ✅ on `/products/modified-since`, `/products/bulk`, `/products/search`, `/availability/schedules/{product-code}`, `/availability/schedules/bulk`, `/availability/schedules/modified-since`, `/locations/bulk`, and `/destinations`. Whichever model is chosen, nothing here is gated by tier.
- **`/destinations` confirms the curated-city registry.** The docs' own worked example table lists `type: CITY, destinationId: 343, destinationName: Bangkok` — an exact match for `curated-cities.ts`'s `primaryRef: "343"`. The `/destinations` response includes a `center` lat/lng per destination, matching how `curated-cities.ts` sources its `centroidLat`/`centroidLng`.
- **BRI-170's diagnosis (unbounded full-catalog crawl, buffered in memory) stands regardless of which fetch model is chosen.** `import.pipeline.ts` still calls `this.client.fetchModifiedSince()` with no destination scoping and pushes every page into one `rawProducts` array before any downstream stage runs (`import.pipeline.ts:105-112`) — the memory-growth mechanism BRI-170 flagged is unchanged today.

### Recommendation

Do not guess. Two ways to resolve this, not mutually exclusive:

1. **Ask Viator** (support / account manager, per the certification note above) to confirm explicitly whether a Full-Access Affiliate selling a small, fixed subset (~90 products across 6 destinations) is sanctioned to use `/products/bulk` for recurring content ingestion, given the Workflows-section exception. Get it in writing before building against it — it is a certification requirement anyway.
2. **In parallel, an interim fix for BRI-170's actual OOM mechanism is available that doesn't depend on resolving the contradiction at all**: keep `/products/modified-since` (unambiguously sanctioned for ingestion, this is not in dispute) but stop buffering the full crawl in memory — stream normalize/validate/upsert per page, or filter to `destination_refs ∩ CURATED_REFS` before accumulating, discarding non-curated products immediately rather than after the full crawl completes. This is the "filter earlier in the same pipeline" option the task brief pre-emptively ruled out — I'm surfacing it again only because the alternative it was ruled out in favor of turns out to be genuinely disputed in Viator's own docs, and BRI-170 (an OOM bug) is more urgent than the ingestion-model question. This does **not** address the "don't re-crawl the full catalog" efficiency/politeness guidance, only the crash.

I have not implemented either option. Both are scoping/policy decisions for Roy.

---

## File-by-file audit

| File | Verified correct against real docs | Found wrong / needs attention |
| --- | --- | --- |
| `normalizer.ts` | Every field path checked: `itinerary.duration.fixedDurationInMinutes` (confirmed present at this exact path across **all five** itinerary types — `STANDARD`, `ACTIVITY`, `MULTI_DAY_TOUR`, `HOP_ON_HOP_OFF`, `UNSTRUCTURED` — not just the one recorded payload the code comment cites); `reviews.combinedAverageRating` / `reviews.totalReviews`; `logistics.start[].location.ref`; `images[].isCover` / `.caption` / `.variants`; `destinations[].ref`; `pricingInfo` confirmed to hold no price field at any nesting (`type` + `ageBands` only) — BRI-165's fix is correct. | None found. See "Additional bugs" below for a gap that's adjacent but not in this file (confirmationType / status are never read at all, by any file). |
| `price-resolver.ts` | `/availability/schedules/{product-code}` response fields `currency` (top-level) and `summary.fromPrice` (major units) — code comment claims live verification against product 57189P2; docs don't contradict this (the bulk variant's response schema is a collapsed `{}` in the rendered docs, but is explicitly the same `ProductAvailabilitySchedule` array-of-objects shape per-product). | `/availability/schedules/bulk` exists, is Full-Access-tier accessible, and its own endpoint note only forbids "entire catalog" use — unlike `/products/bulk`, there is **no documented contradiction** blocking its use for Atlas's ~90-product curated set. Per-product fanout (one `/availability/schedules/{code}` call per tour, `DEFAULT_PRICE_RESOLVER_CONCURRENCY = 5`) is exactly the "real scaling concern" the code's own comment flags. Switching to `/availability/schedules/bulk` (500 codes/request) is a real, low-risk win — but the exact bulk response envelope needs one live call to verify before implementing (same discipline as BRI-165/163's live verification), not a doc-only guess. **Flagged as a follow-up, not implemented this session.** |
| `location-resolver.ts` | `/locations/bulk` request/response shape, the `TRIPADVISOR` vs `GOOGLE` provider split, and the 500-reference limit are all confirmed **exactly** against the docs' own worked example (a `GOOGLE` location returning only `provider` + `providerReference`, a Google Place ID, no `center`; a `TRIPADVISOR` location returning full `address` + `center`). The code's handling (`toResolvedLocation` returns `null` for a center-less item, logged at `debug` not `warn`) matches the docs' framing that this is a structural, expected outcome, not an error. | None found. This file is a model example of "verified against live payload" holding up against the docs too. |
| `curated-cities.ts` | `/destinations` taxonomy confirmed: `destinationId` is the correct identifier type, Bangkok = `343` (`CITY`) matches the docs' own example table exactly. `center` lat/lng per destination confirmed as the source `curated-cities.ts` claims for its centroids. | None found. |
| `validator.ts` | Coordinate/price/title quarantine rules don't reference any Viator-specific field path directly (they operate on the already-normalized `TourDTO`), so there's nothing to check against the OTA docs here. | Doesn't quarantine or filter on `bookingConfirmationSettings.confirmationType` or `status`. See "Additional bugs" — likely benign today but worth an explicit gate. |
| `import.pipeline.ts` | Orchestration order (fetch → normalize → resolve locations → resolve prices → validate → upsert → link) is sound and matches the dependency order the docs imply (coordinates and prices are genuinely separate calls, as `normalizer.ts`'s comments already established). | Buffers the entire crawl into one in-memory array before any downstream stage (`rawProducts.push(...page.products)`, no destination filter) — this is BRI-170's actual OOM mechanism, unresolved regardless of the fetch-model question above. |
| `clients/viator.client.ts` | Headers (`exp-api-key`, `Accept: application/json;version=2.0`, `Accept-Language`), 429/5xx retry-with-backoff-and-jitter, and honoring `Retry-After` are all correct per the docs' Rate limiting section. `RateLimit-Limit/Remaining/Reset` response headers are documented as "for informational purposes only" — not consuming them is fine, not a gap. | **No request timeout is configured anywhere** in the client (no `AbortController`/`signal` on the `fetch` calls in `viator.client.ts`, `price-resolver.ts`, or `location-resolver.ts`) — see "Additional bugs." |
| `http/allowlist-fetch.ts` | Not Viator-API-shape-dependent; SSRF-safety review is out of scope for this audit (it's a generic host-allowlist, not tied to Viator's response format). | Same missing-timeout gap as above — this is the shared fetch layer, so the fix belongs here. |
| `experience-linker.ts` | Consumes `destinationRefs` (from `normalizer.ts`) and the curated-city registry; no direct Viator field access of its own. | None found. |
| Env config (`VIATOR_API_LANGUAGE`) | Defaults to `"en-US"`, sent as `Accept-Language` on every request. Atlas is single-locale (no i18n in `apps/web` today), so this is the minimum necessary, not wasteful. | None found — the task brief's concern here doesn't apply; there's nothing to trim. |

---

## Additional bugs found (each scoped separately, not fixed this session)

### 1. No `confirmationType` filtering — likely benign for Atlas's access tier, but a product decision, not a clear bug

The docs are explicit and unconditional:

> "Unless you have established the required functionality on your site to sell manual confirmation products **you will need to exclude all non-instant confirmation products from your catalogue.** ... Products with a `confirmationType` of `"MANUAL"` or `"INSTANT_THEN_MANUAL"` should be excluded if you do not wish to sell manual confirmation products."

Checked `normalizer.ts`, `validator.ts`, and `import.pipeline.ts` — none of them read `bookingConfirmationSettings.confirmationType` at all. Every ingested tour that otherwise passes validation is treated identically regardless of confirmation type.

**Why this may not matter for Atlas specifically:** the docs frame this guidance around partners who process the booking flow themselves and need to build UI/UX for a "pending confirmation" state. Atlas is a Full-Access Affiliate — per the "Access to endpoints" table, Full-Access affiliates have **no access to any booking endpoint** (`/bookings/*` are all ❌). Atlas never processes a booking; every affiliate CTA link-throughs to `viator.com`, where Viator's own site handles whatever confirmation flow the product requires. So the "you will need to build support for X" framing may not literally apply.

**Why it might still matter:** if Atlas's cards display a tour as bookable-now (e.g. instant-badge styling, "usually confirmed within minutes" copy) and the underlying product actually requires `MANUAL` confirmation, that's a UX/trust mismatch surfaced after the user clicks through — Atlas's problem even though Viator owns the booking mechanics. This is a product call, not something the docs settle either way for a pure link-through affiliate. **Flagging for Roy's decision, not implementing a filter.**

### 2. No explicit `status === "ACTIVE"` gate — works today, but by accident

The docs are explicit:

> "products with a `status` of `"INACTIVE"` are products that have been temporarily disabled by the supplier and are therefore unavailable – when this is the case, **all other requests for this product should be avoided.**"

Confirmed via the docs' own worked example that an `INACTIVE` product record carries **only** `status`, `productCode`, `language`, `createdAt`, `lastUpdatedAt` — every other field, including `title`, is absent ("remainder of object will be empty").

`normalizer.ts` never reads `raw["status"]`. But `requireString(raw, "title")` throws for any product missing `title` — which every `INACTIVE` product is, per the docs. `import.pipeline.ts`'s normalize loop catches that throw and skips the product with a log line (`import.pipeline.ts:119-127`), so an `INACTIVE` product never reaches `location-resolver.ts` or `price-resolver.ts` — which accidentally satisfies "all other requests for this product should be avoided." And because the skipped product never enters `dtos`, it's absent from the upsert's incoming-id set, so a tour that flips `ACTIVE → INACTIVE` between runs gets correctly soft-deleted by `upsert.ts`'s diff logic (`planDeletion`).

**So the observable behavior is already correct.** But it's an accident of two unrelated design choices (title is `NOT NULL`-required; INACTIVE payloads omit title) rather than an intentional check. It's fragile: if Viator ever changes what fields an `INACTIVE` payload includes (e.g. adds back a stale cached `title`), this safety net silently stops working with no test to catch it. **Low-severity — recommend an explicit `raw["status"] !== "ACTIVE"` early-return in the normalizer (or a dedicated skip-reason distinct from "unnormalizable"), not urgent.** Not fixed this session since it's not causing an observed failure.

### 3. No request timeout configured on any Viator call

Checked `viator.client.ts`, `price-resolver.ts`, and `location-resolver.ts` — none pass `signal`/`AbortController` to `AllowlistFetch.fetch`, and `AllowlistFetch.fetch` itself (`http/allowlist-fetch.ts`) doesn't apply a default timeout either. Every outbound call relies on whatever the platform `fetch` (Node 22 undici) does by default, which is effectively "wait indefinitely" absent an explicit timeout.

The docs' own timeout guidance:

> "If you wish to implement internal timeout settings for calls to this API, we recommend a setting of 120s. This is due to the fact that some of the products in our inventory rely on the operation of external supplier systems... it may take up to 120s to receive a response **when making a booking**."

This note lives in the general "Conventions" section (worded as "calls to this API", not scoped to booking endpoints), but its justification is entirely about booking-flow latency against external supplier systems — a concern that doesn't obviously apply to `/products/modified-since`, `/availability/schedules/{code}`, or `/locations/bulk`, none of which touch a live supplier system at request time. So the task brief's hypothesis (timeout copied from booking guidance) turned out to be reversed: **there's no timeout configured at all**, not one wrongly copied from booking guidance. A content/price/location call that hangs — a stalled TCP connection, a slow proxy — currently blocks that pipeline stage indefinitely, with no cap. Given `price-resolver.ts` and `location-resolver.ts` run bounded-concurrency pools (`mapWithConcurrency`), one hung request can occupy a concurrency slot forever and stall the whole run.

**Recommend a timeout meaningfully shorter than 120s for these three read-only, non-booking endpoints** (the 120s figure is Viator's own booking-specific ceiling, not a floor Atlas needs to match) — a few seconds to tens of seconds, tunable, is more appropriate. Not fixed this session — scoping the actual value is a judgment call, not a docs lookup.

---

## What was intentionally *not* done this session

- **`import.pipeline.ts` and `viator.client.ts` were not rewritten.** The `/products/bulk` fetch-model question is genuinely unresolved by Viator's own documentation (see headline finding) — implementing either interpretation without resolving the contradiction would repeat the exact failure mode (building against assumption) that this audit exists to correct.
- **No `confirmationType` filter, `status` gate, or timeout was added.** Each is flagged above as its own scoped, independently-decidable item, per the instruction not to bundle a real rewrite into this pass.
- **Linear was not touched**, per instruction — this doc is the handoff; Roy will translate into issues.
