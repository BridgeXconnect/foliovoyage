import { Logger } from "@nestjs/common";

import type { AllowlistFetch } from "../http/allowlist-fetch";
import {
  defaultSleep,
  fetchWithBackoff,
  withBackoffDefaults,
  type BackoffOptions,
  type Sleep,
} from "../http/fetch-with-backoff";
import type { RawArchiveStore } from "../storage/raw-archive.store";
import {
  viatorBulkResponseSchema,
  viatorModifiedSinceResponseSchema,
  type ViatorProduct,
} from "./viator.types";

/** Viator's documented maximum for `POST /products/bulk` (`productCodes`). */
export const VIATOR_BULK_MAX_CODES = 500;

/**
 * Archive `source` for by-code payloads (BRI-227). A source of its own, so a
 * re-fetch can never overwrite a nightly crawl's `raw/viator/{date}/{page}.json`;
 * the key keeps the `raw/{source}/{date}/{n}.json` shape the BRI-218 archive
 * reader expects, with `n` the numeric batch index.
 */
export const REFETCH_ARCHIVE_SOURCE = "viator-refetch";

/** Options for {@link ViatorClient.fetchProductsByCode}. */
export interface FetchProductsByCodeOptions {
  /** Numeric batch index; becomes the archive key's `{n}`. */
  batch: number;
  /** Archive date partition, `YYYY-MM-DD`. Defaults to today (UTC). */
  date?: string;
}

/** One by-code batch, archived and parsed. */
export interface ViatorCodeBatch {
  /** Products Viator returned — ACTIVE and INACTIVE alike; the caller decides. */
  products: ViatorProduct[];
  /**
   * Codes Viator refused as invalid (`400 Invalid product code: X`) and the
   * client dropped from the request before resending. Never deleted anywhere.
   */
  rejectedCodes: string[];
  /**
   * Every code of the batch, when a 400 could not be attributed to a code in
   * the batch (unparseable body, or it names a code we did not send). Nothing
   * was fetched and nothing is archived; the codes are neither invalid nor
   * missing, just unresolved. Never deleted anywhere.
   */
  unresolvedCodes: string[];
  /** Where the response body was archived, or `null` if nothing was fetched. */
  archive: { bucket: string; key: string } | null;
}

/** `{"code":"BAD_REQUEST","message":"Invalid product code: ZZZ"}` (observed 2026-10-02). */
const INVALID_CODE_RE = /^Invalid product code:\s*(\S+)/;

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
 *
 * **BRI-176.** {@link FetchModifiedSinceOptions.startCursor} and `startPage`
 * let a caller resume a crawl mid-flight rather than only ever starting one
 * from scratch. `import.pipeline.ts` uses this to periodically tear down and
 * restart this generator, which forces release of memory that otherwise
 * accumulates for the lifetime of one continuous `fetchModifiedSince()`
 * consumption (confirmed by local heap profiling — see that file's docstring).
 */

export interface ViatorClientConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
}

// Backoff lives in `../http/fetch-with-backoff.ts` (shared with
// `LocationResolver`, BRI-183); re-exported so existing imports keep working.
export type { BackoffOptions, Sleep };

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
  /**
   * Resume pagination from this cursor instead of starting a fresh crawl
   * (BRI-176). When set, `modifiedSince` is never sent on the first request
   * of this call — the cursor already encodes the crawl's position, matching
   * this endpoint's existing "modified-since only on the first request"
   * contract.
   */
  startCursor?: string;
  /**
   * Page number to start counting from (BRI-176), so a caller that
   * periodically restarts this generator to force memory release (see
   * `import.pipeline.ts`) gets continuously-numbered pages across restarts.
   * Archive keys (`raw/{source}/{date}/{page}.json`) are keyed on this
   * number — restarting without it would silently overwrite earlier pages'
   * archives.
   */
  startPage?: number;
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
  /** Cursor this page's request carried (BRI-227); absent on a from-scratch first page. */
  cursorSent?: string;
  /** HTTP status of the response that was accepted (BRI-227). */
  status?: number;
  /** HTTP attempts it took, retries included; 1 means no retry (BRI-227). */
  attempts?: number;
}

/** Result of a single HTTP page fetch (post-retry). */
interface FetchPageResult {
  status: number;
  /** Attempts made by the retry helper, counted by the request closure. */
  attempts?: number;
  /** Raw response body text (archived verbatim). */
  body: string;
  /** `ETag` response header, if the endpoint provided one. */
  etag?: string;
}

export class ViatorClient {
  private readonly logger = new Logger(ViatorClient.name);
  private readonly backoff: Required<BackoffOptions>;

  constructor(
    private readonly config: ViatorClientConfig,
    private readonly http: AllowlistFetch,
    private readonly archive: RawArchiveStore,
    backoff: BackoffOptions = {},
    private readonly sleep: Sleep = defaultSleep,
    /** Injectable RNG for deterministic jitter in tests. Returns [0, 1). */
    private readonly random: () => number = Math.random,
  ) {
    this.backoff = withBackoffDefaults(backoff);
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

    let cursor: string | undefined = options.startCursor;
    let pageNumber = options.startPage ?? 0;

    do {
      pageNumber += 1;
      const url = this.buildUrl({
        count,
        cursor,
        // modified-since only on the first request of a from-scratch crawl;
        // a resumed crawl (startCursor set) never sends it — the cursor
        // alone drives pagination from here (BRI-176).
        modifiedSince:
          pageNumber === 1 && cursor === undefined
            ? options.modifiedSince
            : undefined,
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
        cursorSent: cursor,
        status: result.status,
        attempts: result.attempts,
      };

      // Empty/absent nextCursor ends the crawl.
      cursor = parsed.nextCursor && parsed.nextCursor.length > 0
        ? parsed.nextCursor
        : undefined;
    } while (cursor);
  }

  /**
   * Fetch up to {@link VIATOR_BULK_MAX_CODES} products by code with
   * `POST /products/bulk` (BRI-227), archive the response body **as returned**
   * (a bare array, not reshaped) before parsing it, and hand the products back.
   *
   * Same retry unit as the crawl ({@link fetchWithBackoff}: request plus body
   * read, 429/5xx/network errors, `Retry-After`). One difference by-code needs:
   * observed 2026-10-02, a single invalid code fails the *whole* request with
   * `400 {"message":"Invalid product code: X"}`. A bad code must not sink 499
   * good ones, so a 400 naming a code in the request drops that code (recorded
   * in `rejectedCodes`) and the rest is resent, at most `codes.length` times
   * (one per code, so it cannot loop). A 400 that does not name a code from
   * this batch is not guessed at: the whole batch comes back as
   * `unresolvedCodes`. The 400 itself is never retried (not in the retryable
   * set), and only 200 responses are archived.
   *
   * Policy note: Viator's docs say this endpoint is not for ingesting the
   * catalogue. It is only used by the one-off BRI-227 repair CLI.
   */
  async fetchProductsByCode(
    codes: readonly string[],
    options: FetchProductsByCodeOptions,
  ): Promise<ViatorCodeBatch> {
    if (codes.length === 0 || codes.length > VIATOR_BULK_MAX_CODES) {
      throw new Error(
        `fetchProductsByCode takes 1..${VIATOR_BULK_MAX_CODES} codes, got ${codes.length}.`,
      );
    }
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    let remaining = [...codes];
    const rejectedCodes: string[] = [];

    // Each 400 removes one code, so `codes.length` bounds the resends.
    for (let attempt = 0; attempt <= codes.length && remaining.length > 0; attempt++) {
      const result = await this.postBulkWithBackoff(remaining);

      if (result.status === 400) {
        const bad = invalidCodeFrom(result.body);
        if (bad === undefined || !remaining.includes(bad)) {
          this.logger.error(
            `Unattributable 400 for a bulk batch of ${codes.length} code(s); ` +
              `marking the batch unresolved: ${result.body.slice(0, 300)}`,
          );
          return {
            products: [],
            rejectedCodes: [],
            unresolvedCodes: [...codes],
            archive: null,
          };
        }
        rejectedCodes.push(bad);
        remaining = remaining.filter((code) => code !== bad);
        continue;
      }

      // Archive the raw bytes BEFORE parsing, as the crawl does.
      const archived = await this.archive.putRawPage(
        { source: REFETCH_ARCHIVE_SOURCE, date, page: options.batch },
        result.body,
      );
      const products = viatorBulkResponseSchema.parse(JSON.parse(result.body));
      return { products, rejectedCodes, unresolvedCodes: [], archive: archived };
    }

    return { products: [], rejectedCodes, unresolvedCodes: [], archive: null };
  }

  private async postBulkWithBackoff(
    codes: readonly string[],
  ): Promise<FetchPageResult> {
    const url = new URL(
      `${this.config.baseUrl.replace(/\/+$/, "")}/products/bulk`,
    );
    return fetchWithBackoff(
      () =>
        this.http.fetch(url, {
          method: "POST",
          headers: {
            ...this.buildHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productCodes: codes }),
        }),
      async (response): Promise<FetchPageResult> => ({
        status: response.status,
        body: await response.text(),
      }),
      {
        name: "Viator",
        logContext: `, bulk batch of ${codes.length} code(s)`,
        backoff: this.backoff,
        logger: this.logger,
        sleep: this.sleep,
        random: this.random,
        // A 400 is handed to the caller (see fetchProductsByCode), not thrown.
        isSuccess: (response) => response.ok || response.status === 400,
      },
    );
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
    // The helper does not expose how many attempts it made; the request
    // closure runs once per attempt, so count there (BRI-227).
    let attempts = 0;
    const result = await fetchWithBackoff(
      () => {
        attempts += 1;
        return this.http.fetch(url, {
          method: "GET",
          headers: this.buildHeaders(ifNoneMatch),
        });
      },
      // The body read is inside the retry unit (BRI-182 diagnostic session,
      // 2026-09-02 — this method previously only wrapped the `fetch()` call).
      async (response): Promise<FetchPageResult> =>
        // 304: the page is unchanged — nothing to re-parse or re-archive.
        response.status === 304
          ? { status: 304, body: "", etag: ifNoneMatch }
          : {
              status: response.status,
              body: await response.text(),
              etag: response.headers.get("etag") ?? undefined,
            },
      {
        name: "Viator",
        backoff: this.backoff,
        logger: this.logger,
        sleep: this.sleep,
        random: this.random,
        isSuccess: (response) => response.ok || response.status === 304,
      },
    );
    return { ...result, attempts };
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

/** The code a `400 Invalid product code: X` body names, or `undefined`. */
function invalidCodeFrom(body: string): string | undefined {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === "string"
      ? INVALID_CODE_RE.exec(message)?.[1]
      : undefined;
  } catch {
    return undefined;
  }
}

