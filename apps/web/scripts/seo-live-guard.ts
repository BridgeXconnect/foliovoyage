/**
 * `pnpm --filter @folio/web seo:live-guard --base {ref}` (spec 0006 AC-8).
 *
 * Fails when a slug live at the base commit is not live in the working tree,
 * unless the working tree's manifest marks that page `"held": true`. Passes
 * when the base has no `live.generated.ts` yet. CI runs it on pull requests.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LIVE_FILE, SLICE_CONTENT_DIR, readSliceContent } from "../src/lib/seo-slice/index-files";
import { deriveLiveSet } from "../src/lib/seo-slice/live-set";
import { liveGuardFailures, parseLiveSlugs } from "../src/lib/seo-slice/live-guard";

// The live file's path from the repo root, as `git show <base>:<path>` wants it.
const REPO_PATH = path
  .relative(path.resolve(__dirname, "../../.."), path.join(SLICE_CONTENT_DIR, LIVE_FILE))
  .split(path.sep)
  .join("/");

const i = process.argv.indexOf("--base");
const base = i > 0 ? process.argv[i + 1] : undefined;
if (!base) {
  console.error("Usage: seo:live-guard --base <commit>");
  process.exit(2);
}

let baseSlugs: string[] | null = null;
try {
  const source = execFileSync("git", ["show", `${base}:${REPO_PATH}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  baseSlugs = parseLiveSlugs(source);
} catch (err) {
  if (err instanceof Error && /LIVE_SLUGS/.test(err.message)) throw err;
  console.log(`seo:live-guard: ${base} has no ${REPO_PATH}, so nothing can be dropped.`);
}

const content = readSliceContent();
const headSlugs = parseLiveSlugs(readFileSync(path.join(SLICE_CONTENT_DIR, LIVE_FILE), "utf8"));
const failures = liveGuardFailures({
  baseSlugs,
  headSlugs,
  headManifest: content.manifest,
  headNotLive: deriveLiveSet(content).notLive,
});

if (failures.length) {
  console.error("seo:live-guard: this change takes live slice pages out of the live set:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`seo:live-guard: ok (${headSlugs.length} live here, ${baseSlugs?.length ?? 0} at the base).`);
