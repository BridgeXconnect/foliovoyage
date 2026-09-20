import { z } from "zod";

/**
 * Environment schema for the API (ST-2 / BRI-97).
 *
 * This is the single source of truth for the config surface downstream stories
 * (ST-5 persistence, ST-9 cache/queue) build on. Validation runs once at boot
 * via {@link validateEnv}; a missing or malformed value fails fast before the
 * app starts, rather than surfacing as an obscure runtime error later.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** Port the HTTP server binds to. Defaults to 3001 (web uses 3000). */
  PORT: z.coerce.number().int().positive().default(3001),

  /** Postgres (PostGIS + pg_trgm). Must be a postgres:// or postgresql:// URL. */
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// URL",
    }),

  /** Redis. Must be a redis:// or rediss:// URL. */
  REDIS_URL: z
    .string()
    .url()
    .refine((v) => /^rediss?:\/\//.test(v), {
      message: "REDIS_URL must be a redis:// or rediss:// URL",
    }),

  // --- Ingest / Viator OTA client (ST-6 / BRI-103) -------------------------

  /**
   * Viator Partner API key. Sent as the `exp-api-key` header on every call
   * (v2 auth). Secret — supplied via the environment only, never committed.
   */
  VIATOR_API_KEY: z.string().min(1),

  /**
   * Viator Partner API base URL. Production by default; the sandbox host is
   * `https://api.sandbox.viator.com/partner`. The host of this URL is the only
   * host the outbound fetcher is allowed to reach (SSRF allowlist).
   */
  VIATOR_API_BASE_URL: z
    .string()
    .url()
    .refine((v) => /^https:\/\//.test(v), {
      message: "VIATOR_API_BASE_URL must be an https:// URL",
    })
    .default("https://api.viator.com/partner"),

  /** Accept-Language sent to Viator (required header). */
  VIATOR_API_LANGUAGE: z.string().min(2).default("en-US"),

  /**
   * Request timeout (ms) applied to every outbound Viator call (content,
   * price, and location resolution — none of which proxy to a live external
   * supplier system, unlike a booking call). Docs/13's audit found no timeout
   * was configured at all.
   *
   * Defaults to 60s. BRI-171's live verification (2026-08-18, a real
   * full-catalog `/products/modified-since` crawl against production) proved
   * the original 30s default wrong: a page deep into the crawl legitimately
   * took longer than that to respond, and — before the matching
   * `viator.client.ts` fix — an aborted-by-timeout request had no retry path
   * at all, killing the whole run. A thrown timeout is now retried the same as
   * a 5xx, so this value mainly bounds a *genuinely* stuck connection, not the
   * high end of normal latency; 60s was chosen empirically from that run
   * rather than copying Viator's 120s booking-specific figure outright.
   */
  VIATOR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Reference currency every price band is computed in — the target currency
   * of the FX cache (`ProviderExchangeRate`) and `ExchangeRateResolver`.
   * Prices from providers quoted in another currency are converted to this
   * one before being stored/compared. Defaults to USD.
   */
  PRICE_REFERENCE_CURRENCY: z.string().length(3).default("USD"),

  // --- Raw-payload object storage: Cloudflare R2 (S3-compatible) -----------

  /**
   * R2 S3 API endpoint, e.g. `https://<accountid>.r2.cloudflarestorage.com`.
   * Secret credentials below are supplied via the environment only.
   */
  R2_ENDPOINT: z
    .string()
    .url()
    .refine((v) => /^https:\/\//.test(v), {
      message: "R2_ENDPOINT must be an https:// URL",
    }),

  /** R2 bucket that raw OTA payloads are archived to. */
  R2_BUCKET: z.string().min(1),

  /** R2 access key id (S3-compatible credential). */
  R2_ACCESS_KEY_ID: z.string().min(1),

  /** R2 secret access key (S3-compatible credential). */
  R2_SECRET_ACCESS_KEY: z.string().min(1),

  // --- Ingest / mass-deletion abort guard (ST-9 / BRI-106) -----------------

  /**
   * Mass-deletion abort threshold, as a percentage (0–100). If a single import
   * run would soft-delete **more than** this share of a provider's currently
   * active catalogue, the whole run aborts — no upserts, no soft-deletes — on
   * the assumption that a truncated upstream response is the likelier cause than
   * a real, sudden catalogue collapse. Tunable per-provider volatility without a
   * code change; defaults to 10%.
   */
  DELETE_GUARD_THRESHOLD_PCT: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(10),

  // --- Ingest / nightly scheduler (ST-10 / BRI-107) ------------------------

  /**
   * Cron expression for the nightly import. Standard 5-field crontab syntax
   * (min hour dom mon dow). Defaults to 03:00 daily — off-peak, after any
   * upstream nightly catalogue refresh. Tunable without a code change.
   */
  IMPORT_CRON_SCHEDULE: z.string().min(1).default("0 3 * * *"),

  /**
   * Whether the nightly scheduled import is registered at boot. `true` in real
   * environments; set `false` in local dev / CI so a background crawl never
   * fires unexpectedly (a manual trigger still works regardless). Accepts
   * `true`/`false`/`1`/`0`; anything else (and unset) is treated as enabled.
   */
  IMPORT_CRON_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),

  /**
   * Minutes a run may sit in `status: "running"` before a startup safeguard
   * reaps it as `failed` (BRI-170). A run is only ever left `running` when the
   * process died mid-flight (crash, OOM kill) before its own try/catch/finally
   * got to finalize the row — normal completion, failure, and the
   * mass-deletion guard's abort all finalize themselves. Every app boot (cron
   * mode and the manual CLI both load `ImportModule`) checks for and reaps any
   * row stuck past this window. Defaults to 120 minutes — comfortably above
   * how long a real crawl+ingest takes, so it only fires on a genuinely
   * orphaned run, never a merely slow one.
   */
  IMPORT_STUCK_RUN_TIMEOUT_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(120),

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
   * as a live-only emergency stopgap before this root cause was understood.
   * Recommend reverting that live override back toward this default once the
   * memory trigger below is deployed and verified.
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

  // --- Affiliate click log (ST-24 / BRI-136) -------------------------------

  /**
   * Shared secret guarding `POST /v1/affiliate-clicks`. The web `/go` route
   * handler sends it as `x-internal-secret`; the API rejects requests without a
   * match, so the click-log write is server-to-server only (a browser can't spam
   * click rows). The web app must set the **same** value. Defaults to a
   * dev-only string so local boots without config; **override in every real
   * environment** with a strong secret.
   */
  INTERNAL_CLICK_SECRET: z.string().min(1).default("dev-internal-click-secret"),

  /**
   * Salt mixed into the SHA-256 of a click's client IP before storage, so the
   * `affiliate_clicks.ip_hash` column never derives back to a raw IP even if
   * leaked. Defaults to a dev-only value; **override in every real environment**.
   */
  IP_HASH_SALT: z.string().min(1).default("dev-ip-hash-salt"),

  // --- Hub page research CLI (BRI-206) -------------------------------------
  // Read only by `research:hub` (src/modules/research/). All optional so a
  // deployment that never runs the CLI (Railway) boots without them.

  /**
   * DataForSEO API login (the API credentials page, not the account
   * password). Secret — Doppler `dev` only, never `prd`.
   */
  DATAFORSEO_LOGIN: z.string().min(1).optional(),

  /** DataForSEO API password. Secret — Doppler `dev` only, never `prd`. */
  DATAFORSEO_PASSWORD: z.string().min(1).optional(),

  /**
   * Per run spend cap in USD for `research:hub`. Defaults to 1. The CLI clamps
   * anything above 5 down to 5 in code, so a typo here cannot raise the cap
   * past the hard maximum.
   */
  HUB_RESEARCH_MAX_USD: z.coerce.number().positive().optional(),

  /**
   * Total spend budget in USD for `research:hub`, summed from the whole local
   * ledger across every run. The per run cap restarts at zero in each process,
   * so this is the limit that holds across stages. Unset means no total budget.
   * Set it under the provider account balance, which the ledger cannot see.
   */
  HUB_RESEARCH_BUDGET_USD: z.coerce.number().positive().optional(),
});

/** Fully-parsed, typed environment. */
export type Env = z.infer<typeof envSchema>;

/**
 * Validate `process.env` against {@link envSchema}. Passed to NestJS
 * `ConfigModule.forRoot({ validate: validateEnv })`, which invokes it during
 * module initialization. Throws with a readable, aggregated message on failure.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
