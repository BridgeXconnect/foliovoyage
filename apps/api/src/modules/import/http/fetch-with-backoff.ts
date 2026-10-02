import type { Logger } from "@nestjs/common";

import { HostNotAllowedError } from "./allowlist-fetch";

/**
 * Shared HTTP retry for Viator calls (extracted from `ViatorClient` in BRI-183).
 *
 * One retry unit is **the request plus the body read**: a slow or truncated
 * read is as transient as a failed connection (BRI-182). Retried: any thrown
 * error from the request or the read (an `AllowlistFetch` timeout surfaces as a
 * `DOMException` named `TimeoutError`; network failures as `TypeError: fetch
 * failed` or a raw socket/TLS error) and the statuses in
 * {@link RETRYABLE_STATUSES}. Not retried: {@link HostNotAllowedError} (a
 * config error, deterministic) and any other non-success status. Parsing the
 * body belongs to the caller, outside this unit, so a malformed 2xx payload
 * fails once instead of burning the backoff budget.
 *
 * Exponential backoff with full jitter, a `Retry-After` (delta-seconds) taking
 * precedence when sent, both capped at `maxDelayMs`.
 *
 * This is HTTP-only. DB retry is a separate concern with its own error
 * classification: `src/prisma/transient-retry.ts` (BRI-210).
 */

/** Backoff tuning. All optional; defaults in {@link DEFAULT_HTTP_BACKOFF}. */
export interface BackoffOptions {
  /** Max attempts per request before giving up (incl. the first). Default 5. */
  maxRetries?: number;
  /** Base delay in ms for the exponential schedule. Default 500. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff delay in ms. Default 30_000. */
  maxDelayMs?: number;
}

export const DEFAULT_HTTP_BACKOFF: Required<BackoffOptions> = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/** Fill unset (or `undefined`) fields of `backoff` from {@link DEFAULT_HTTP_BACKOFF}. */
export function withBackoffDefaults(
  backoff: BackoffOptions = {},
): Required<BackoffOptions> {
  return {
    maxRetries: backoff.maxRetries ?? DEFAULT_HTTP_BACKOFF.maxRetries,
    baseDelayMs: backoff.baseDelayMs ?? DEFAULT_HTTP_BACKOFF.baseDelayMs,
    maxDelayMs: backoff.maxDelayMs ?? DEFAULT_HTTP_BACKOFF.maxDelayMs,
  };
}

/** Injectable delay so tests don't actually sleep. */
export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

export interface FetchWithBackoffOptions {
  /** Subject of log lines and error messages, e.g. `"Viator"`. */
  name: string;
  /** Appended to each retry log line, e.g. `", batch of 500 ref(s)"`. */
  logContext?: string;
  backoff: Required<BackoffOptions>;
  logger: Logger;
  sleep: Sleep;
  /** RNG for jitter, returns [0, 1). */
  random: () => number;
  /**
   * Which responses are handed to `read` as a success. Default `response.ok`.
   * Everything else is a retryable or a terminal status.
   */
  isSuccess?: (response: Response) => boolean;
}

/**
 * Run `request`, then `read` on a successful response, as one retry unit.
 * Throws on a non-retryable status, on {@link HostNotAllowedError}, or once
 * `backoff.maxRetries` attempts have failed (the message carries the last
 * error's message or status).
 */
export async function fetchWithBackoff<T>(
  request: () => Promise<Response>,
  read: (response: Response) => Promise<T>,
  options: FetchWithBackoffOptions,
): Promise<T> {
  const { name, backoff, logger, sleep } = options;
  const isSuccess = options.isSuccess ?? ((r: Response) => r.ok);
  const logContext = options.logContext ?? "";
  const { maxRetries } = backoff;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    let response: Response;
    let result: T | undefined;
    let succeeded = false;
    try {
      response = await request();
      if (isSuccess(response)) {
        result = await read(response);
        succeeded = true;
      }
    } catch (error) {
      // A configuration error, not a transient one — retrying it changes
      // nothing (the URL's host doesn't change between attempts), so it
      // must fail immediately rather than burn through the retry budget.
      if (error instanceof HostNotAllowedError) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        lastError = new Error(
          `${name} request failed after ${maxRetries} attempts: ${message}`,
        );
        break;
      }
      const delay = backoffDelay(attempt, null, options);
      logger.warn(
        `${name} request errored (${describeError(error)}); backing off ${delay}ms ` +
          `(attempt ${attempt + 1}/${maxRetries})${logContext}`,
      );
      await sleep(delay);
      continue;
    }

    if (succeeded) return result as T;

    if (!RETRYABLE_STATUSES.has(response.status)) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${name} request failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }

    const isLastAttempt = attempt === maxRetries - 1;
    if (isLastAttempt) {
      lastError = new Error(
        `${name} request failed after ${maxRetries} attempts: ` +
          `last status ${response.status}`,
      );
      break;
    }

    const delay = backoffDelay(
      attempt,
      response.headers.get("retry-after"),
      options,
    );
    logger.warn(
      `${name} returned ${response.status}; backing off ${delay}ms ` +
        `(attempt ${attempt + 1}/${maxRetries})${logContext}`,
    );
    await sleep(delay);
  }

  throw lastError ?? new Error(`${name} request failed`);
}

/**
 * Exponential backoff with full jitter: `random(0, base * 2^attempt)`, capped
 * at `maxDelayMs`. If Viator sent a `Retry-After` (delta-seconds), that value
 * is respected as a floor instead.
 */
function backoffDelay(
  attempt: number,
  retryAfter: string | null,
  { backoff, random }: FetchWithBackoffOptions,
): number {
  const retryAfterMs = parseRetryAfter(retryAfter);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, backoff.maxDelayMs);
  }
  const ceiling = Math.min(
    backoff.baseDelayMs * 2 ** attempt,
    backoff.maxDelayMs,
  );
  return Math.floor(random() * ceiling);
}

/** Parse a `Retry-After` delta-seconds value to ms; `undefined` if absent. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  return undefined;
}

/**
 * Log reason for a thrown error: its name when that adds information (e.g.
 * `TimeoutError`, `TypeError`), then its message.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.name && error.name !== "Error"
    ? `${error.name}: ${error.message}`
    : error.message;
}
