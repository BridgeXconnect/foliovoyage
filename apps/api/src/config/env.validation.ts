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
