// Fail a production build if protected review/rating values enter browser JS.
// Page HTML and RSC scans do not catch imports bundled into static chunks.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const chunksRoot = join(webRoot, ".next", "static", "chunks");
const protectedValue = /(?:\\?"(?:rating|ratingCount|ratingAvg|reviewCount)\\?"|(?<![\w$])(?:rating|ratingCount|ratingAvg|reviewCount))\s*:\s*(?:-?\d+(?:\.\d+)?|\\?"-?\d+(?:\.\d+)?\\?")/;

// The old leak was JSON.parse with escaped quotes; minified object literals
// can also carry these values. Keep both shapes covered by this build gate.
for (const sample of [String.raw`JSON.parse('{\"ratingCount\":94}')`, "{rating:5,ratingCount:94}"]) {
  if (!protectedValue.test(sample)) throw new Error(`Rating scanner missed fixture: ${sample}`);
}

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

const files = jsFiles(chunksRoot);
if (files.length === 0) throw new Error("No browser chunks found to check");
const leaks = files.filter((file) => protectedValue.test(readFileSync(file, "utf8")));
if (leaks.length) {
  console.error("Protected rating/review values found in browser chunks:");
  for (const file of leaks) console.error(`  ${relative(webRoot, file)}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} browser chunks: no protected rating/review values`);
}
