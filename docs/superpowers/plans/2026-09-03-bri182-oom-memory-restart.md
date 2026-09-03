# BRI-182: Memory-Pressure Segment-Restart Trigger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a memory-pressure check as a second, independent segment-restart trigger in `ImportPipeline.runSegment`, alongside (not instead of) BRI-176's existing page-count trigger — so a segment restarts before a heavy page's real rss spike can approach Render's 512MiB ceiling, even when that spike happens well before the page-count boundary would ever fire.

**Architecture:** `runSegment`'s existing per-page loop already reads `process.memoryUsage()` once per page (a temporary BRI-182 diagnostic, currently logged and discarded). This plan makes that reading permanent, injectable (mirroring the existing `Sleep` seam in `viator.client.ts`), and — when a new `restartMemoryThresholdBytes` option is set — feeds it into the same early-stop branch the page-count check already uses, via `||`. `segment-worker.cli.ts` computes that byte threshold from two new env vars and passes it in. The segment-restart *mechanism itself* (child-process exit/respawn, BRI-176) is completely unchanged — this only changes what decides to trigger it.

**Tech Stack:** NestJS, TypeScript, Zod (env validation), Jest.

**Spec:** No `docs/0X-*.md` file covers this — it's an operational bug fix, not a product feature. The spec is the BRI-182 Linear issue's own investigation log (root-cause confirmed 2026-09-03; full evidence trail quoted inline below where it drives a decision), plus the task brief this plan was written from.

## Global Constraints

- Do not remove or weaken the existing page-count trigger (`restartEveryNPages` / `IMPORT_CRAWL_RESTART_PAGES`) — add a second trigger alongside it (`||`), never replace it. Page count still guards the original BRI-176 concern (slow, steady accumulation over many pages of ordinary content); the new memory check guards a different, faster failure mode.
- Do not enable or rely on unattended nightly cron scheduling as part of this work — `IMPORT_CRON_ENABLED` stays whatever it already is; that's a separate decision.
- Do not touch Linear (BRI-182 or any related issue) — the user updates it themselves once this is reported.
- Do not deploy, and do not change any live Render environment variable (including reverting `IMPORT_CRAWL_RESTART_PAGES` back toward 25 — see Task 1's reasoning for why that's recommended) — without first confirming Render is actually reachable, and without explicit user go-ahead. This plan's own scope ends at local implementation + local verification.
- `restartMemoryThresholdBytes` must be optional and default-disabled (`undefined`), so every existing caller of `runSegment` that doesn't know about it (`import-run.integration.spec.ts`, every pre-BRI-182 test in `import.pipeline.spec.ts`) keeps its exact prior behavior with zero changes to those files.

## Non-Goals

- **The `ImportRun` counter/ledger mismatch found during BRI-182's investigation** (a killed segment's committed `Tour` rows aren't reflected in the row's `fetched`/`normalized`/`upserted` counters, since the per-page `incrementData` checkpoint only writes back once per *segment*, not once per *page* — a hard kill mid-segment loses the last checkpoint even though the DB rows it describes are already committed). This is a real, separate observability gap, not a memory-safety issue, and not what's crashing anything. Out of scope here; flagged as a standalone follow-up via `spawn_task` after this plan is implemented (see Task 5).
- **Fixing the underlying `LocationResolver.fetchBatch()` retry gap (BRI-183)** or any other bug BRI-182's investigation surfaced along the way that isn't the memory-restart mechanism itself.
- **Deciding whether to lower `IMPORT_CRON_ENABLED`/enable nightly scheduling.** Per Global Constraints, untouched.

---

### Task 1: Env vars — `IMPORT_MEMORY_LIMIT_MB` / `IMPORT_CRAWL_RESTART_MEMORY_PCT`

**Files:**
- Modify: `apps/api/src/config/env.validation.ts:169` (append two new vars right after `IMPORT_CRAWL_RESTART_PAGES`; also extend that var's own doc comment)

**Interfaces:**
- Produces: `Env["IMPORT_MEMORY_LIMIT_MB"]: number` (default `512`), `Env["IMPORT_CRAWL_RESTART_MEMORY_PCT"]: number` (default `45`) — both consumed by Task 4's `segment-worker.cli.ts` via `ConfigService<Env, true>.get(...)`.

**Why 45%, not a round guess — the real evidence:**

From BRI-182's decisive local test (real parent+child process split, real Postgres, real Viator API, real R2, inside an actual `--memory=512m --memory-swap=512m` container — the most production-faithful test run): 20 pages of *ordinary* content (7,000 raw products, no heavy-page clustering) plateaued at **46–52% of the 512MB cap, combined parent+child**. The parent's own live footprint was independently confirmed flat and stable at **~101–118MB** across that same test (and BRI-176's original sizing). Subtracting that out: the child's own share of that normal-operation plateau is roughly **125–156MB**.

From the real live crash capture (production, 2026-09-03, per-page `process.memoryUsage()` logged from inside the child process — the same reading this task wires up permanently): going from page 1 to page 2, the child's own `rss` jumped **+96.7MB** in one step (`heapUsed` +94.8MB; `external`/`arrayBuffers` flat, ruling out BRI-176's old undici-buffer theory — this is real V8 JS heap growth). That page was one of the ones matching the real byte-for-byte comparison BRI-182 ran: a page clustering three heavy products (`5632934P13`, `5632934P8`, `5632934P12`) each embedding ~910KB of nested `logistics.start[].location` data per booking option × 4 options ≈ 3.6MB/product.

So: a light-page-only baseline (~100–156MB, per the decisive test) plus one confirmed real heavy-page spike (+97MB) lands at **~200–250MB** — and the real crash's three heavy products cluster within a few pages of each other, so a second heavy page reliably crosses any threshold in that range.

**45% of 512MB = 230.4MB** is the chosen default:
- **Above** the confirmed normal-operation plateau (~125–156MB) by a **75–105MB margin** — no false-positive risk from ordinary multi-page growth.
- **Below** this process's own effective danger ceiling (512MB total minus the parent's confirmed ~110–118MB ≈ **~394–402MB**) by a **~40% margin** — real headroom before the point where Render's own OOM killer would fire on the whole container.
- **Squarely inside** the real heavy-page-spike range (~200–250MB) — fires at most one page after the first heavy page hits, definitely by the second (matching the task's instruction: catch the spike "well before the ceiling," not merely before a hard crash).

- [ ] **Step 1: Add the two new env vars**

```typescript
  IMPORT_CRAWL_RESTART_PAGES: z.coerce.number().int().positive().default(25),
```

becomes:

```typescript
  /**
   * How many pages each segment-worker child covers before exiting for a
   * fresh one to resume (BRI-176). Local heap profiling localized a real
   * cause of two production OOM kills to memory `undici` retains for the
   * lifetime of one continuous `fetchModifiedSince()` generator consumption
   * — confirmed released the instant that consumption ends. An in-process
   * generator restart (breaking and re-entering the same call) was tried
   * first and measurably helped, but capped verification runs showed a real
   * residual accumulation surviving it — only a full OS process exit
   * reliably gets the complete release. `ImportRunService` spawns a fresh
   * `segment-worker.cli.ts` child every N pages instead (see that class's
   * docstring); this value is read directly by each child from its own
   * environment, not threaded through the parent. Sized from real capped
   * verification runs against the *combined* parent+child memory budget
   * (they share one 512MiB Render instance) — see BRI-176 in Linear for the
   * measurements behind the current default.
   *
   * BRI-182 update: this alone turned out to be an insufficient trigger — a
   * resumed (BRI-181 cursor-based) run can land directly on a heavy-content
   * region from page 1 of its own counting, spiking memory well before this
   * page-count fires. `IMPORT_CRAWL_RESTART_MEMORY_PCT` below is the added
   * fix for that fast-spike case; this var's role narrows back to its
   * original purpose — guarding the slower, steady-accumulation case a
   * *long* run of ordinary pages can still cause. Real evidence now shows 25
   * pages of ordinary content is safe (BRI-182's decisive real-container
   * test plateaued at 46-52% of the cap over 20 such pages) — this default
   * was never changed in code, but the live Render value was lowered to 10
   * as an emergency stopgap before this root cause was understood.
   * Recommend reverting that live override back toward 25 once the memory
   * trigger below is deployed and verified — not done as part of this
   * change; see this plan's Global Constraints.
   */
  IMPORT_CRAWL_RESTART_PAGES: z.coerce.number().int().positive().default(25),

  /**
   * Ceiling this deployment's whole container is allowed, in MB (BRI-182) —
   * paired with `IMPORT_CRAWL_RESTART_MEMORY_PCT` below to compute the
   * memory-pressure segment-restart trigger's absolute byte threshold.
   * Defaults to 512, Render's free-tier limit; override per deployment tier.
   */
  IMPORT_MEMORY_LIMIT_MB: z.coerce.number().int().positive().default(512),

  /**
   * Segment-worker restart trigger (BRI-182), checked every page alongside
   * `IMPORT_CRAWL_RESTART_PAGES` above (whichever fires first stops the
   * segment) — restart once this child process's *own*
   * `process.memoryUsage().rss` crosses this percentage of
   * `IMPORT_MEMORY_LIMIT_MB`. Exists because BRI-176's page-count trigger
   * assumes memory grows roughly proportionally with page count, which
   * BRI-181's cursor-resume broke: a resumed run can land directly on a
   * heavy-content region from page 1 of its own counting, and a real live
   * capture confirmed a single heavy page alone can push this process's own
   * rss up ~97MB in one step — a spike page count alone cannot catch in
   * time.
   *
   * Sized from real evidence, not a round guess: a decisive real-container
   * test (parent+child, `--memory=512m` cap, 20 ordinary pages/7,000
   * products) plateaued at 46-52% of the *combined* container total: with
   * the confirmed-flat ~101-118MB parent baseline subtracted out, this
   * process's own normal-operation share is roughly 125-156MB. 45% of a
   * 512MB limit is 230.4MB — comfortably above that normal range (75-105MB
   * margin, no false-positive risk from ordinary growth) and comfortably
   * below this process's own effective danger ceiling (~394-402MB, a
   * ~40% margin below the point Render's OOM killer would act on the whole
   * container). It's also squarely inside the real heavy-page-spike range: a
   * light-page baseline (~100-156MB) plus one confirmed ~97MB heavy-page
   * jump lands at ~200-250MB, straddling this threshold — the real crash's
   * three heavy products cluster within a few pages of each other, so a
   * second heavy page reliably crosses it even when the first doesn't. See
   * BRI-182 in Linear for the full evidence trail behind these numbers.
   */
  IMPORT_CRAWL_RESTART_MEMORY_PCT: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(45),
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @folio/api exec tsc --noEmit`
Expected: no new errors. (No dedicated `env.validation.spec.ts` exists for any of the ~15 existing vars in this file — this follows that established convention; validity is exercised implicitly by every test/app boot that goes through `ConfigModule.forRoot({ validate: validateEnv })`.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/config/env.validation.ts
git commit -m "feat(api): add IMPORT_MEMORY_LIMIT_MB / IMPORT_CRAWL_RESTART_MEMORY_PCT env vars (BRI-182)"
```

---

### Task 2: `ImportPipeline` — injectable memory-pressure trigger

**Files:**
- Modify: `apps/api/src/modules/import/import.pipeline.ts` (constructor, `ImportPipelineOptions`, `runSegment`'s per-page loop, class docstring)
- Test: `apps/api/src/modules/import/import.pipeline.spec.ts` (new `describe("BRI-182: memory-pressure restart trigger", ...)` block, nested inside the existing `describe("ImportPipeline", ...)`)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `export type MemoryUsageProvider = () => NodeJS.MemoryUsage` and `ImportPipelineOptions.restartMemoryThresholdBytes?: number` — both consumed by Task 4 (`segment-worker.cli.ts` passes `restartMemoryThresholdBytes`; the provider itself defaults and is never overridden outside tests).

- [ ] **Step 1: Write the three deterministic (injected-provider) tests — expect them to fail**

Add this new `describe` block right after the existing `describe("BRI-176: segment bounding", ...)` block closes (before the final two closing `});` of the outer `describe("ImportPipeline", ...)`):

```typescript
  describe("BRI-182: memory-pressure restart trigger", () => {
    /** A scripted MemoryUsageProvider returning one rss value (in MB) per call. */
    function scriptedMemory(rssMbByCall: number[]): jest.Mock<() => NodeJS.MemoryUsage> {
      let call = 0;
      return jest.fn(() => ({
        rss: rssMbByCall[call++] * 1024 * 1024,
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
      })) as unknown as jest.Mock<() => NodeJS.MemoryUsage>;
    }

    it("stops early on a memory-pressure trigger even when the page-count limit hasn't been reached", async () => {
      const pages = [0, 1, 2, 3].map((p) => [rawProduct(`P${p}`)]);
      const { client } = fakeResumableClient(pages);
      const { service: upsert } = fakeUpsert();
      const memoryUsage = scriptedMemory([100, 250, 400, 500]); // crosses 200MB on page 2's reading

      const pipeline = new ImportPipeline(
        client,
        passthroughResolver,
        pricingResolver,
        validator,
        upsert,
        memoryUsage,
      );
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: NEVER_STOPS_EARLY, // page-count alone would never stop this segment
        restartMemoryThresholdBytes: 200 * 1024 * 1024,
      });

      expect(result.done).toBe(false);
      expect(counts.lastPage).toBe(2); // stopped right after the page whose reading crossed 200MB
      expect(memoryUsage).toHaveBeenCalledTimes(2); // read once per page processed, not once per fixture page
    });

    it("never restarts on memory when restartMemoryThresholdBytes is left undefined", async () => {
      const pages = [0, 1, 2].map((p) => [rawProduct(`P${p}`)]);
      const { client } = fakeResumableClient(pages);
      const { service: upsert } = fakeUpsert();
      // Even a reading that would clearly cross any real threshold must not
      // stop the segment when the option itself is absent — every existing
      // caller of runSegment never sets it (see import-run.integration.spec.ts).
      const memoryUsage = scriptedMemory([10240, 10240, 10240]); // 10GB, absurdly high on purpose

      const pipeline = new ImportPipeline(
        client,
        passthroughResolver,
        pricingResolver,
        validator,
        upsert,
        memoryUsage,
      );
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: NEVER_STOPS_EARLY,
        // restartMemoryThresholdBytes intentionally omitted
      });

      expect(result.done).toBe(true);
      expect(counts.lastPage).toBe(3);
    });

    it("still stops on the page-count trigger when a memory threshold is set but never crossed", async () => {
      const pages = [0, 1, 2, 3, 4].map((p) => [rawProduct(`P${p}`)]);
      const { client } = fakeResumableClient(pages);
      const { service: upsert } = fakeUpsert();
      const memoryUsage = scriptedMemory([50, 50, 50, 50, 50]); // well under the threshold every page

      const pipeline = new ImportPipeline(
        client,
        passthroughResolver,
        pricingResolver,
        validator,
        upsert,
        memoryUsage,
      );
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 2,
        restartMemoryThresholdBytes: 500 * 1024 * 1024,
      });

      expect(result.done).toBe(false);
      expect(counts.lastPage).toBe(2); // page-count trigger fires, unaffected by the memory check coexisting
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import.pipeline.spec.ts -t "BRI-182" -v`
Expected: FAIL — `ImportPipeline` constructor doesn't accept a 6th argument yet, and `ImportPipelineOptions` has no `restartMemoryThresholdBytes` field (TypeScript compile error surfaced as a Jest failure).

- [ ] **Step 3: Add the `MemoryUsageProvider` seam and the new option field**

In `apps/api/src/modules/import/import.pipeline.ts`, right after the `RunSegmentResult` interface (before `export class ImportPipeline {`):

```typescript
/**
 * Injectable seam for {@link ImportPipeline}'s per-page memory check
 * (BRI-182) — same pattern as
 * {@link import("./clients/viator.client").Sleep}. Defaults to Node's real
 * `process.memoryUsage()` in production; tests inject a scripted sequence to
 * make the memory-pressure trigger deterministic.
 */
export type MemoryUsageProvider = () => NodeJS.MemoryUsage;

const defaultMemoryUsageProvider: MemoryUsageProvider = () =>
  process.memoryUsage();
```

In `ImportPipelineOptions`, right after the existing `restartEveryNPages` field:

```typescript
  /**
   * Stop after this segment's own process rss crosses this many bytes
   * (BRI-182), leaving further pages for the next segment — same
   * "next segment" mechanism {@link restartEveryNPages} uses, just a second,
   * independent trigger checked alongside it (`||`, not instead of). From
   * `IMPORT_MEMORY_LIMIT_MB` × `IMPORT_CRAWL_RESTART_MEMORY_PCT` (see
   * `segment-worker.cli.ts`). `undefined` disables the check entirely —
   * every existing caller that never sets this (e.g.
   * `import-run.integration.spec.ts`) keeps its exact prior behavior.
   */
  readonly restartMemoryThresholdBytes?: number;
```

In the `ImportPipeline` class, extend the constructor:

```typescript
  constructor(
    private readonly client: ViatorClient,
    private readonly resolver: LocationResolver,
    private readonly priceResolver: PriceResolver,
    private readonly validator: TourValidator,
    private readonly upsert: TourUpsertService,
    /**
     * Injectable seam (BRI-182), same pattern as this module's
     * {@link import("./clients/viator.client").Sleep} sibling — lets this
     * class's own tests script memory readings instead of depending on real,
     * non-deterministic GC/heap behavior. Defaults to Node's real
     * `process.memoryUsage()` in production.
     */
    private readonly memoryUsage: MemoryUsageProvider = defaultMemoryUsageProvider,
  ) {}
```

- [ ] **Step 4: Fold the temporary diagnostic into a permanent log, and combine the two restart triggers**

Replace the existing `// TEMPORARY DIAGNOSTIC (BRI-182)` block (right after the `if (page.nextCursor) { counts.lastCursor = ... }` lines):

```typescript
      // TEMPORARY DIAGNOSTIC (BRI-182) — remove once the crash this segment
      // occasionally produces is root-caused and fixed. Same categorized
      // process.memoryUsage() breakdown BRI-176 used (commit 172d314), but
      // via `.warn()` instead of `.debug()`: both `segment-worker.cli.ts` and
      // `trigger-import.cli.ts` boot their Nest context with
      // `logger: ["log", "warn", "error"]`, so BRI-176's `.debug()` calls
      // were silently dropped and never reached Render's logs at all — this
      // is the fix for that, not a stylistic change. Logged unconditionally,
      // once per raw page, so it covers every page regardless of curated
      // match rate.
      const bri182Mem = process.memoryUsage();
      this.logger.warn(
        `[BRI-182 mem] page ${page.page}: rss=${toMb(bri182Mem.rss)}MB ` +
          `heapUsed=${toMb(bri182Mem.heapUsed)}MB heapTotal=${toMb(bri182Mem.heapTotal)}MB ` +
          `external=${toMb(bri182Mem.external)}MB arrayBuffers=${toMb(bri182Mem.arrayBuffers)}MB`,
      );
```

with:

```typescript
      // Per-page process.memoryUsage() read (BRI-182): logged unconditionally
      // for operational visibility, and — when
      // options.restartMemoryThresholdBytes is set — the same reading feeds
      // the memory-pressure restart trigger below, so this method never reads
      // it twice in one page. Logged via .warn(), not .debug(): both
      // segment-worker.cli.ts and trigger-import.cli.ts boot their Nest
      // context with logger: ["log", "warn", "error"], which silently drops
      // .debug() calls — BRI-182 found this the hard way (the original
      // diagnostic used .debug() and never once reached Render's logs).
      const mem = this.memoryUsage();
      this.logger.warn(
        `[mem] page ${page.page}: rss=${toMb(mem.rss)}MB heapUsed=${toMb(mem.heapUsed)}MB ` +
          `heapTotal=${toMb(mem.heapTotal)}MB external=${toMb(mem.external)}MB ` +
          `arrayBuffers=${toMb(mem.arrayBuffers)}MB`,
      );
```

Then replace the existing page-count-only check at the bottom of the loop:

```typescript
      // BRI-176: stop this segment every `restartEveryNPages` pages, leaving
      // the rest for a fresh process (see class docstring). Only when a next
      // page actually exists — the crawl's true last page (no `nextCursor`)
      // always finishes via natural completion instead, leaving `done` true.
      pagesThisSegment += 1;
      if (page.nextCursor && pagesThisSegment >= options.restartEveryNPages) {
        done = false;
        break;
      }
```

with:

```typescript
      // BRI-176/BRI-182: stop this segment — leaving the rest for a fresh
      // process (see class docstring) — on whichever of two independent
      // triggers fires first. Only when a next page actually exists; the
      // crawl's true last page (no `nextCursor`) always finishes via natural
      // completion instead, leaving `done` true regardless of either trigger.
      //
      // - Page count (BRI-176, `restartEveryNPages`): guards against slow,
      //   steady accumulation over many pages of ordinary content.
      // - Memory pressure (BRI-182, `restartMemoryThresholdBytes`): guards
      //   against a single heavy page (or a short run of them) spiking this
      //   process's own rss well before `restartEveryNPages` would ever fire
      //   — the failure mode BRI-181's cursor-resume exposed, since a resumed
      //   segment can land directly on heavy content from its very first page.
      pagesThisSegment += 1;
      if (page.nextCursor) {
        const overPageLimit = pagesThisSegment >= options.restartEveryNPages;
        const overMemoryLimit =
          options.restartMemoryThresholdBytes !== undefined &&
          mem.rss >= options.restartMemoryThresholdBytes;

        if (overPageLimit || overMemoryLimit) {
          done = false;
          this.logger.log(
            overMemoryLimit
              ? `Segment stopping after page ${pagesThisSegment}: memory ` +
                `threshold crossed (rss=${toMb(mem.rss)}MB >= ` +
                `${toMb(options.restartMemoryThresholdBytes as number)}MB)` +
                (overPageLimit ? " (page limit also reached)" : "")
              : `Segment stopping: reached the ${options.restartEveryNPages}-page limit.`,
          );
          break;
        }
      }
```

Finally, remove the now-stale `// TEMPORARY DIAGNOSTIC (BRI-182) — remove alongside the log call above.` comment directly above the `toMb` helper at the bottom of the file — `toMb` is a permanent helper now, so just leave its plain definition:

```typescript
function toMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
```

- [ ] **Step 5: Add a BRI-182 paragraph to the class docstring**

In the large class docstring at the top of the file, right before the closing `*/` (after the paragraph ending "...an in-memory list across process boundaries."), add:

```typescript
 *
 * **BRI-182.** BRI-176's page-count restart assumes memory grows roughly
 * proportionally with page count — true for a run starting fresh at page 1,
 * where Viator's catalog happens to start light. BRI-181's cursor-resume can
 * land a run directly in a heavy-content region from page 1 of its own
 * counting instead: three real products from one supplier family each embed
 * a large nested `logistics.start[].location` pickup-list structure (~910KB
 * per booking option, 4 options), and a page clustering a few of them can be
 * 2-3x an ordinary page's weight. A live capture confirmed one such page
 * alone pushed this process's own `rss` up ~97MB in a single step — enough
 * on its own to approach the ceiling well before `restartEveryNPages` would
 * ever fire. `restartMemoryThresholdBytes` below is the fix: a second,
 * independent restart trigger checked every page alongside the page-count
 * one (`||`, not instead of — page count still guards the slower, steady-
 * accumulation case BRI-176 fixed), read via the injectable
 * {@link MemoryUsageProvider} seam.
 */
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import.pipeline.spec.ts -v`
Expected: PASS — all pre-existing tests in this file still pass unchanged (they never set `restartMemoryThresholdBytes`), plus the three new BRI-182 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/import/import.pipeline.ts apps/api/src/modules/import/import.pipeline.spec.ts
git commit -m "feat(api): add memory-pressure segment-restart trigger alongside page count (BRI-182)"
```

---

### Task 3: Realistic heavy-page test (real `process.memoryUsage()`, no injection)

**Files:**
- Modify: `apps/api/src/modules/import/import.pipeline.spec.ts` (add a `heavyRawProduct` fixture helper near the top, and one more test inside the `describe("BRI-182: ...")` block from Task 2)

**Interfaces:**
- Consumes: `ImportPipeline`, `ImportRunCounts`, `rawProduct`, `fakeClient`, `passthroughResolver`, `pricingResolver`, `fakeUpsert` — all from Task 2 / pre-existing.
- Produces: nothing new consumed elsewhere — this is a leaf verification test.

Task 2's tests prove the *logic* is correct with a scripted provider. This task proves the *default, real* `process.memoryUsage()` path actually detects a real heavy page — grounded in BRI-182's own documented real-page shape (the literal archived R2 object for the real crash page is unreachable locally: production-only data, no local R2 credentials, 14-day retention sweep risk — so this reproduces the *proportions* BRI-182 measured, not the literal bytes).

- [ ] **Step 1: Write the fixture helper and the test — expect it to fail**

Add near the top of `import.pipeline.spec.ts`, right after the existing `rawProduct` function:

```typescript
/**
 * A realistically-proportioned heavy raw product (BRI-182). Real archived
 * evidence found three real Viator products from one supplier family
 * (`5632934P13`, `5632934P8`, `5632934P12`) each embedding a large nested
 * `logistics.start[].location` pickup-list structure per booking option —
 * averaging ~910KB/option across 4 options, ~3.6MB/product — clustering on
 * certain pages (the crashed run's page 2 matched a fresh run's page ~110
 * byte-for-byte: 500 products, ~39MB, largest single product ~4.6MB). This
 * fixture reproduces that real shape and proportion — not the literal
 * archived bytes, which are production-only data unreachable locally — so
 * the test below is grounded in the real page that caused the crash rather
 * than an arbitrary synthetic size.
 */
function heavyRawProduct(code: string): ViatorProduct {
  const heavyOption = () => ({ location: { pickupPoints: "x".repeat(910 * 1024) } });
  return rawProduct(code, {
    logistics: { start: [heavyOption(), heavyOption(), heavyOption(), heavyOption()] },
  });
}
```

Add inside the `describe("BRI-182: memory-pressure restart trigger", ...)` block from Task 2, as the last test:

```typescript
    it("real process.memoryUsage() detects a realistic heavy page and stops the segment", async () => {
      // Reproduces the real page shape from BRI-182's decisive evidence:
      // three heavy products (matching the real 5632934P13/P8/P12 cluster)
      // among ~500 total, ~39MB page weight — see heavyRawProduct's docstring.
      const heavyProducts = ["5632934P13", "5632934P8", "5632934P12"].map(heavyRawProduct);
      const lightProducts = Array.from({ length: 497 }, (_, i) => rawProduct(`light-${i}`));
      const heavyPage = [...heavyProducts, ...lightProducts];
      const client = fakeClient([heavyPage, [rawProduct("never-reached")]]);
      const { service: upsert } = fakeUpsert();

      // No injected provider: exercises the real, default `process.memoryUsage` path.
      const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);

      const baselineRss = process.memoryUsage().rss;
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: NEVER_STOPS_EARLY, // only the memory trigger can stop this segment
        // A low bar, comfortably below the tens-of-MB this page's ~11MB of
        // deliberately-allocated heavy strings should push real rss up by —
        // not a tuned production threshold, just enough margin to make the
        // assertion robust to ordinary GC/JIT noise between the two readings.
        restartMemoryThresholdBytes: baselineRss + 5 * 1024 * 1024,
      });

      expect(result.done).toBe(false);
      expect(counts.lastPage).toBe(1); // stopped after the heavy page, never reached page 2
      expect(counts.fetched).toBe(500);
    }, 15000);
```

- [ ] **Step 2: Run it to verify it fails first (sanity check the fixture is actually heavy)**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import.pipeline.spec.ts -t "real process.memoryUsage" -v`
Expected at this point: this test should already be runnable (Task 2's plumbing is in place) — if it fails, it's a genuine assertion failure, not a compile error. If `result.done` comes back `true` (i.e. the real rss jump was smaller than the 5MB margin), that means the synthetic fixture isn't heavy enough in practice — increase `heavyOption`'s string size (e.g. to `1.5 * 1024 * 1024`) or the light-product count, and re-run, before moving on. Do not weaken the assertion instead.

- [ ] **Step 3: Confirm it passes as expected**

Run: `pnpm --filter @folio/api exec jest src/modules/import/import.pipeline.spec.ts -v`
Expected: PASS, all tests in the file including this one.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/import/import.pipeline.spec.ts
git commit -m "test(api): ground BRI-182's memory trigger in a realistic heavy-page fixture"
```

---

### Task 4: Wire `segment-worker.cli.ts` to pass the byte threshold

**Files:**
- Modify: `apps/api/src/modules/import/segment-worker.cli.ts:66-79`

**Interfaces:**
- Consumes: `ImportPipelineOptions.restartMemoryThresholdBytes` (Task 2), `Env["IMPORT_MEMORY_LIMIT_MB"]` / `Env["IMPORT_CRAWL_RESTART_MEMORY_PCT"]` (Task 1).
- Produces: nothing consumed elsewhere — this is the pipeline's real production entry point.

No new test file for this wiring: `increment-data.ts`'s own docstring explains why CLI-entrypoint logic in this module is pulled into small, separately-tested pure functions rather than tested via `segment-worker.cli.ts` directly — that file has an unconditional top-level `void main()` bootstrap. This task follows the same precedent: the computation is a single obviously-correct arithmetic expression (no branching), pulled into its own small function so it's at least unit-testable in isolation, while the field it feeds (`restartMemoryThresholdBytes`) is already fully covered by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test for the threshold arithmetic**

Add a new file `apps/api/src/modules/import/segment-worker.cli.spec.ts`:

```typescript
import { describe, expect, it } from "@jest/globals";

import { memoryThresholdBytes } from "./segment-worker.cli";

describe("memoryThresholdBytes (BRI-182)", () => {
  it("computes bytes from limit-MB × percent", () => {
    const config = {
      get: (key: string) =>
        key === "IMPORT_MEMORY_LIMIT_MB" ? 512 : key === "IMPORT_CRAWL_RESTART_MEMORY_PCT" ? 45 : undefined,
    } as never;

    expect(memoryThresholdBytes(config)).toBeCloseTo(512 * 0.45 * 1024 * 1024);
  });

  it("handles a 100% threshold as the full limit in bytes", () => {
    const config = {
      get: (key: string) =>
        key === "IMPORT_MEMORY_LIMIT_MB" ? 256 : key === "IMPORT_CRAWL_RESTART_MEMORY_PCT" ? 100 : undefined,
    } as never;

    expect(memoryThresholdBytes(config)).toBe(256 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @folio/api exec jest src/modules/import/segment-worker.cli.spec.ts -v`
Expected: FAIL — `memoryThresholdBytes` isn't exported from `segment-worker.cli.ts` yet.

- [ ] **Step 3: Add the helper and wire it into the `runSegment` call**

In `apps/api/src/modules/import/segment-worker.cli.ts`, change the `runSegment` call:

```typescript
      const result = await pipeline.runSegment(counts, {
        fetchedAt: run.startedAt.toISOString(),
        // modified-since only ever matters on a run's very first segment —
        // every resumed one already has a cursor, and ViatorClient itself
        // refuses to send modified-since whenever startCursor is set (see
        // that class's docstring), so this is a belt-and-suspenders guard,
        // not the only thing preventing both being sent together.
        modifiedSince: run.cursor == null ? modifiedSince : undefined,
        restartEveryNPages: config.get("IMPORT_CRAWL_RESTART_PAGES", {
          infer: true,
        }),
        startCursor: run.cursor ?? undefined,
        startPage: run.lastPage ?? undefined,
      });
```

becomes:

```typescript
      const result = await pipeline.runSegment(counts, {
        fetchedAt: run.startedAt.toISOString(),
        // modified-since only ever matters on a run's very first segment —
        // every resumed one already has a cursor, and ViatorClient itself
        // refuses to send modified-since whenever startCursor is set (see
        // that class's docstring), so this is a belt-and-suspenders guard,
        // not the only thing preventing both being sent together.
        modifiedSince: run.cursor == null ? modifiedSince : undefined,
        restartEveryNPages: config.get("IMPORT_CRAWL_RESTART_PAGES", {
          infer: true,
        }),
        restartMemoryThresholdBytes: memoryThresholdBytes(config),
        startCursor: run.cursor ?? undefined,
        startPage: run.lastPage ?? undefined,
      });
```

And add this exported helper near the bottom of the file, alongside `parseArgs`/`messageOf`:

```typescript
/**
 * Absolute byte threshold for {@link ImportPipeline.runSegment}'s
 * memory-pressure restart trigger (BRI-182): `IMPORT_MEMORY_LIMIT_MB` ×
 * `IMPORT_CRAWL_RESTART_MEMORY_PCT` / 100, converted from MB to bytes. See
 * `env.validation.ts` for the real evidence behind the default 45%.
 */
export function memoryThresholdBytes(config: ConfigService<Env, true>): number {
  const limitMb = config.get("IMPORT_MEMORY_LIMIT_MB", { infer: true });
  const pct = config.get("IMPORT_CRAWL_RESTART_MEMORY_PCT", { infer: true });
  return ((limitMb * pct) / 100) * 1024 * 1024;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @folio/api exec jest src/modules/import/segment-worker.cli.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/import/segment-worker.cli.ts apps/api/src/modules/import/segment-worker.cli.spec.ts
git commit -m "feat(api): wire the memory-pressure restart threshold into segment-worker (BRI-182)"
```

---

### Task 5: Full local verification, heavy-page replay, and follow-up flag

**Files:** none modified — verification only.

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @folio/api test`
Expected: PASS, including every new/modified test from Tasks 2-4 and every pre-existing test untouched (`import-run.integration.spec.ts` in particular — it never sets `restartMemoryThresholdBytes`, proving the default-disabled behavior holds end-to-end, not just in the unit tests that check it directly).

- [ ] **Step 2: Typecheck, lint, build**

Run in order:
```bash
pnpm typecheck
pnpm lint
pnpm build
```
Expected: all three clean, workspace-wide (Turbo `--affected` will scope to `@folio/api` and anything depending on it, but run the unscoped root commands here since this is a final verification gate, not a PR-CI run).

- [ ] **Step 3: Confirm the "reproduce the real heavy-page scenario locally" instruction is satisfied**

This is what Task 3's test already does: real (uninjected) `process.memoryUsage()`, a page shaped and proportioned to match BRI-182's own byte-for-byte comparison (3 heavy products at the real ~3.6MB/product logistics-data size, ~497 light products, ~500-product page), run through the real `ImportPipeline.runSegment` end to end, asserting the new trigger fires and the segment stops before a second heavy page could compound the spike. No further local reproduction step is needed beyond re-confirming Step 1 passed.

- [ ] **Step 4: Check Render's current status (read-only) for the report — do not deploy**

Use the Render MCP tools (read-only calls only: `get_service`/`list_deploys`/`get_metrics` or equivalent) to check whether the `atlas-api` service is currently reachable/awake, purely to report status honestly. Do not trigger a deploy, change any environment variable, or otherwise touch the live service — per this plan's Global Constraints, that requires explicit user go-ahead in a separate step outside this plan.

- [ ] **Step 5: Flag the ledger/reality-mismatch follow-up**

Per this plan's Non-Goals, call `spawn_task` (not Linear — per Global Constraints) with a self-contained prompt describing the real finding: a killed segment's committed `Tour` rows aren't reflected in `ImportRun`'s `fetched`/`normalized`/`upserted` counters, since `incrementData` (`apps/api/src/modules/import/increment-data.ts`) only checkpoints once per segment, not once per page — reference the real orphaned row (`cmtlfoxke0000hl2czla8lbx9`) from BRI-182's investigation as a concrete repro case. Title it something like "Fix ImportRun counter checkpoint granularity for hard-kill mid-segment".

- [ ] **Step 6: Report back**

Summarize for the user: all test/typecheck/lint/build results, the final chosen values (`IMPORT_CRAWL_RESTART_MEMORY_PCT=45`, `IMPORT_MEMORY_LIMIT_MB=512`, `IMPORT_CRAWL_RESTART_PAGES` unchanged at 25 in code) with the real-evidence reasoning from Task 1, confirmation that the heavy-page replay (Task 3) passed, Render's actual current status from Step 4 (not assumed), the ledger-mismatch follow-up flagged in Step 5, and the explicit recommendation — not yet acted on — to revert the live Render `IMPORT_CRAWL_RESTART_PAGES` override from 10 back to 25 once this fix is verified live.

---

## Self-Review

**1. Spec coverage** — checked against the task brief's 5 numbered plan requirements:
1. Real fix as an additional trigger, not a replacement: Task 2, Step 4 (`||`, both branches present, both tested in Task 2's three deterministic tests). ✅
2. Threshold chosen from real evidence with the exact number reasoned through: Task 1's "Why 45%, not a round guess" section, citing the decisive local test's 46-52% combined plateau, the confirmed parent baseline, and the live crash's real +96.7MB single-page delta. ✅
3. `IMPORT_CRAWL_RESTART_PAGES` reconsidered from real evidence: Task 1's extended doc comment explains the code default (25) was already evidence-safe per the decisive test, distinguishes it from the live-only emergency stopgap (10), and the plan explicitly recommends (but doesn't execute) reverting the live value — covered in Task 5 Step 6's report and the Global Constraints. ✅
4. Ledger/reality mismatch: explicitly scoped out in Non-Goals with rationale, flagged via `spawn_task` in Task 5 Step 5, not bundled into the code changes. ✅
5. Tests grounded in the real heavy page: Task 3's `heavyRawProduct` fixture reproduces the real, documented per-option/per-product byte proportions from BRI-182's own investigation (910KB/option × 4 options, 3 real product codes referenced literally), with an explicit note on why the literal archived bytes aren't used. ✅

Step 2/3 (self-review, then implement; full local verification) and Step 3 (honest Render-status note) from the task brief's own instructions: covered by this plan's Execution Handoff (below) and Task 5 Steps 1-4 respectively.

**2. Placeholder scan** — no TBD/TODO, no "add appropriate handling," no "similar to Task N" without repeated code, every step has real code or a real, runnable command. All four "Do not" constraints from the task brief are captured verbatim in Global Constraints, not paraphrased away.

**3. Type consistency** — `MemoryUsageProvider` (Task 2) is the exact type used in Task 2's three tests, Task 3's test, and matches `NodeJS.MemoryUsage`'s real shape (`rss`/`heapUsed`/`heapTotal`/`external`/`arrayBuffers`) used by `process.memoryUsage()` itself. `restartMemoryThresholdBytes?: number` (Task 2) is the exact field name Task 4's `memoryThresholdBytes()` helper produces and passes. `memoryThresholdBytes(config: ConfigService<Env, true>): number` (Task 4) matches the `config` variable already in scope in `segment-worker.cli.ts`'s `main()` (declared via `app.get(ConfigService<Env, true>)`).
