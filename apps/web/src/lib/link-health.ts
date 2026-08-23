/**
 * Link-health sampling for the affiliate registry (BRI-138 / ST-26).
 *
 * Pure and I/O-free: the actual network ping is injected as `Pinger`, so this
 * module is fully unit-testable with no live HTTP calls. `scripts/check-link-health.ts`
 * is the thin, I/O-owning wrapper that supplies a real `fetch`-based pinger and
 * writes the resulting report to `src/data/link-health-report.json`. `/go`
 * (`app/go/[slug]/[id]/route.ts`) reads that report via `isFlaggedUnhealthy` to
 * treat a previously-good link that has since gone bad the same as a missing one.
 *
 * Deliberately NOT wired to any scheduler — Render is suspended. This mirrors
 * `apps/api`'s `ImportScheduler`/`trigger-import.cli.ts` split (pure trigger
 * logic vs. cron registration) so wiring a schedule later is a small, isolated
 * change, not a rewrite.
 */

export interface LinkCheckResult {
  key: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface LinkHealthReport {
  /** ISO timestamp of the last real run, or null for the untouched placeholder report. */
  checkedAt: string | null;
  failingKeys: string[];
}

export type Pinger = (url: string) => Promise<{ ok: boolean; status?: number }>;

type LinkEntry = { affiliateUrl?: string };

/** Picks up to `sampleSize` keys, restricted to entries that actually have a link. */
export function sampleLinkKeys(
  links: Record<string, LinkEntry>,
  sampleSize: number,
  random: () => number = Math.random,
): string[] {
  const eligible = Object.entries(links)
    .filter(([, entry]) => Boolean(entry.affiliateUrl))
    .map(([key]) => key);

  // Fisher-Yates using the injected `random`, so a fixed function gives a
  // reproducible sample in tests without needing a real seeded RNG dependency.
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, sampleSize);
}

/** Pings each sampled key's URL and classifies pass/fail. Never throws on a ping failure. */
export async function checkLinkHealth(
  links: Record<string, LinkEntry>,
  keys: string[],
  ping: Pinger,
): Promise<{ checkedAt: string; results: LinkCheckResult[]; failingKeys: string[] }> {
  const results: LinkCheckResult[] = [];

  for (const key of keys) {
    const url = links[key]?.affiliateUrl;
    if (!url) continue; // sampled key lost its link between sampling and checking — skip, don't crash

    try {
      const outcome = await ping(url);
      results.push({ key, url, ok: outcome.ok, status: outcome.status });
    } catch (error) {
      results.push({
        key,
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    results,
    failingKeys: results.filter((r) => !r.ok).map((r) => r.key),
  };
}

/** Whether a link previously matched to a key has since been flagged unhealthy. */
export function isFlaggedUnhealthy(key: string, report: LinkHealthReport): boolean {
  return report.failingKeys.includes(key);
}
