import { Logger } from "@nestjs/common";

import { AllowlistFetch, HostNotAllowedError } from "../http/allowlist-fetch";
import type { RawArchiveStore } from "../storage/raw-archive.store";
import {
  viatorModifiedSinceResponseSchema,
  type ViatorProduct,
} from "./viator.types";

/**
 * Viator OTA client (ST-6 / BRI-103).
 *
 * Fetches product content from Viator's Partner API
 * `GET /products/modified-since`, walking the cursor to completion. It is
 * resilient by design:
 *
 * - **Rate limits** — retries 429 (and transient 5xx) with exponential backoff
 *   plus jitter, honouring a `Retry-After` header when Viator sends one.
 * - **Replay safety** — every page is archived verbatim to R2
 *   (`raw/viator/{date}/{page}.json`) *before* it is yielded, so downstream
 *   normalization (ST-7) works from the archive and can be re-run at will.
 * - **SSRF-safe** — all traffic goes through {@link AllowlistFetch}, which only
 *   permits Viator's API host.
 *
 * Auth is the v2 `exp-api-key` header; `Accept: application/json;version=2.0`
 * and `Accept-Language` are sent on every request.
 *
 * Pagination note: Viator's *own* delta mechanism for this endpoint is the
 * `modified-since` query param + `nextCursor`, not HTTP ETags. HTTP conditional
 * requests are still wired through ({@link FetchPageResult.etag} /
 * `ifNoneMatch`) so that, on replay against an endpoint that emits an `ETag`, an
 * unchanged page returns 304 and is neither re-parsed nor re-archived.
 */

export interface ViatorClientConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
}

/** Backoff tuning. All optional; sensible defaults below. */
export interface BackoffOptions {
  /** Max attempts per page before giving up (incl. the first). Default 5. */
  maxRetries?: number;
  /** Base delay in ms for the exponential schedule. Default 500. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff delay in ms. Default 30_000. */
  maxDelayMs?: number;
}

/** Options for a crawl of `/products/modified-since`. */
export interface FetchModifiedSinceOptions {
  /**
   * ISO-8601 timestamp for a delta/re-sync crawl. Sent only on the first
   * request; subsequent requests page with `cursor` alone (per Viator's
   * guidance). Omit for a full initial ingest.
   */
  modifiedSince?: string;
  /** Page size (Viator max 500). Default 500. */
  count?: number;
  /**
   * Archive date partition, `YYYY-MM-DD`. Defaults to today (UTC). Injectable
   * so a re-sync can be filed under a chosen date.
   */
  date?: string;
}

/** One archived, parsed page handed back to the caller. */
export interface ViatorPage {
  /** 1-based page number within this crawl. */
  page: number;
  /** Products in this page (opaque; normalized in ST-7). */
  products: ViatorProduct[];
  /** Cursor for the next page, or `undefined` at the end of the crawl. */
  nextCursor?: string;
  /** `ETag` for this page if the endpoint emitted one (for later replay). */
  etag?: string;
  /** Where the raw bytes were archived. */
  archive: { bucket: string; key: string };
}

/** Result of a single HTTP page fetch (post-retry). */
interface FetchPageResult {
  status: number;
  /** Raw response body text (archived verbatim). */
  body: string;
  /** `ETag` response header, if the endpoint provided one. */
  etag?: string;
}

/** Injectable delay so tests don't actually sleep. */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class ViatorClient {
  private readonly logger = new Logger(ViatorClient.name);
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly config: ViatorClientConfig,
    private readonly http: AllowlistFetch,
    private readonly archive: RawArchiveStore,
    backoff: BackoffOptions = {},
    private readonly sleep: Sleep = defaultSleep,
    /** Injectable RNG for deterministic jitter in tests. Returns [0, 1). */
    private readonly random: () => number = Math.random,
  ) {
    this.maxRetries = backoff.maxRetries ?? 5;
    this.baseDelayMs = backoff.baseDelayMs ?? 500;
    this.maxDelayMs = backoff.maxDelayMs ?? 30_000;
  }

  /**
   * Crawl `/products/modified-since` to completion, yielding one page at a
   * time. Each page is archived to R2 before it is yielded, so a consumer that
   * dies mid-crawl still leaves a replayable trail on disk.
   */
  async *fetchModifiedSince(
    options: FetchModifiedSinceOptions = {},
  ): AsyncGenerator<ViatorPage> {
    const count = options.count ?? 500;
    const date = options.date ?? new Date().toISOString().slice(0, 10);

    let cursor: string | undefined;
    let pageNumber = 0;

    do {
      pageNumber += 1;
      const url = this.buildUrl({
        count,
        cursor,
        // modified-since only on the first request; cursor drives the rest.
        modifiedSince: pageNumber === 1 ? options.modifiedSince : undefined,
      });

      const result = await this.fetchPageWithBackoff(url);

      // Archive raw bytes BEFORE parsing/yielding — the replay safety net must
      // not depend on the payload being well-formed.
      const archived = await this.archive.putRawPage(
        { source: "viator", date, page: pageNumber },
        result.body,
      );

      const parsed = viatorModifiedSinceResponseSchema.parse(
        JSON.parse(result.body),
      );

      yield {
        page: pageNumber,
        products: parsed.products,
        nextCursor: parsed.nextCursor,
        etag: result.etag,
        archive: archived,
      };

      // Empty/absent nextCursor ends the crawl.
      cursor = parsed.nextCursor && parsed.nextCursor.length > 0
        ? parsed.nextCursor
        : undefined;
    } while (cursor);
  }

  /** Build the `/products/modified-since` URL with query params. */
  private buildUrl(params: {
    count: number;
    cursor?: string;
    modifiedSince?: string;
  }): URL {
    // Ensure a single slash between base and path regardless of trailing slash.
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/products/modified-since`);
    url.searchParams.set("count", String(params.count));
    if (params.cursor) url.searchParams.set("cursor", params.cursor);
    if (params.modifiedSince) {
      url.searchParams.set("modified-since", params.modifiedSince);
    }
    return url;
  }

  /**
   * Fetch one page, retrying 429/5xx **and** a thrown network/timeout error
   * with exponential backoff + jitter. Throws on a non-retryable error status
   * or once retries are exhausted.
   *
   * BRI-171 live verification (2026-08-18, full-catalog crawl against
   * production): the request-timeout added in this story fired on a page deep
   * into a long crawl and — because a *thrown* error (as opposed to an HTTP
   * status this method already handled) had no retry path at all — killed the
   * entire run outright. The same gap is why an earlier run failed on a raw
   * TLS handshake error (`write EPROTO … ssl3_read_bytes`, 2026-07-26): a
   * transient network failure got zero retry tolerance while a 5xx got five.
   * Both are transient failures a long crawl must tolerate, so both now share
   * the same backoff loop — except {@link HostNotAllowedError}, a
   * configuration error the SSRF guard raises synchronously from the URL
   * alone, which is deterministic and re-thrown immediately: retrying it
   * wastes the whole backoff budget on a call that can never succeed.
   */
  private async fetchPageWithBackoff(
    url: URL,
    ifNoneMatch?: string,
  ): Promise<FetchPageResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.http.fetch(url, {
          method: "GET",
          headers: this.buildHeaders(ifNoneMatch),
        });
      } catch (error) {
        // A configuration error, not a transient one — retrying it changes
        // nothing (the URL's host doesn't change between attempts), so it
        // must fail immediately rather than burn through the retry budget.
        if (error instanceof HostNotAllowedError) throw error;

        const message = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === this.maxRetries - 1;
        if (isLastAttempt) {
          lastError = new Error(
            `Viator request failed after ${this.maxRetries} attempts: ${message}`,
          );
          break;
        }
        const delay = this.backoffDelay(attempt, null);
        this.logger.warn(
          `Viator request errored (${message}); backing off ${delay}ms ` +
            `(attempt ${attempt + 1}/${this.maxRetries})`,
        );
        await this.sleep(delay);
        continue;
      }

      // 304: the page is unchanged — nothing to re-parse or re-archive.
      if (response.status === 304) {
        return { status: 304, body: "", etag: ifNoneMatch };
      }

      if (response.ok) {
        return {
          status: response.status,
          body: await response.text(),
          etag: response.headers.get("etag") ?? undefined,
        };
      }

      if (!RETRYABLE_STATUSES.has(response.status)) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Viator request failed: ${response.status} ${response.statusText} ${body}`.trim(),
        );
      }

      const isLastAttempt = attempt === this.maxRetries - 1;
      if (isLastAttempt) {
        lastError = new Error(
          `Viator request failed after ${this.maxRetries} attempts: ` +
            `last status ${response.status}`,
        );
        break;
      }

      const delay = this.backoffDelay(attempt, response.headers.get("retry-after"));
      this.logger.warn(
        `Viator returned ${response.status}; backing off ${delay}ms ` +
          `(attempt ${attempt + 1}/${this.maxRetries})`,
      );
      await this.sleep(delay);
    }

    throw lastError ?? new Error("Viator request failed");
  }

  /**
   * Exponential backoff with full jitter: `random(0, base * 2^attempt)`, capped
   * at `maxDelayMs`. If Viator sent a `Retry-After` (delta-seconds), that value
   * is respected as a floor instead.
   */
  private backoffDelay(attempt: number, retryAfter: string | null): number {
    const retryAfterMs = this.parseRetryAfter(retryAfter);
    if (retryAfterMs !== undefined) {
      return Math.min(retryAfterMs, this.maxDelayMs);
    }
    const ceiling = Math.min(
      this.baseDelayMs * 2 ** attempt,
      this.maxDelayMs,
    );
    return Math.floor(this.random() * ceiling);
  }

  /** Parse a `Retry-After` delta-seconds value to ms; `undefined` if absent. */
  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    return undefined;
  }

  private buildHeaders(ifNoneMatch?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "exp-api-key": this.config.apiKey,
      Accept: "application/json;version=2.0",
      "Accept-Language": this.config.language,
    };
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    return headers;
  }
}
