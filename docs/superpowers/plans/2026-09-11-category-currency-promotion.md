# Category, Currency & Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop discarding Viator category `tags`, make price bands currency-correct across a multi-currency catalogue, and make Experience publication automatic against concrete evidence-based criteria — so the 29,624-row backlog and every future import promote themselves without a human reviewing rows one at a time.

**Architecture:** Three tracks land in the existing `apps/api` NestJS ingest pipeline. **(A) Tags capture** adds a raw `tags Int[]` column filled by the pure normalizer — a self-contained schema+normalizer change that ends the silent data loss and unblocks a later resolution stage. **(B) Currency** adds a Viator-`/exchange-rates`-backed FX cache and a `priceReferenceMinor` (USD) column computed at ingest, then repoints the currency-blind `priceBandFromMinor` and the search SQL at that reference column and back-fills the existing rows. **(C) Promotion** replaces the manual single-id promote CLI's role with an automatic, criteria-gated promoter that runs after the linker on every import and once against the backlog.

**Tech Stack:** NestJS, Prisma (PostgreSQL/Neon), Zod, `undici` via the existing SSRF-safe `AllowlistFetch`, Jest. No new runtime dependencies.

**Spec:** This plan itself is the spec — it consolidates three confirmed research findings (see "Confirmed research" below). There is no separate design doc; the reasoning travels inline.

## Global Constraints

- **Node 22, pnpm 11.** Run everything from the repo root or with `pnpm --filter @folio/api`. Local dev/tests that touch config or the API need Doppler: `doppler run -- pnpm --filter @folio/api ...`.
- **Ownership boundary (docs/02 §1.3) is load-bearing.** The pure `normalizer.ts` sets **only** provider-sourced + provenance fields; it never touches Atlas-owned fields (editor rating, curated tags, slug, curation status, `experienceId`). Raw provider `tags` (numeric IDs) are provider-sourced provenance and belong on `Tour`; a resolved Atlas *category* is Atlas-owned and does **not** land in this plan (see Decision 1, Stage B deferral).
- **`normalizer.ts` stays pure.** No DB, network, clock, or filesystem access. Anything needing the network (FX conversion, price) is an attach-after-normalize step in `import.pipeline.ts`, mirroring the existing `attachLocations`/`attachPrices` pattern.
- **New env vars go in `apps/api/src/config/env.validation.ts`** (the single Zod-validated env surface), never ad-hoc `process.env` reads. Document them in `apps/api/.env.example`.
- **New Viator HTTP goes through `AllowlistFetch`** (DI token `VIATOR_HTTP`), locked to the Viator API host — same guard the crawl, location resolver, and price resolver use.
- **Migrations must apply cleanly** via `prisma migrate deploy` (CI's `migrate` job runs this against a throwaway `postgis/postgis:16-3.4`). Create them with `pnpm --filter @folio/api exec prisma migrate dev`.
- **Do not deploy.** Build/verify locally only until Roy gives the go-ahead. Do not touch Linear.
- **Attribution** on commits: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Confirmed research (read before starting — do not re-derive)

All three findings were confirmed against the real code in this repo and Viator's authoritative docs on 2026-09-11.

**Category / tags**
- Product detail payloads carry a **top-level `tags` array of integers**, e.g. `[12075, 11929, 367654, …]` — verified in the recorded fixture `apps/api/src/modules/import/__fixtures__/viator-product-57189P2.json`. The normalizer currently **never reads it**, so every import silently discards it.
- `/products/tags` maps tag IDs → names + hierarchy and **must be cached and refreshed weekly** (Viator: tag data rarely changes; weekly is sufficient). Some tags are **"not for partner use" / internal** and must never be surfaced. Ref: <https://partnerresources.viator.com/travel-commerce/tags/>.

**Currency**
- The cheap "pin one currency at the source" fix is **not available**. `/availability/schedules/*` returns `fromPrice` **in the supplier's currency, which varies by product**; partners **cannot** request a currency for schedule responses. Viator's own guidance: use the **`/exchange-rates`** endpoint to convert. (Confirmed at <https://partnerresources.viator.com/travel-commerce/merchant/pricing/>.)
- `/exchange-rates` takes `sourceCurrencies[]` + `targetCurrencies[]` and returns rate objects with `rate`, `lastUpdated`, and an **`expiry`** UTC timestamp ("indicates until when the conversion rate is valid"). Rates update **daily** today, "but this frequency may change" — so the refresh rule is **honor `expiry`**, not a hard-coded interval.
- `priceBandFromMinor` (`apps/api/src/destinations/destination.service.ts:145`) is **currency-blind**: it divides `priceMinor` by 100 and compares against USD thresholds (`$≤40, $$≤120, $$$≤300`) regardless of `Tour.currency`. The search filter SQL (`apps/api/src/search/search.service.ts`, `priceBandSqlCondition` + the LATERAL joins selecting `tour."priceMinor"`) has the **same** blindness. This mis-bands every non-USD row across the existing **29,624** `Tour` rows.

**Promotion**
- `ExperienceLinker.linkRun` (`apps/api/src/modules/import/experience-linker.ts`) auto-creates one `draft` `Experience` per curated-city tour. `promote-experience.service.ts` flips **one** Experience `draft → published` **by id** — a manual stand-in for Admin review (M7, which does not exist). Reviewing 29,624+ rows by hand is infeasible.
- `Experience` has `title`, `description`, `status`, `latitude/longitude`; it has **no category column and no price** — image/price/`affiliateUrl` live on the linked `Tour` (`imageUrl`, `priceMinor`/`priceReferenceMinor`, `affiliateUrl`). The public read path already shows only `published` rows.

---

## The three decisions (stated, not offered as options)

**Decision 1 — Category, in two stages; only Stage A is in scope here.**
- **Stage A (this plan):** capture the raw numeric `tags` array onto `Tour` now. It ends the silent data loss and makes Stage B possible **without re-crawling** — future imports carry tags, and because `tags` joins the content `source_hash`, the next crawl re-upserts existing rows with their tags populated.
- **Stage B (explicitly DEFERRED to its own follow-up plan):** the `/products/tags` client, a weekly-refreshed tag-name cache, the crosswalk from Viator's tag hierarchy onto the 9 `ExperienceCategory` values, exclusion of the restricted "not for partner use" set, an Atlas-owned category column on `Experience`, and its backfill. Rationale: Stage B is a whole integration (new endpoint, cache model, weekly scheduler, crosswalk, Atlas-owned column + backfill) of comparable size to this entire plan; bundling it would violate the "sequence in two real stages, don't do it all at once" instruction and delay the shippable A+B(currency)+C unit. Stage A is deliberately safe and independent so Stage B can follow cleanly.

**Decision 2 — Currency: build the real FX system, because the cheap fix is confirmed closed.**
- Cache Viator `/exchange-rates` in a `ProviderExchangeRate` table, refresh **by honoring each rate's `expiry`** (real source, reasoned cadence — not arbitrary).
- Compute a **bandable USD reference value at ingest time** (`Tour.priceReferenceMinor`), stored alongside `priceMinor`/`currency`, **not** recomputed per request.
- Fix `priceBandFromMinor`'s currency-blindness **as its own task**: repoint it and the search SQL at `priceReferenceMinor`, and **back-fill the reference value for the existing 29,624 rows**. Rows whose currency has no rate get a null reference → a null band (honest, never a fabricated band).

**Decision 3 — Promotion: automatic, evidence-based, no per-row human gate.**
- Final rule set (an Experience is promoted `draft → published` iff **all** hold): non-empty `title`; non-empty `description`; a linked active `Tour` with a real `imageUrl`; that Tour has a real `affiliateUrl`; that Tour has a **non-degenerate price band** (`priceReferenceMinor` present and `> 0`, so `priceBandFromMinor` returns a real band).
- **Category is deliberately NOT a gate yet** — it depends on Stage B, which is deferred. When Stage B lands, "category resolved" is added as the sixth gate (noted in Task 8).
- Runs automatically after `ExperienceLinker` on every import run, and once via a backfill CLI against the existing backlog. Idempotent and one-directional (never un-publishes), matching the existing promoter's semantics. The manual single-id CLI stays as an override.

## Sequencing (reasoned dependency order)

- **Track A — Task 1 (tags capture).** Depends on nothing. Parallel.
- **Track B — Tasks 2 → 3 → 4 → 5 → 6 (currency).** Task 2 (FX cache + resolver) and Task 4 (reference column + ingest wiring) precede Task 5 (band fix) which precedes Task 6 (backfill). Independent of Track A.
- **Track C — Tasks 7 → 8 → 9 (promotion).** The price-band gate needs the reference value **and** the fixed band, so **promotion depends on the currency fix (Tasks 4–6) landing first**. It does **not** depend on Track A: because Stage B (category resolution) is deferred, the category gate is deferred with it, so tags-capture is **not** a promotion prerequisite. (This is the one place the plan diverges from the original "promotion depends on both" framing — that framing assumed Stage B fed promotion; with Stage B deferred, promotion's only hard dependency is currency.)

Recommended order: **1 ∥ 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**. Task 1 can be done any time by a second worker.

## File Structure

New files:
- `apps/api/src/modules/import/exchange-rate-resolver.ts` — fetches `/exchange-rates`, caches in `ProviderExchangeRate`, honors `expiry`, exposes `rateToUsd(currency)`.
- `apps/api/src/modules/import/exchange-rate-resolver.spec.ts` — unit tests (fake fetch + fake cache).
- `apps/api/src/modules/import/reference-price.ts` — pure `computeReferenceMinor(priceMinor, rate)` + the `attachReferencePrices` batch step.
- `apps/api/src/modules/import/reference-price.spec.ts`.
- `apps/api/src/modules/import/backfill-reference-price.cli.ts` — one-time backfill over existing `Tour` rows.
- `apps/api/src/modules/import/experience-auto-promoter.ts` — pure `isPromotable()` predicate + `promoteEligible(provider)`.
- `apps/api/src/modules/import/experience-auto-promoter.spec.ts`.
- `apps/api/src/modules/import/promote-eligible.cli.ts` — one-time backlog promotion.

Modified files:
- `apps/api/prisma/schema.prisma` — `Tour.tags`, `Tour.priceReferenceMinor`, `Tour.priceReferenceCurrency`, new `ProviderExchangeRate` model (three migrations).
- `apps/api/src/modules/import/normalizer.ts` — extract `tags`; add to `TourDTO`, `TourContent`, `hashContent`.
- `apps/api/src/modules/import/upsert.ts` — map `tags` + reference columns in `toColumns`.
- `apps/api/src/modules/import/import.pipeline.ts` — call `attachReferencePrices` after `attachPrices`.
- `apps/api/src/modules/import/import-run.service.ts` — call auto-promoter after `ExperienceLinker`.
- `apps/api/src/modules/import/import.module.ts` / `import-core.module.ts` — wire the new resolver + promoter (DI).
- `apps/api/src/destinations/destination.service.ts` — `priceBandFromMinor` doc + callers read `priceReferenceMinor`.
- `apps/api/src/search/search.service.ts` — band SQL + row select + `toExperienceResult` read `priceReferenceMinor`.
- `apps/api/src/config/env.validation.ts` + `apps/api/.env.example` — FX + promotion env.

---

### Task 1: Capture Viator raw `tags` onto `Tour` (Decision 1, Stage A)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Tour` model, after `destinationRefs`, ~line 189)
- Modify: `apps/api/src/modules/import/normalizer.ts`
- Modify: `apps/api/src/modules/import/upsert.ts:339-360` (`toColumns`)
- Test: `apps/api/src/modules/import/normalizer.spec.ts`

**Interfaces:**
- Produces: `TourDTO.tags: number[]` (empty array when absent); `Tour.tags Int[] @default([])`; `tags` is part of `source_hash`.

- [ ] **Step 1: Write the failing test** — add to `normalizer.spec.ts`:

```ts
it("captures the top-level numeric tags array", () => {
  const dto = normalizeViatorProduct(
    { productCode: "P1", title: "T", tags: [12075, 11929, 367654] },
    { fetchedAt: "2026-07-25T00:00:00Z" },
  );
  expect(dto.tags).toEqual([12075, 11929, 367654]);
});

it("defaults tags to an empty array when absent or malformed", () => {
  const base = { productCode: "P1", title: "T" };
  expect(normalizeViatorProduct(base, { fetchedAt: "2026-07-25T00:00:00Z" }).tags).toEqual([]);
  expect(
    normalizeViatorProduct({ ...base, tags: ["x", 5, null, 7.9] }, { fetchedAt: "2026-07-25T00:00:00Z" }).tags,
  ).toEqual([5, 7]); // non-integers dropped, floats truncated
});

it("includes tags in the source hash (a tag change is a content change)", () => {
  const ctx = { fetchedAt: "2026-07-25T00:00:00Z" };
  const a = normalizeViatorProduct({ productCode: "P1", title: "T", tags: [1] }, ctx);
  const b = normalizeViatorProduct({ productCode: "P1", title: "T", tags: [2] }, ctx);
  expect(a.source_hash).not.toBe(b.source_hash);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/normalizer.spec.ts -t tags`
Expected: FAIL — `dto.tags` is `undefined`.

- [ ] **Step 3: Implement in `normalizer.ts`**

Add to the `TourDTO` interface (near `destination_refs`):

```ts
  /**
   * Provider category tag IDs, verbatim from the payload's top-level `tags`
   * array, e.g. `[12075, 11929, 367654]`. Opaque numeric IDs — resolving them
   * to names/categories via `/products/tags` is a deferred follow-up (Stage B).
   * Captured here (Stage A) so future data isn't silently discarded. Empty when
   * absent. Part of {@link source_hash}: a change in a product's tags is a
   * content change.
   */
  tags: number[];
```

Add an extractor:

```ts
/** The product's top-level `tags` array (opaque numeric IDs). Non-integers are
 * dropped and floats truncated; empty array when absent. */
function extractTags(raw: ViatorProduct): number[] {
  const tags = raw["tags"];
  if (!Array.isArray(tags)) return [];
  const out: number[] = [];
  for (const t of tags) {
    if (typeof t === "number" && Number.isFinite(t)) out.push(Math.trunc(t));
  }
  return out;
}
```

In `normalizeViatorProduct`, add `tags: extractTags(raw),` to the `content` object. In the `TourContent` `Omit` type, nothing changes (tags stays in content). In `hashContent`, append `content.tags` to the canonical array (last element).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/api exec jest src/modules/import/normalizer.spec.ts`
Expected: PASS (existing hash-stability tests may assert specific hashes — if any hard-code a hash string, update the expected value to the new hash).

- [ ] **Step 5: Add the column + migration**

In `schema.prisma`, add to `Tour` after `destinationRefs`:

```prisma
  /// Provider category tag IDs, verbatim from the product payload's top-level
  /// `tags` array (BRI-XXX Stage A). Opaque numeric IDs; name/category
  /// resolution via `/products/tags` is a deferred follow-up. Empty when absent.
  tags            Int[]       @default([])
```

Map it in `upsert.ts` `toColumns`: add `tags: tour.tags,`.

Run: `doppler run -- pnpm --filter @folio/api exec prisma migrate dev --name add_tour_tags`

- [ ] **Step 6: Verify upsert + build**

Run: `pnpm --filter @folio/api exec jest src/modules/import/upsert.spec.ts && pnpm --filter @folio/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/import/normalizer.ts apps/api/src/modules/import/upsert.ts apps/api/src/modules/import/normalizer.spec.ts
git commit -m "feat(import): capture Viator raw tags onto Tour (category Stage A)"
```

---

### Task 2: `ProviderExchangeRate` cache + `ExchangeRateResolver` (Decision 2)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (new model)
- Modify: `apps/api/src/config/env.validation.ts`, `apps/api/.env.example`
- Create: `apps/api/src/modules/import/exchange-rate-resolver.ts`
- Test: `apps/api/src/modules/import/exchange-rate-resolver.spec.ts`

**Interfaces:**
- Produces: `ProviderExchangeRate` model; `class ExchangeRateResolver` with:
  - `constructor(config: ExchangeRateConfig, http: AllowlistFetch, cache: ExchangeRateCache)`
  - `async ratesToUsd(sourceCurrencies: string[]): Promise<Map<string, number>>` — returns `sourceCurrency → rate` (multiply a source-currency major amount by this to get USD major). `"USD"` maps to `1`. A currency that can't be resolved is absent from the map.
- Consumes: `AllowlistFetch` (existing, `./http/allowlist-fetch`).

- [ ] **Step 1: Add config + `.env.example`**

In `env.validation.ts` add (near the other `VIATOR_*` keys):

```ts
  /** Reference currency all price bands are computed in. */
  PRICE_REFERENCE_CURRENCY: z.string().length(3).default("USD"),
```

`VIATOR_API_KEY`, `VIATOR_API_BASE_URL`, `VIATOR_API_LANGUAGE` already exist and are reused. Document `PRICE_REFERENCE_CURRENCY` in `.env.example`.

- [ ] **Step 2: Add the model + migration**

In `schema.prisma`:

```prisma
/// Cached Viator FX rate (BRI-XXX). `/availability/schedules` returns `fromPrice`
/// in the *supplier's* currency, which varies per product and cannot be pinned,
/// so Atlas converts to a single reference currency (USD) via Viator's
/// `/exchange-rates` endpoint. Rates carry an `expiry` (Viator updates daily
/// today, "may change"): a row is refreshed only once `now > expiresAt`, never
/// on a fixed interval. Keyed on the currency pair.
model ProviderExchangeRate {
  provider      String   @default("viator")
  /// ISO-4217 source currency (the supplier's), e.g. "THB".
  sourceCurrency String
  /// ISO-4217 target currency; always the reference currency ("USD") today.
  targetCurrency String
  /// Multiply a source-currency major amount by this to get a target-currency
  /// major amount.
  rate          Float
  /// Viator's `lastUpdated` for this rate (UTC).
  lastUpdatedAt DateTime
  /// Viator's `expiry` (UTC): the rate is valid until this instant. The refresh
  /// trigger — a row with `expiresAt <= now` is re-fetched before use.
  expiresAt     DateTime
  /// When Atlas last wrote this row.
  fetchedAt     DateTime @default(now()) @updatedAt

  @@id([provider, sourceCurrency, targetCurrency])
}
```

Run: `doppler run -- pnpm --filter @folio/api exec prisma migrate dev --name add_provider_exchange_rate`

- [ ] **Step 3: Write the failing resolver test** (`exchange-rate-resolver.spec.ts`)

Cover: (a) `"USD"` resolves to `1` without any fetch; (b) a fresh cached rate (`expiresAt` in the future) is used without a fetch; (c) an expired or missing rate triggers one `/exchange-rates` fetch, is written to the cache, and returned; (d) a currency the endpoint doesn't return is absent from the result map; (e) a fetch failure leaves that currency absent (never throws). Use a fake `http` returning a canned envelope and an in-memory `ExchangeRateCache`.

```ts
it("returns 1 for USD and never fetches", async () => {
  const http = { fetch: jest.fn() };
  const r = new ExchangeRateResolver(cfg, http as any, memCache());
  expect((await r.ratesToUsd(["USD"])).get("USD")).toBe(1);
  expect(http.fetch).not.toHaveBeenCalled();
});

it("fetches and caches a missing rate", async () => {
  const http = { fetch: jest.fn().mockResolvedValue(okJson({
    rates: [{ sourceCurrency: "THB", targetCurrency: "USD", rate: 0.028,
              lastUpdated: "2026-09-11T00:00:00Z", expiry: "2026-09-12T00:00:00Z" }],
  })) };
  const cache = memCache();
  const r = new ExchangeRateResolver(cfg, http as any, cache);
  expect((await r.ratesToUsd(["THB"])).get("THB")).toBeCloseTo(0.028);
  expect(await cache.get("THB")).toBeTruthy();
});
```

(`okJson`, `memCache` are small local helpers in the spec.)

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/exchange-rate-resolver.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `exchange-rate-resolver.ts`**

Define a small `ExchangeRateCache` interface (`get(source)`, `upsert(row)`) and a Prisma-backed impl reading/writing `ProviderExchangeRate`. Implement `ratesToUsd`:
1. Normalize/unique the input list; drop `USD` (maps to `1`).
2. For each remaining currency, read the cache; if a row exists and `expiresAt > now`, use it.
3. Batch-fetch the rest via `GET {baseUrl}/exchange-rates?sourceCurrencies=<A>&sourceCurrencies=<B>&targetCurrencies=USD` (SSRF-safe `http.fetch`, same headers as `price-resolver.ts`: `exp-api-key`, `Accept: application/json;version=2.0`, `Accept-Language`). Wrap in try/catch — on any failure, log a warning and leave those currencies unresolved (never throw).
4. Validate the response with a Zod schema (`rates: [{ sourceCurrency, targetCurrency, rate, lastUpdated, expiry }]`), upsert each into the cache, and add to the result map.

> **Verification step (do this first, before writing the schema):** the exact request shape (GET query-array vs POST body) and response envelope key (`rates` vs a bare array) must be confirmed with **one live `/exchange-rates` call** using the Doppler-injected key — the same live-verification discipline BRI-165/163 used and that `docs/13` flags for any new Viator endpoint. Adjust the URL builder and Zod schema to the observed shape; the surrounding cache/expiry logic is unaffected.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @folio/api exec jest src/modules/import/exchange-rate-resolver.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/config/env.validation.ts apps/api/.env.example apps/api/src/modules/import/exchange-rate-resolver.ts apps/api/src/modules/import/exchange-rate-resolver.spec.ts
git commit -m "feat(import): Viator /exchange-rates FX cache + resolver"
```

---

### Task 3: `priceReferenceMinor` column + `computeReferenceMinor` (pure)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Tour`)
- Modify: `apps/api/src/modules/import/normalizer.ts` (`TourDTO` fields only — left null by the pure normalizer)
- Modify: `apps/api/src/modules/import/upsert.ts` (`toColumns`)
- Create: `apps/api/src/modules/import/reference-price.ts`
- Test: `apps/api/src/modules/import/reference-price.spec.ts`

**Interfaces:**
- Produces: `Tour.priceReferenceMinor BigInt?`, `Tour.priceReferenceCurrency String? @default("USD")`; `TourDTO.price_reference_minor: number | null`, `TourDTO.price_reference_currency: string | null`; pure `computeReferenceMinor(priceMinor: number | null, rate: number | undefined): number | null`.
- Consumes: `ExchangeRateResolver.ratesToUsd` (Task 2) — used by the batch step in Task 4, not here.

- [ ] **Step 1: Write the failing test** (`reference-price.spec.ts`)

```ts
import { computeReferenceMinor } from "./reference-price";

it("converts a supplier minor amount to USD minor via the rate", () => {
  // 500000 minor THB = 5000.00 THB major; ×0.028 = 140.00 USD → 14000 USD minor
  expect(computeReferenceMinor(500000, 0.028)).toBe(14000);
});
it("is identity at rate 1 (USD source)", () => {
  expect(computeReferenceMinor(2800, 1)).toBe(2800);
});
it("returns null when price or rate is missing", () => {
  expect(computeReferenceMinor(null, 0.028)).toBeNull();
  expect(computeReferenceMinor(2800, undefined)).toBeNull();
});
```

Rationale for the formula: `priceMinor` is always `fromPriceMajor × 100` (uniform, exponent-agnostic — set that way by `price-resolver.ts` `toResolvedPrice`). USD minor = `round((priceMinor / 100) × rate × 100)` = `round(priceMinor × rate)`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/reference-price.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeReferenceMinor` in `reference-price.ts`**

```ts
/** Convert a supplier "from" price in minor units to reference-currency (USD)
 * minor units via an FX rate. Null in / no rate → null out (never fabricated).
 * `priceMinor` is uniformly `major × 100`, so USD minor = round(priceMinor × rate). */
export function computeReferenceMinor(
  priceMinor: number | null,
  rate: number | undefined,
): number | null {
  if (priceMinor === null || rate === undefined || !Number.isFinite(rate)) return null;
  return Math.round(priceMinor * rate);
}
```

- [ ] **Step 4: Add DTO fields + column + mapping**

In `normalizer.ts` `TourDTO`, add (documented as resolved-after-normalization, like price):

```ts
  /** "From" price converted to the reference currency (USD) in minor units, or
   * null when unpriced or no FX rate was available. NOT set by the pure
   * normalizer — attached after price resolution by the reference-price step,
   * exactly like price/coords. Excluded from source_hash (volatile). */
  price_reference_minor: number | null;
  /** Reference currency for {@link price_reference_minor} ("USD"), or null. */
  price_reference_currency: string | null;
```

Set both to `null` in the returned object of `normalizeViatorProduct` (alongside `price_minor: null`). Add both to the `TourContent` `Omit` list (so they're excluded from the hash, like `price_minor`/`currency`).

In `schema.prisma` `Tour`, after `currency`:

```prisma
  /// "From" price converted to the reference currency (USD) in minor units, or
  /// null when unpriced / no FX rate (BRI-XXX). This — not the supplier-currency
  /// `priceMinor` — is what price bands are computed from, so a band is currency-
  /// correct across a multi-currency catalogue. Computed at ingest, never per-request.
  priceReferenceMinor    BigInt?
  /// Reference currency of {@link priceReferenceMinor}; "USD" today.
  priceReferenceCurrency String?  @default("USD")
```

In `upsert.ts` `toColumns`, add `priceReferenceMinor: tour.price_reference_minor,` and `priceReferenceCurrency: tour.price_reference_currency,`.

Run: `doppler run -- pnpm --filter @folio/api exec prisma migrate dev --name add_tour_price_reference`

- [ ] **Step 5: Run to verify + typecheck**

Run: `pnpm --filter @folio/api exec jest src/modules/import/reference-price.spec.ts && pnpm --filter @folio/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/import/normalizer.ts apps/api/src/modules/import/upsert.ts apps/api/src/modules/import/reference-price.ts apps/api/src/modules/import/reference-price.spec.ts
git commit -m "feat(import): add priceReferenceMinor column + pure USD conversion"
```

---

### Task 4: Attach reference prices in the pipeline

**Files:**
- Modify: `apps/api/src/modules/import/reference-price.ts` (add the batch step)
- Modify: `apps/api/src/modules/import/import.pipeline.ts` (call after `attachPrices`, ~line 359)
- Modify: `apps/api/src/modules/import/import.module.ts` + `import-core.module.ts` (DI wiring)
- Test: `apps/api/src/modules/import/reference-price.spec.ts`

**Interfaces:**
- Produces: `class ReferencePriceResolver { attachReferencePrices(tours: TourDTO[]): Promise<TourDTO[]> }` — reads each tour's `currency`, resolves all needed rates once via `ExchangeRateResolver.ratesToUsd`, fills `price_reference_minor` + `price_reference_currency`, returns new DTOs (input not mutated). Tours with no price/currency or no rate come back with reference `null`.
- Consumes: `ExchangeRateResolver` (Task 2), `computeReferenceMinor` (Task 3), `TourDTO` (`price_minor`, `currency`).

- [ ] **Step 1: Write the failing test**

```ts
it("attaches USD reference prices for a mixed-currency batch", async () => {
  const resolver = { ratesToUsd: jest.fn().mockResolvedValue(new Map([["THB", 0.028], ["USD", 1]])) };
  const step = new ReferencePriceResolver(resolver as any, "USD");
  const out = await step.attachReferencePrices([
    dto({ currency: "THB", price_minor: 500000 }),
    dto({ currency: "USD", price_minor: 2800 }),
    dto({ currency: "EUR", price_minor: 5000 }), // no rate → null reference
    dto({ currency: null, price_minor: null }),  // unpriced → null reference
  ]);
  expect(out[0].price_reference_minor).toBe(14000);
  expect(out[0].price_reference_currency).toBe("USD");
  expect(out[1].price_reference_minor).toBe(2800);
  expect(out[2].price_reference_minor).toBeNull();
  expect(out[3].price_reference_minor).toBeNull();
  expect(resolver.ratesToUsd).toHaveBeenCalledTimes(1); // one batched resolve
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/reference-price.spec.ts -t reference prices`
Expected: FAIL — `ReferencePriceResolver` undefined.

- [ ] **Step 3: Implement `ReferencePriceResolver` in `reference-price.ts`**

Collect the distinct non-null `currency` values across the batch, call `ratesToUsd(currencies)` once, then map each DTO: `price_reference_minor = computeReferenceMinor(t.price_minor, rates.get(t.currency ?? ""))`, `price_reference_currency = t.price_reference_minor === null ? null : this.referenceCurrency`.

- [ ] **Step 4: Wire into the pipeline**

In `import.pipeline.ts`, inject `ReferencePriceResolver` in the constructor (after `priceResolver`, ~line 245) and, in `runSegment` right after `const priced = await this.priceResolver.attachPrices(located);` (~line 359), add:

```ts
const referenced = await this.referencePriceResolver.attachReferencePrices(priced);
```

Use `referenced` (not `priced`) for the subsequent validate/upsert steps. In `import.module.ts` / `import-core.module.ts`, construct `ExchangeRateResolver` (with `VIATOR_HTTP`, config from env, Prisma-backed cache) and `ReferencePriceResolver`, and add them to the pipeline provider's deps.

- [ ] **Step 5: Run pipeline tests**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import.pipeline.spec.ts src/modules/import/reference-price.spec.ts && pnpm --filter @folio/api typecheck`
Expected: PASS. (Update any pipeline-spec fake that constructs the pipeline to pass a fake `ReferencePriceResolver`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/import
git commit -m "feat(import): compute USD reference price at ingest"
```

---

### Task 5: Fix `priceBandFromMinor` currency-blindness (band on the reference value)

**Files:**
- Modify: `apps/api/src/destinations/destination.service.ts` (`priceBandFromMinor` doc; caller at line 110)
- Modify: `apps/api/src/search/search.service.ts` (band SQL 145-151; LATERAL selects at 389/396/418/481/487/508; row field 198; `toExperienceResult` line 255)
- Test: `apps/api/src/destinations/destination.service.spec.ts`, `apps/api/src/search/search.service.spec.ts`

**Interfaces:**
- Consumes: `Tour.priceReferenceMinor` (Task 3/4).
- Produces: bands are now derived from the USD reference value everywhere. `priceBandFromMinor`'s signature is unchanged; its documented contract becomes "input is a USD-normalized reference minor value."

- [ ] **Step 1: Update the `priceBandFromMinor` doc + caller**

Change the JSDoc to state the input must be a **reference-currency (USD) minor value** (`Tour.priceReferenceMinor`), so the USD thresholds are correct by construction — the function is no longer "currency-naive," it is "reference-currency-normalized." No logic change. In `destination.service.ts:110`, change `priceBandFromMinor(tour?.priceMinor ?? null)` → `priceBandFromMinor(tour?.priceReferenceMinor ?? null)`, and add `priceReferenceMinor: true` to that Tour `select`.

- [ ] **Step 2: Write the failing search-service test**

In `search.service.spec.ts`, add a case proving a non-USD tour bands by its USD reference, not its raw minor: seed a Tour with `priceMinor: 500000, currency: "THB", priceReferenceMinor: 14000` and assert its result `priceBand === "$"` (14000 minor = $140 → `$$`... adjust the fixture so the reference clearly lands in a *different* band than the raw would: e.g. `priceReferenceMinor: 3000` → `$`, while raw `500000` would be `$$$$`). Assert the price-band **filter** matches on the reference band.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/search/search.service.spec.ts -t band`
Expected: FAIL — still bands on `priceMinor`.

- [ ] **Step 4: Repoint the search SQL**

Replace every `tour."priceMinor"` / `t."priceMinor"` in `search.service.ts` with `…"priceReferenceMinor"`:
- `priceBandSqlCondition` (lines 145, 147, 149, 151).
- Both main-query select lists: `tour."priceMinor" AS "priceMinor"` → `tour."priceReferenceMinor" AS "priceMinor"` (keep the output alias `priceMinor` so `ExperienceSearchRow` is unchanged — it now carries the reference value; or rename the field to `priceReferenceMinor` and update `toExperienceResult`). Prefer renaming the alias + row field to `priceReferenceMinor` for clarity, and update `ExperienceSearchRow.priceMinor` → `priceReferenceMinor` and `toExperienceResult` line 255 accordingly.
- Both LATERAL sub-selects (lines 396, 418, 487, 508): select `t."priceReferenceMinor"`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @folio/api exec jest src/search/search.service.spec.ts src/destinations/destination.service.spec.ts`
Expected: PASS. The existing `priceBandFromMinor` unit tests (destination.service.spec.ts:170) still pass unchanged — the function's math is the same; only its callers' input source changed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/destinations apps/api/src/search
git commit -m "fix(price): band on USD reference value, not currency-blind priceMinor"
```

---

### Task 6: Back-fill `priceReferenceMinor` for the existing 29,624 rows

**Files:**
- Create: `apps/api/src/modules/import/backfill-reference-price.cli.ts`
- Test: covered by Task 3/4 unit tests for the conversion; the CLI itself is a thin batch driver verified by a dry-run count.

**Interfaces:**
- Consumes: `ExchangeRateResolver.ratesToUsd`, `computeReferenceMinor`, Prisma `Tour`.

- [ ] **Step 1: Implement the CLI**

A NestJS standalone-context script (mirror `promote-experience.cli.ts` / `trigger-import.cli.ts` bootstrap). Logic:
1. Load the distinct set of `currency` values among rows where `priceReferenceMinor IS NULL AND priceMinor IS NOT NULL AND currency IS NOT NULL AND deletedAt IS NULL`.
2. Resolve all of them once via `ratesToUsd`.
3. In batches (e.g. 1000 rows, keyset-paginate on `id`), compute `computeReferenceMinor(priceMinor, rate)` and `updateMany`/per-row update, setting `priceReferenceCurrency = "USD"`. Rows whose currency has no rate are left null (logged).
4. Print totals: updated, skipped-no-rate, per-currency counts. Support a `--dry-run` flag that computes and reports without writing.

- [ ] **Step 2: Dry-run against the real DB**

Run: `doppler run -- pnpm --filter @folio/api exec tsx src/modules/import/backfill-reference-price.cli.ts --dry-run`
Expected: a per-currency breakdown summing to ~29,624 priced rows; note any currency with no rate.

- [ ] **Step 3: Real backfill**

Run: `doppler run -- pnpm --filter @folio/api exec tsx src/modules/import/backfill-reference-price.cli.ts`
Expected: updated count > 0; a follow-up `SELECT count(*) FROM "Tour" WHERE "priceReferenceMinor" IS NOT NULL` roughly matches the priced-with-known-currency total.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/import/backfill-reference-price.cli.ts
git commit -m "feat(import): backfill priceReferenceMinor over existing Tour rows"
```

---

### Task 7: `ExperienceAutoPromoter` — criteria + service (Decision 3)

**Files:**
- Create: `apps/api/src/modules/import/experience-auto-promoter.ts`
- Test: `apps/api/src/modules/import/experience-auto-promoter.spec.ts`

**Interfaces:**
- Produces:
  - pure `isPromotable(c: PromotionCandidate): boolean` where `PromotionCandidate = { title: string; description: string; status: string; tour: { imageUrl: string | null; affiliateUrl: string | null; priceReferenceMinor: bigint | number | null } | null }`.
  - `class ExperienceAutoPromoter { constructor(prisma); promoteEligible(provider: string): Promise<{ scanned: number; promoted: number }> }`.
- Consumes: Prisma `experience` + linked `tour` (Task 3/4 columns).

- [ ] **Step 1: Write the failing predicate test**

```ts
import { isPromotable } from "./experience-auto-promoter";
const base = { title: "T", description: "D", status: "draft",
  tour: { imageUrl: "http://img", affiliateUrl: "http://go", priceReferenceMinor: 3000 } };

it("promotes when all criteria hold", () => expect(isPromotable(base)).toBe(true));
it("rejects empty title/description", () => {
  expect(isPromotable({ ...base, title: "  " })).toBe(false);
  expect(isPromotable({ ...base, description: "" })).toBe(false);
});
it("rejects missing image / affiliate", () => {
  expect(isPromotable({ ...base, tour: { ...base.tour, imageUrl: null } })).toBe(false);
  expect(isPromotable({ ...base, tour: { ...base.tour, affiliateUrl: null } })).toBe(false);
});
it("rejects a degenerate price band (null or non-positive reference)", () => {
  expect(isPromotable({ ...base, tour: { ...base.tour, priceReferenceMinor: null } })).toBe(false);
  expect(isPromotable({ ...base, tour: { ...base.tour, priceReferenceMinor: 0 } })).toBe(false);
});
it("rejects when there is no linked tour", () => expect(isPromotable({ ...base, tour: null })).toBe(false));
it("is a no-op on already-published rows", () => expect(isPromotable({ ...base, status: "published" })).toBe(false));
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/experience-auto-promoter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `isPromotable` + `promoteEligible`**

```ts
export function isPromotable(c: PromotionCandidate): boolean {
  if (c.status !== "draft") return false;
  if (c.title.trim().length === 0) return false;
  if (c.description.trim().length === 0) return false;
  const t = c.tour;
  if (!t) return false;
  if (!t.imageUrl) return false;
  if (!t.affiliateUrl) return false;
  const ref = t.priceReferenceMinor === null ? null : Number(t.priceReferenceMinor);
  if (ref === null || !Number.isFinite(ref) || ref <= 0) return false;
  return true;
  // Stage B (deferred): also require a resolved category here.
}
```

`promoteEligible(provider)`: select `draft` Experiences whose linked Tour is `deletedAt: null` (include the tour's `imageUrl`, `affiliateUrl`, `priceReferenceMinor`, and the Experience `title`/`description`/`status`); for each passing `isPromotable`, `updateMany({ where: { id, status: "draft" }, data: { status: "published" } })` (the `status: "draft"` guard keeps it idempotent + race-safe, matching the linker's back-link pattern). Return `{ scanned, promoted }`. Scope the select to Experiences linked to a Tour of this `provider` via the relation.

- [ ] **Step 4: Add an integration test** (`experience-auto-promoter.spec.ts`, DB-backed like `experience-linker.integration.spec.ts`)

Seed a City + a promotable draft (linked Tour with image/affiliate/positive reference) + a non-promotable draft (null reference) + an already-published row; assert `promoteEligible("viator")` promotes exactly one and re-running promotes zero (idempotent).

- [ ] **Step 5: Run to verify it passes**

Run: `docker compose -f infra/docker-compose.yml up -d && pnpm --filter @folio/api exec jest src/modules/import/experience-auto-promoter.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/import/experience-auto-promoter.ts apps/api/src/modules/import/experience-auto-promoter.spec.ts
git commit -m "feat(import): automatic evidence-based experience promoter"
```

---

### Task 8: Run the auto-promoter on every import run

**Files:**
- Modify: `apps/api/src/modules/import/import-run.service.ts` (after `ExperienceLinker.linkRun`)
- Modify: `apps/api/src/modules/import/import.module.ts` (DI: provide `ExperienceAutoPromoter`)
- Test: `apps/api/src/modules/import/import-run.service.spec.ts` or `import-run.integration.spec.ts`

**Interfaces:**
- Consumes: `ExperienceAutoPromoter.promoteEligible` (Task 7), the existing post-crawl finalize sequence.

- [ ] **Step 1: Write the failing test**

Extend the import-run test that asserts `ExperienceLinker.linkRun` is called after `finalizeGuardedSoftDelete` to also assert `ExperienceAutoPromoter.promoteEligible(provider)` is called once, **after** `linkRun`, on a successful run (and not on an aborted run).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import-run.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Inject `ExperienceAutoPromoter` into `ImportRunService`; after the `ExperienceLinker.linkRun(provider)` call in the post-crawl finalize path, call `await this.autoPromoter.promoteEligible(provider)` and fold its `{ promoted }` count into the run log. Do not call it on the aborted path. Add the provider to `import.module.ts`. Leave `promote-experience.service.ts`/`.cli.ts` untouched (manual override retained).

> Note: when **Stage B** (category resolution) lands, add the "category resolved" gate to `isPromotable` (Task 7) — no change needed here.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import-run.service.spec.ts src/modules/import/import-run.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/import/import-run.service.ts apps/api/src/modules/import/import.module.ts apps/api/src/modules/import/import-run.service.spec.ts
git commit -m "feat(import): auto-promote eligible experiences after each import run"
```

---

### Task 9: Promote-eligible CLI for the existing backlog

**Files:**
- Create: `apps/api/src/modules/import/promote-eligible.cli.ts`

**Interfaces:**
- Consumes: `ExperienceAutoPromoter.promoteEligible`.

- [ ] **Step 1: Implement the CLI**

A standalone-context script (mirror `promote-experience.cli.ts`) that builds a Nest application context, resolves `ExperienceAutoPromoter`, calls `promoteEligible("viator")`, prints `{ scanned, promoted }`, and exits non-zero on error. Support `--dry-run` (reuse the predicate to count without writing — add a `dryRun` param to `promoteEligible` or a sibling `countEligible`).

- [ ] **Step 2: Dry-run then run against the real DB** (after Task 6's backfill has populated references)

```bash
doppler run -- pnpm --filter @folio/api exec tsx src/modules/import/promote-eligible.cli.ts --dry-run
doppler run -- pnpm --filter @folio/api exec tsx src/modules/import/promote-eligible.cli.ts
```

Expected: `promoted` > 0; a follow-up count of `published` Experiences increased by that amount; a second run promotes 0 (idempotent).

- [ ] **Step 3: Full verification sweep**

Run: `pnpm --filter @folio/api lint && pnpm --filter @folio/api typecheck && pnpm --filter @folio/api test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/import/promote-eligible.cli.ts
git commit -m "feat(import): CLI to promote the eligible experience backlog"
```

---

## Out of scope (deferred, by decision)

- **Category Stage B** — `/products/tags` client, weekly-refreshed tag-name cache, restricted-tag exclusion, Viator-tag→9-`ExperienceCategory` crosswalk, an Atlas-owned category column on `Experience`, its backfill, and adding "category resolved" as a promotion gate. Its own follow-up plan. Unblocked by Task 1 (tags are already captured; no re-crawl needed).
- **`/availability/schedules/bulk`** price fanout reduction (docs/13 follow-up) — unrelated to banding correctness.
- **Per-currency minor-unit exponent normalization** at the `Tour.priceMinor` layer — not needed for correctness here, because the reference conversion is exponent-agnostic (`priceMinor` is uniformly `major × 100`); flagged only if a display path ever formats `priceMinor` as an exact price.

## Self-Review

**Spec coverage:**
- Decision 1 Stage A → Task 1. Stage B explicitly deferred (Decisions section + Out of scope). ✅
- Decision 2: cheap fix checked & confirmed closed (Confirmed research) → FX cache Task 2, reference-at-ingest Tasks 3–4, band bug fix Task 5, backfill of 29,624 rows Task 6. ✅
- Decision 3: automatic criteria (title/description/image/affiliate/non-degenerate band; category excluded pending Stage B) → Task 7; on every future run → Task 8; once against backlog → Task 9. ✅
- Sequencing (1 ∥ 2→3→4→5→6→7→8→9; promotion depends on currency, not on tags) stated with reasoning. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The one genuine unknown — the exact `/exchange-rates` request/response envelope — is handled as an explicit live-verification step with a concrete assumed shape and Zod fallback, consistent with the repo's existing BRI-165/163 discipline, not left blank.

**Type consistency:** `TourDTO.tags: number[]` (Task 1) ↔ `Tour.tags Int[]` (Task 1) ↔ `toColumns` map (Task 1). `TourDTO.price_reference_minor` / `price_reference_currency` (Task 3) ↔ `Tour.priceReferenceMinor BigInt?` / `priceReferenceCurrency` (Task 3) ↔ `toColumns` (Task 3) ↔ `attachReferencePrices` output (Task 4) ↔ search/destination reads (Task 5) ↔ `isPromotable` candidate `tour.priceReferenceMinor` (Task 7). `computeReferenceMinor(priceMinor, rate)` (Task 3) consumed by `ReferencePriceResolver` (Task 4) and the backfill CLI (Task 6). `ratesToUsd` (Task 2) consumed by Tasks 4 & 6. `promoteEligible(provider)` (Task 7) consumed by Tasks 8 & 9. Consistent. ✅
