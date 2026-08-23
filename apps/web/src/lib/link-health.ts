/**
 * Link-health checker for matched Viator affiliate links (BRI-138 / ST-26,
 * FR-AFF-3: "a scheduled job pings a sample and flags failures in a
 * report"). This module is the pure, testable core; it is NOT wired to any
 * scheduler here — Render is currently suspended and scheduling is
 * deliberately deferred. `apps/web/scripts/check-link-health.mjs` runs the
 * same algorithm as a manually-invoked CLI, ready for a future cron (Vercel
 * Cron, a GitHub Action, or the API's `ImportScheduler` pattern) to call.
 *
 * **Known limitation (confirmed by manual testing, 2026-08-24):** viator.com
 * sits behind DataDome, a bot-detection WAF that returns HTTP 403 to
 * essentially any non-browser HTTP client — confirmed via direct `curl` both
 * with no `User-Agent` and with a realistic desktop Chrome `User-Agent`;
 * both were blocked identically (`server: DataDome`, `x-datadome:
 * protected`). This isn't a missing-header bug: DataDome fingerprints
 * TLS/JA3, executes JS challenges, and reads behavioral signals that a plain
 * `fetch`/`curl` request cannot satisfy, so bypassing it isn't attempted
 * here (that would mean evading a partner site's anti-bot protection, which
 * this checker does not do). Instead, `pingOne` recognizes the DataDome
 * signature and reports it as `blocked: true` — an inconclusive result,
 * distinct from a genuine dead link (404, timeout, DNS failure, a
 * non-DataDome 5xx). A report where every entry is `blocked` means "Viator's
 * bot protection intercepted this run," not "every link is dead."
 */

export interface LinkHealthResult {
  /** Registry key, e.g. "bangkok/grand-palace-wat-phra-kaew". */
  key: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  /**
   * True when `status` is a DataDome bot-protection challenge (403 with a
   * `server: DataDome` or `x-datadome` response header), not a real
   * failure signal — see the module-level doc comment above.
   */
  blocked?: boolean;
}

export interface CheckLinkHealthOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Ping at most this many entries (a random subset). Default: all. */
  sampleSize?: number;
  /** Per-request timeout before treating a link as failed. Default: 8000ms. */
  timeoutMs?: number;
  /** Injectable RNG for deterministic sampling in tests. Default: Math.random. */
  random?: () => number;
}

interface Entry {
  key: string;
  url: string;
}

/** Pings a sample of `links`' matched `affiliateUrl`s and reports failures. */
export async function checkLinkHealth(
  links: Record<string, { affiliateUrl?: string }>,
  options: CheckLinkHealthOptions = {},
): Promise<LinkHealthResult[]> {
  const { fetchImpl = fetch, sampleSize, timeoutMs = 8000, random = Math.random } = options;

  const entries: Entry[] = Object.entries(links)
    .filter((pair): pair is [string, { affiliateUrl: string }] => Boolean(pair[1]?.affiliateUrl))
    .map(([key, value]) => ({ key, url: value.affiliateUrl! }));

  const sample = sampleEntries(entries, sampleSize, random);

  return Promise.all(sample.map((entry) => pingOne(entry, fetchImpl, timeoutMs)));
}

/** Picks `sampleSize` entries at random (or all of them if unset/too large). */
function sampleEntries(entries: Entry[], sampleSize: number | undefined, random: () => number): Entry[] {
  if (sampleSize === undefined || sampleSize >= entries.length) return entries;
  const pool = [...entries];
  const picked: Entry[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** True when `response` is a DataDome bot-protection challenge, not a real failure. */
function isBotBlocked(response: Response): boolean {
  return response.status === 403 && response.headers.get("server") === "DataDome";
}

/** HEAD first (cheaper); falls back to GET if the server rejects HEAD. */
async function pingOne(entry: Entry, fetchImpl: typeof fetch, timeoutMs: number): Promise<LinkHealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(entry.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(entry.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    }
    if (isBotBlocked(response)) {
      return { key: entry.key, url: entry.url, ok: false, status: response.status, blocked: true };
    }
    return { key: entry.key, url: entry.url, ok: response.ok, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { key: entry.key, url: entry.url, ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
