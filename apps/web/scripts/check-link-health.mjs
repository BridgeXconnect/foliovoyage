// Pings a sample of the matched Viator affiliate links in viator-links.json
// and prints a pass/fail report (BRI-138 / ST-26, FR-AFF-3: "a scheduled job
// pings a sample and flags failures in a report").
//
// This is a manually-invoked CLI, mirroring fetch-viator-links.mjs's
// conventions. It is deliberately NOT wired to a cron/scheduler — that's
// left for when Render is back. The algorithm matches
// apps/web/src/lib/link-health.ts (unit-tested); this file duplicates it in
// plain JS since scripts here don't import TypeScript from src/ (no
// tsx/ts-node dependency in this repo today — adding one is a separate
// decision, out of scope for this script).
//
// KNOWN LIMITATION (confirmed by manual testing, 2026-08-24): viator.com
// sits behind DataDome, a bot-detection WAF that 403s essentially any
// non-browser HTTP client — confirmed via curl with no User-Agent and with a
// realistic desktop Chrome User-Agent; both were blocked identically
// (`server: DataDome`). This isn't a missing-header bug and isn't worked
// around here (that would mean evading a partner site's anti-bot
// protection). Instead, a 403 carrying DataDome's signature is reported as
// "BLOCKED (bot protection)" — inconclusive, not proof the link is dead —
// separately from genuine failures (404, timeout, DNS error, other 5xx).
//
// Usage:
//   From apps/web/:  node scripts/check-link-health.mjs
//   Sample size:     SAMPLE_SIZE=5 node scripts/check-link-health.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const linksPath = join(__dirname, "..", "src", "data", "viator-links.json");
const links = JSON.parse(readFileSync(linksPath, "utf8"));

const TIMEOUT_MS = 8000;
const sampleSize = process.env.SAMPLE_SIZE ? Number(process.env.SAMPLE_SIZE) : undefined;

function sampleEntries(entries, size) {
  if (size === undefined || size >= entries.length) return entries;
  const pool = [...entries];
  const picked = [];
  for (let i = 0; i < size; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function isBotBlocked(response) {
  return response.status === 403 && response.headers.get("server") === "DataDome";
}

async function pingOne({ key, url }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    if (isBotBlocked(response)) {
      return { key, url, ok: false, status: response.status, blocked: true };
    }
    return { key, url, ok: response.ok, status: response.status };
  } catch (error) {
    return { key, url, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const entries = Object.entries(links)
    .filter(([, v]) => Boolean(v?.affiliateUrl))
    .map(([key, v]) => ({ key, url: v.affiliateUrl }));

  const sample = sampleEntries(entries, sampleSize);
  console.log(`Checking ${sample.length} of ${entries.length} matched links...\n`);

  const results = await Promise.all(sample.map(pingOne));
  const blocked = results.filter((r) => r.blocked);
  const failures = results.filter((r) => !r.ok && !r.blocked);

  for (const r of results) {
    const status = r.ok ? `OK (${r.status})` : r.blocked ? `BLOCKED (bot protection, ${r.status})` : `FAIL (${r.status ?? r.error})`;
    const mark = r.ok ? "✓" : r.blocked ? "⚠" : "✗";
    console.log(`  ${mark} ${r.key} — ${status}`);
  }

  console.log(`\n${results.length - failures.length - blocked.length}/${results.length} healthy.`);
  if (blocked.length > 0) {
    console.log(
      `${blocked.length}/${results.length} blocked by Viator's DataDome bot protection — inconclusive, not evidence these links are dead (see script header).`,
    );
  }
  if (failures.length > 0) {
    console.log("\nFailures:");
    console.log(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
}

main();
