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
