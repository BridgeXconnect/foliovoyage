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

/** HEAD first (cheaper); a 405 means the host doesn't support it, so retry with GET. */
const ping: Pinger = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.status === 405) {
      res = await fetch(url, { method: "GET", signal: controller.signal });
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
