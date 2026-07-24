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
 */

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

  /**
   * @param allowedHosts Exact hostnames permitted (e.g. `api.viator.com`).
   *   Matching is case-insensitive and host-only — scheme, port, and path are
   *   not part of the check, so an allowed host stays allowed across paths.
   * @param fetchImpl The underlying fetch; defaults to the global `fetch`.
   */
  constructor(
    allowedHosts: readonly string[],
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (allowedHosts.length === 0) {
      throw new Error("AllowlistFetch requires at least one allowed host");
    }
    this.allowlist = new Set(allowedHosts.map((h) => h.toLowerCase()));
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
    return this.fetchImpl(parsed, { ...init, redirect: "manual" });
  }
}
