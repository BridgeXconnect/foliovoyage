/**
 * `pnpm --filter @folio/web seo:leak-scan` (spec 0006 page template, AC-T6,
 * AC-T9). Run after `next build`. Scans every prerendered slice page in
 * `.next/server/app/destinations/bangkok/*.html` for leak, name, team and
 * preview terms and for links a gated visitor cannot reach, and fails when the
 * set of pages is not exactly `LIVE_SLUGS`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { LIVE_SLUGS } from "../src/content/seo/bangkok/live.generated";
import { readSliceContent } from "../src/lib/seo-slice/index-files";
import { scanBuild } from "../src/lib/seo-slice/leak-scan";

const BUILT_DIR = path.resolve(__dirname, "../.next/server/app/destinations/bangkok");

const files: Record<string, string> = {};
if (existsSync(BUILT_DIR)) {
  for (const name of readdirSync(BUILT_DIR)) {
    if (name.endsWith(".html")) files[name.slice(0, -".html".length)] = readFileSync(path.join(BUILT_DIR, name), "utf8");
  }
}

const content = readSliceContent();
const manifest = content.manifest;
const problems = scanBuild(files, {
  forbiddenNames: manifest?.forbiddenNames ?? [],
  factCheckBy: [...new Set(Object.values(content.copies).flatMap((c) => (c.factCheck ? [c.factCheck.by] : [])))],
  liveSlugs: LIVE_SLUGS,
  siteLinks: process.env.SEO_SLICE_SITE_LINKS === "1",
  sourceUrls: (manifest?.pages ?? []).flatMap((p) => (p.sourceFacts ?? []).map((f) => f.url)),
});

if (problems.length > 0) {
  console.error(`seo:leak-scan: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`seo:leak-scan: ${Object.keys(files).length} page(s) clean, matching LIVE_SLUGS (${LIVE_SLUGS.length}).`);
