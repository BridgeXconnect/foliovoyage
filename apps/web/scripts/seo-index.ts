/**
 * `pnpm --filter @folio/web seo:index` (spec 0006 index.md, Live set).
 *
 * Validates the slice content folder, derives the live set and writes
 * `live.generated.ts` and `pages.generated.ts`. Any validation problem fails
 * with nothing written. A stale grounding does not fail here (this runs right
 * after `seo:snapshot`, before the copy is regenerated); it is printed with the
 * command that fixes it, because the build will fail on it.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { SLICE_CONTENT_DIR, buildIndex, readSliceContent } from "../src/lib/seo-slice/index-files";

const content = readSliceContent();
const { problems, live, files } = buildIndex(content);

if (problems.length) {
  console.error(`seo:index: ${problems.length} problem(s), nothing written:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

for (const [file, text] of Object.entries(files)) {
  writeFileSync(path.join(SLICE_CONTENT_DIR, file), text);
}

if (!content.manifest) console.log("seo:index: no manifest.json yet, so the live set is empty.");
console.log(`seo:index: live pages (${live.liveSlugs.length}): ${live.liveSlugs.join(", ") || "none"}`);
for (const [slug, why] of Object.entries(live.notLive)) console.log(`  not live: ${slug} (${why})`);
for (const slug of live.staleFacts) {
  console.warn(`  facts do not match factsHash: ${slug}. Rerun seo:snapshot; the build fails until it matches.`);
}
for (const slug of live.staleGrounding) {
  console.warn(
    `  stale grounding: ${slug}. The build fails until you run: pnpm --filter @folio/api hub-copy:run --page ${slug}`,
  );
}
