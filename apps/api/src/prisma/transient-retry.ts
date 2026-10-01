import { Logger } from "@nestjs/common";

/**
 * Bounded retry for transient DB connection drops (BRI-210).
 *
 * The rule is: retry whole units of work, never a single query inside a
 * transaction. A unit is either a standalone query (retried by
 * `transient-retry.extension.ts`) or an entire `$transaction(...)` call
 * (wrapped at the call site in {@link withTransientRetry}). A drop mid-
 * transaction kills the transaction itself, so only a rerun from the top is
 * meaningful.
 *
 * Only idempotent work may be retried: a committed write whose ack was lost
 * runs again on retry.
 */

/**
 * Connection-class Prisma error codes. Grounded in real failures (P1001,
 * P1017, P2024 — see docs/specs/_root/bri-210-step0.md) plus the documented
 * P1002/P1008. P2028 is deliberately absent: its real occurrence was a 2 s
 * `maxWait`, fixed by config, and its other meaning (transaction `timeout`
 * elapsed) would rerun work that is too big, not unlucky.
 */
export const TRANSIENT_DB_ERROR_CODES: ReadonlySet<string> = new Set([
  "P1001", // can't reach database server
  "P1002", // database server reached but timed out
  "P1008", // operations timed out
  "P1017", // server has closed the connection
  "P2024", // timed out fetching a connection from the pool
]);

/**
 * The Prisma error code on `err`, if any. `PrismaClientKnownRequestError`
 * carries it as `code`; `PrismaClientInitializationError` (e.g. P1001 at
 * connect time) carries it as `errorCode`.
 */
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { code, errorCode } = err as { code?: unknown; errorCode?: unknown };
  if (typeof code === "string") return code;
  if (typeof errorCode === "string") return errorCode;
  return undefined;
}

export function isTransientDbError(err: unknown): boolean {
  const code = prismaErrorCode(err);
  return code !== undefined && TRANSIENT_DB_ERROR_CODES.has(code);
}

export interface RetryProfile {
  /** Total attempts, including the first. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type RetryProfileName = "import" | "web";

/**
 * `import` for long-running batch processes (import CLI, segment worker,
 * backfill/promote CLIs) where dying costs hours; `web` for the HTTP API where
 * a request must fail fast. One quick web retry still covers the
 * stale-pooled-connection P1017 case.
 */
export const RETRY_PROFILES: Readonly<Record<RetryProfileName, RetryProfile>> = {
  import: { attempts: 5, baseDelayMs: 500, maxDelayMs: 15_000 },
  web: { attempts: 2, baseDelayMs: 100, maxDelayMs: 1_000 },
};

// Per-process, selected in code by each entrypoint before it boots. Defaults to
// `web` so a forgotten selection fails fast rather than holding web requests.
let processProfile: RetryProfileName = "web";

/** Select this process's retry profile. Call at the top of an entrypoint. */
export function setDbRetryProfile(name: RetryProfileName): void {
  processProfile = name;
}

export function getDbRetryProfile(): RetryProfile & { name: RetryProfileName } {
  return { name: processProfile, ...RETRY_PROFILES[processProfile] };
}

/**
 * Exponential backoff with full jitter: a uniform draw in
 * `[0, min(cap, base * 2^(retry-1)))`. `retry` is 1 for the first retry.
 */
export function backoffDelayMs(
  retry: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (retry - 1));
  return Math.floor(random() * ceiling);
}

export interface TransientRetryOptions extends Partial<RetryProfile> {
  /** Names the unit of work in retry logs, e.g. `tour.upsertBatch`. */
  readonly label: string;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source, `[0, 1)`. */
  readonly random?: () => number;
  readonly logger?: Pick<Logger, "warn">;
}

const defaultLogger = new Logger("TransientRetry");
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying it on a transient DB error up to the profile's attempt
 * budget (the process profile unless overridden). Non-transient errors are
 * rethrown immediately; on exhaustion the last original error is rethrown.
 *
 * `fn` must be a whole, idempotent unit of work. For a `$transaction`, build
 * everything (including a batch array's queries) inside `fn`.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: TransientRetryOptions,
): Promise<T> {
  const profile = getDbRetryProfile();
  const attempts = options.attempts ?? profile.attempts;
  const baseDelayMs = options.baseDelayMs ?? profile.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? profile.maxDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? defaultLogger;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientDbError(err)) throw err;
      const delayMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs, options.random);
      logger.warn(
        `Transient DB error ${prismaErrorCode(err)} on "${options.label}" ` +
          `(attempt ${attempt}/${attempts}); retrying in ${delayMs} ms.`,
      );
      await sleep(delayMs);
    }
  }
}
