import { Logger } from "@nestjs/common";

/**
 * SSRF-safe HTTP client (ST-6 / BRI-103).
 *
 * The ingest pipeline only ever needs to talk to a small, fixed set of OTA
 * hosts. Rather than expose a generic fetcher that would happily follow any URL
 * (and could be steered at internal metadata endpoints or arbitrary hosts if a
 * malicious/ buggy value ever reached it), every outbound request is checked
 * against an explicit host allowlist first. A non-allowlisted host is rejected
 * before the socket is ever opened.
 *
 * This wraps the platform `fetch` (Node 22 global) so it stays trivially
 * mockable in tests — the concrete `fetch` is injected.
 *
 * Every request also carries a timeout (BRI-171 / docs/13's audit found none
 * was configured anywhere in the ingest pipeline). Callers may still pass
 * their own `signal` to opt out per-call; absent one, a request that hangs
 * past {@link DEFAULT_TIMEOUT_MS} aborts rather than blocking forever — load-
 * bearing for `price-resolver.ts`/`location-resolver.ts`, whose bounded
 * concurrency pools would otherwise have a slot occupied indefinitely by one
 * stalled connection.
 */

/**
 * Default request timeout in ms, used only if a caller constructs
 * {@link AllowlistFetch} without an explicit `timeoutMs` (production always
 * passes one, from `VIATOR_REQUEST_TIMEOUT_MS`). 60s — see that env var's doc
 * comment in `env.validation.ts` for why: a live full-catalog crawl (BRI-171)
 * proved a shorter value wrong in practice.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Optional tuning for {@link AllowlistFetch}. */
export interface AllowlistFetchOptions {
  /** Per-request timeout in ms, applied when the caller supplies no `signal`. */
  timeoutMs?: number;
}

/** Thrown when a request targets a host that is not on the allowlist. */
export class HostNotAllowedError extends Error {
  constructor(
    readonly host: string,
    readonly allowlist: readonly string[],
  ) {
    super(
      `Refusing request to non-allowlisted host "${host}". ` +
        `Allowed: ${allowlist.join(", ")}`,
    );
    this.name = "HostNotAllowedError";
  }
}

/** Minimal shape of the global `fetch` we depend on (injectable for tests). */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export class AllowlistFetch {
  private readonly logger = new Logger(AllowlistFetch.name);
  private readonly allowlist: ReadonlySet<string>;
  private readonly timeoutMs: number;

  /**
   * @param allowedHosts Exact hostnames permitted (e.g. `api.viator.com`).
   *   Matching is case-insensitive and host-only — scheme, port, and path are
   *   not part of the check, so an allowed host stays allowed across paths.
   * @param fetchImpl The underlying fetch; defaults to the global `fetch`.
   * @param options Tuning; see {@link AllowlistFetchOptions}.
   */
  constructor(
    allowedHosts: readonly string[],
    private readonly fetchImpl: FetchLike = fetch,
    options: AllowlistFetchOptions = {},
  ) {
    if (allowedHosts.length === 0) {
      throw new Error("AllowlistFetch requires at least one allowed host");
    }
    this.allowlist = new Set(allowedHosts.map((h) => h.toLowerCase()));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Hosts this instance will permit (lower-cased), for diagnostics/tests. */
  get allowedHosts(): string[] {
    return [...this.allowlist];
  }

  /**
   * Fetch `url`, but only if its host is on the allowlist. Rejects with
   * {@link HostNotAllowedError} otherwise. Redirects are disabled (`manual`) so
   * a 3xx to an internal host cannot bypass the check via the redirect chain.
   */
  async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const parsed = url instanceof URL ? url : new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (!this.allowlist.has(host)) {
      this.logger.warn(`Blocked outbound request to "${host}" (not allowlisted)`);
      throw new HostNotAllowedError(host, [...this.allowlist]);
    }

    if (parsed.protocol !== "https:") {
      throw new HostNotAllowedError(host, [...this.allowlist]);
    }

    // `redirect: "manual"` wins over any caller value — a followed 3xx could
    // otherwise land on a non-allowlisted (e.g. internal) host post-check.
    // `signal` defaults to a per-request timeout when the caller supplies
    // none, so a stalled connection aborts instead of hanging indefinitely.
    return this.fetchImpl(parsed, {
      ...init,
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
  }
}
