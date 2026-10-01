# BRI-210 — Step 0 findings (verify, inventory, report)

Date: 2026-10-01 · Branch: `roymkhabela/bri-210-import-pipeline-has-no-retry-for-transient-db-connection` · No code changed.

**Outcome: STOPPED at the Step 0 gate.** One stop condition fired (§6, P2028). Everything else checked out. Decision needed from Roy; see "Decisions needed" at the bottom.

## 1. Repo state

- Worktree clean; `master` == `origin/master` == `037a014`. Working branch was the harness-made `stewie/bri-210-db-retry-layer-10f676` (zero commits ahead of master). No `roymkhabela/bri-210-*` branch existed locally or on origin; created it from the same commit.

## 2. Prisma setup

- `prisma` and `@prisma/client` **6.19.3**, `provider = "prisma-client-js"`, no `previewFeatures`, no `driverAdapters`.
- **No driver adapter** (`pg` is a dependency, but only for the readiness probe). Errors are therefore Prisma's own types, not raw driver errors: `PrismaClientKnownRequestError` (P1017, P2024, P2028 …) and `PrismaClientInitializationError` (P1001, P1002 …, which carries `errorCode`, not `code`). `isTransientDbError` must read both `.code` and `.errorCode`.
- Prisma's own docs confirm P1017 = "Server has closed the connection." (matches the location-cache failure text in §6).

## 3. `PrismaClient` construction sites (non-spec)

| File | Site | Notes |
|---|---|---|
| `src/prisma/prisma.service.ts` | `class PrismaService extends PrismaClient` | The app-wide client. Provided globally by `PrismaModule`. |
| `src/modules/research/research.cli.ts:151` | `new PrismaClient()` | Research CLI, **not** on the import path. Reads only (`PrismaCatalogReader`). |
| 6 content CLIs + 2 import CLIs | `new PrismaService()` | `tour-copy*.cli.ts`, `backfill-tour-category.cli.ts`, `backfill-experience-coordinates.cli.ts` → inherit `PrismaService`. |

- **Segment worker has no separate construction site.** `segment-worker.cli.ts` boots `NestFactory.createApplicationContext(ImportSegmentWorkerModule)` and does `app.get(PrismaService)`. It is a separate *process* with its own instance, but it is the same class, so one change to `PrismaService` covers it. `import:run` (`trigger-import.cli`), `backfill-reference-price.cli` and `promote-*.cli` likewise go through `PrismaService`.
- Integration specs (`*.integration.spec.ts`) construct bare `PrismaClient`s against a throwaway DB; tests only.
- Mechanics: `$extends` returns a new object, so `PrismaService` can't just be extended in place. Probed on 6.19.3: a `constructor() { super(); return this.$extends(...) }` keeps prototype methods (`onModuleInit` still resolves) and works with Nest DI (token is the class, not `instanceof`).

## 4. `$transaction` calls reachable from the import path

No `$transaction` appears in any non-integration spec; four call sites total, all in `src/modules/import`:

| # | Site | Form | Contents | Idempotent? |
|---|---|---|---|---|
| 1 | `upsert.ts:213` `upsertBatch` | **interactive** | loop of `tx.tour.upsert` keyed on `(provider, providerTourId)` | Yes |
| 2 | `upsert.ts:276` `finalizeGuardedSoftDelete` | **interactive** | `tx.tour.findMany` → pure plan → `tx.tour.updateMany({ data: { deletedAt: new Date() }, where deletedAt: null })` (or throws `MassDeletionAbortError`) | Yes for data. Edge: if a commit succeeds but the ack is lost, the rerun recomputes against an already-reduced active set and **under-reports** `softDeleted`/`activeCountBefore`. It can't falsely trip the guard (denominator only shrinks). Note: `MassDeletionAbortError` is non-transient and must propagate untouched. |
| 3 | `location-cache.prisma.ts:53` `putMany` | **batch (array)** | `locations.map(loc => providerLocation.upsert(...))` | Yes. **This is the known failure site.** Important: the array is built *eagerly*; a retry must rebuild the array inside the retried lambda. |
| 4 | `tag-resolver.ts:92` `replaceAll` | **batch (array)** | `viatorTag.deleteMany({})` then `viatorTag.createMany(...)` (no `skipDuplicates`) | **Idempotent as a unit** (rerun wipes then re-inserts the same rows → same end state). `createMany` alone is not idempotent, so this is a judgement call, flagged here. |

**Result: no interactive transaction contains a non-idempotent write.** That stop condition does not fire.

## 5. Standalone non-idempotent writes on the import path (the per-query extension must NOT blindly retry these)

| Write | Where | Why unsafe to auto-retry |
|---|---|---|
| `importRun.update` with `{ increment }` (`incrementData`) | `segment-worker.cli.ts:90,105` (+ failure/finish paths) | Lost ack after commit → counts double. |
| `importRun.create` | `import-run.service.ts:209` | Duplicate run row. |
| `quarantinedTour.create` | `quarantine-store.prisma.ts:24` | No unique key beyond `id` → duplicate quarantine rows. |
| `experience.create` | `experience-linker.ts:231` | Already guarded by a unique key + P2002 read-back, so retry is *effectively* safe, but a generic extension can't know that. `wasCreated` could read false after a lost ack. |
| `affiliateClick.create` | `affiliate.service.ts:47` | Not import path, but shares `PrismaService`. A duplicate click row. |

All other standalone writes are keyed `upsert`/`update`/`updateMany` setting plain values (promoter, linker back-link, price/category/coordinate backfills, exchange-rate upsert, `importRun.update` setting status/error) and are idempotent.

**Design consequence (not in the ticket's text):** the Linear spec says `create`/`increment` "stay unwrapped", but also says standalone retry is via a blanket extension. Reconciling the two means the extension needs an **operation allow-list**: retry reads, `upsert`, `delete*`, and `update*` only when `data` contains no atomic operators (`increment`/`decrement`/`multiply`/`divide`/`push`); never retry `create*`/`$executeRaw`. Consequence: the segment-end `incrementData` update, the spot where the worker records progress, is **not** protected unless `incrementData` is made idempotent (separate change).

## 6. Real error evidence

Sources: Linear BRI-210 (+ Roy's 2026-09-28 comment), BRI-195, BRI-194 (no comments), `docs/`, Railway log dump (2026-09-04), and local Claude session transcripts for earlier runs.

| Occurrence | Error | Class / code | Site |
|---|---|---|---|
| BRI-194/195 validation run, ×2 | "couldn't reach the endpoint" | **P1001** (per Linear; no log text on disk) | segment worker, mid-run |
| 2026-09-04 Railway boot | `errorCode: 'P1001'`, `retryable: undefined`, `PrismaClientInitializationError` | **P1001** (init error, not mid-query) | `/ready` at startup (config bug, not a drop) |
| 2026-09-28 BRI-224 dev run (the "third occurrence") | `Invalid this.prisma.providerLocation.upsert() invocation … location-cache.prisma.js:30 … Server has closed the connection.` | Message text is exactly Prisma's **P1017**; the code itself wasn't in the captured excerpt. | batch `$transaction` in `location-cache.prisma.ts` (#3 above) |
| 2026-09-14 `promote-eligible` CLI, ×2 (37 min / 23 min) | `Invalid this.prisma.experience.updateMany() invocation … Server has closed the connection.` | **P1017** by message | `experience-auto-promoter.ts:110`, standalone `updateMany` in a long sequential loop |
| 2026-08-20 BRI-176 heap-replay harness against Neon dev | `PrismaClientKnownRequestError code: 'P2028', "Transaction API error: Unable to start a transaction in the given time."` | **P2028**, **not in the agreed set** | `upsertBatch` (#1 above), page ~72 of 146 |
| `backfill-reference-price.cli.ts:37` comment | "crashed a real run (P2024) after only partially writing that batch" | **P2024** (pool timeout, already fixed by concurrency cap) | backfill CLI |

Takeaways:
- P1001, P1017, P2024 are each grounded in real failures. P1002 and P1008 are documented-only (no occurrence found).
- The exact code for the location-cache failure is **inferred** (P1017 by message), not read from a log. Worth capturing `err.code` verbatim on the next occurrence.
- **P2028 is real evidence outside the agreed set and is not clearly connection-class.** The 2026-08-20 session's own diagnosis was that `maxWait` (Prisma's 2 s default for starting an interactive transaction) is set nowhere in `apps/api` (grep confirms) and was likely exceeded under Neon latency/pooler queueing. That is a pool/latency condition, retry-able in principle, but the same code also means "transaction already closed" when `timeout` (120 s here) elapses; retrying that ×5 would burn up to ~10 minutes re-running a callback that is too slow. **This is the stop condition. It's your call whether P2028 joins the set** (and whether to set `maxWait` explicitly instead; see decisions).

## 7. Extension propagation (verified empirically on Prisma 6.19.3; docs were silent)

Context7 on `/prisma/web` documents `query.$allModels.$allOperations` but says nothing on transactions beyond a limitation note about client-level calls inside extensions. So I probed the installed client (read-only `count()`s against Doppler `dev`; probe scripts in the session scratchpad, not committed):

| Query issued via | Hook fires? | `__internalParams.transaction` |
|---|---|---|
| standalone `p.city.count()` | yes | `undefined` |
| `tx.city.count()` inside interactive `$transaction(async tx => …)` | **yes** | `{ kind: "itx", id: "<cuid>" }` |
| array-form `$transaction([p.city.count(), p.tour.count()])` | **yes** (once per query) | `{ kind: "batch", id: 1, index: n, lock: {} }` |

- So **the hook does fire inside transactions, and it can tell it's inside one**, in both forms, via `__internalParams.transaction`. Per-query retry can be excluded reliably.
- Caveat: `__internalParams` is **undocumented/internal** (not in Prisma's types). It works on 6.19.3, but a Prisma upgrade could silently rename it, and a missing flag would turn the per-query retry back on inside transactions. Mitigation planned: fail-safe detection plus a test that exercises the real client shape so an upgrade breaks CI, not production. (Alternative: wrap `$transaction` in an `AsyncLocalStorage` flag; messier for the eager batch-array form.)

## Decisions needed from Roy

1. **P2028 ("Unable to start a transaction in the given time"):**
   (a) leave it out and set an explicit `maxWait` on the import `$transaction`s instead (my recommendation: it's a config gap, not a connection drop, and blind retry masks it); (b) add it to the transient set but only for the *start-timeout* variant; (c) add it wholesale.
2. **Extension allow-list (§5):** OK to retry only reads/upserts/deletes/non-atomic updates and skip `create*` and atomic-operator updates? (The ticket's two sentences imply it; I want it confirmed since it leaves the segment-end `incrementData` write unprotected.)
3. **Shared client blast radius:** `PrismaService` also serves the HTTP API (search/destinations). The extension would retry API-request reads with up to 5 attempts and up to 15 s backoff each, which could hold a request for a long time. Keep global (simple), or make the extension opt-in/short for the web process?
4. **`tag-resolver` batch (#4):** OK to treat `deleteMany + createMany` as idempotent-as-a-unit and wrap it?
