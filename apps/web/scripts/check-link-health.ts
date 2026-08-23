// Manually-run link-health check for the Viator affiliate registry (BRI-138 /
// ST-26). Samples a subset of live productUrls, pings each with a real HEAD
// request (falling back to GET on a 405, since some hosts reject HEAD), and
// writes the pass/fail report `/go` reads to decide whether a previously-good
// link should now fall back to provider search.
//
// This is deliberately NOT registered on any cron/scheduler — Render is
// suspended. It mirrors apps/api's ImportScheduler/trigger-import.cli.ts split:
// pure check logic (src/lib/link-health.ts, unit-tested) vs. this thin,
// I/O-owning trigger — so wiring a real schedule later only touches this file's
// caller, not the tested logic.
//
// Usage (from apps/web/): pnpm run link-health:check
//   Optional: LINK_HEALTH_SAMPLE_SIZE=10 pnpm run link-health:check

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleLinkKeys, checkLinkHealth, type Pinger } from "../src/lib/link-health";

const dataDir = join(__dirname, "..", "src", "data");
const linksPath = join(dataDir, "viator-links.json");
const reportPath = join(dataDir, "link-health-report.json");

const SAMPLE_SIZE = Number(process.env.LINK_HEALTH_SAMPLE_SIZE ?? "10");
const TIMEOUT_MS = 8000;

type LinkEntry = { affiliateUrl?: string };

// Real browser headers (BRI-180). A bare Node `fetch` with no headers is an
// instant, uniform tell for anti-bot layers — but for viator.com specifically
// these alone are NOT sufficient (verified by hand): the site is fronted by
// DataDome, which walls off the *entire* domain (including the homepage, and
// even a fabricated/nonexistent product path) with an identical 403 + a
// "Please enable JS and disable any ad blocker" challenge page, regardless of
// headers, User-Agent, or Accept-* — it fingerprints the TLS/HTTP client
// itself, not just request headers. So a real 403-vs-200 signal from a plain
// server-side fetch isn't achievable here; the headers below are still sent
// (correct hygiene, and harmless), but the actual fix is detecting DataDome's
// stable signature and treating it as inconclusive rather than "unhealthy" —
// see below.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** True when a response is DataDome's bot-challenge wall, not the real target page. */
function isBotChallenge(res: Response): boolean {
  return res.status === 403 && res.headers.get("server")?.toLowerCase() === "datadome";
}

/**
 * HEAD first (cheaper); a 405 means the host doesn't support it, so retry with GET.
 *
 * A DataDome challenge (see BRI-180 note above) is reported as `ok: true` —
 * not because the link is confirmed healthy, but because it's NOT confirmed
 * broken, and this report drives `/go` routing real traffic away from a link
 * the moment it's flagged. Treating "blocked by anti-bot" the same as
 * "unhealthy" would cascade into needlessly routing working links to
 * fallback search on every run. A genuine failure (real non-DataDome error
 * status, timeout, network error) still fails normally below.
 */
const ping: Pinger = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: "HEAD", headers: BROWSER_HEADERS, signal: controller.signal });
    if (res.status === 405) {
      res = await fetch(url, { method: "GET", headers: BROWSER_HEADERS, signal: controller.signal });
    }
    if (isBotChallenge(res)) {
      console.warn(`  (blocked by DataDome bot-challenge, not treated as unhealthy) ${url}`);
      return { ok: true, status: res.status };
    }
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
};

async function main() {
  const links: Record<string, LinkEntry> = JSON.parse(readFileSync(linksPath, "utf8"));
  const keys = sampleLinkKeys(links, SAMPLE_SIZE);

  if (keys.length === 0) {
    console.log("No matched links to check (viator-links.json has no affiliateUrl entries).");
    return;
  }

  console.log(`Checking ${keys.length} of ${Object.keys(links).length} links...`);
  const { checkedAt, results, failingKeys } = await checkLinkHealth(links, keys, ping);

  for (const r of results) {
    const label = r.ok ? "OK" : `FAIL${r.status ? ` (${r.status})` : r.error ? ` (${r.error})` : ""}`;
    console.log(`  [${label}] ${r.key}`);
  }

  writeFileSync(reportPath, JSON.stringify({ checkedAt, failingKeys }, null, 2) + "\n");
  console.log(
    `\n${failingKeys.length}/${results.length} sampled links failing. Report written to ${reportPath}.`,
  );
  console.log("Rebuild the app for /go to pick up the refreshed report.");
}

main().catch((error) => {
  console.error("check-link-health failed:", error);
  process.exitCode = 1;
});
