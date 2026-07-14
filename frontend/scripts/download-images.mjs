// Download resolved Wikimedia thumbnails into public/images so the site serves
// its own placeholder imagery (no runtime dependency on Wikimedia, no rate
// limits, faster loads). Also captures attribution metadata for image credits.
//
// Usage: node scripts/download-images.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "public", "images");
mkdirSync(outDir, { recursive: true });

const UA =
  "FolioVoyage/0.1 (https://foliovoyage.com; hello@foliovoyage.com) placeholder-content";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urls = JSON.parse(readFileSync("/tmp/img_urls.json", "utf8"));

/** Pull the "File:Xxx" title out of an upload.wikimedia.org URL. */
function fileTitle(url) {
  const parts = decodeURIComponent(new URL(url).pathname).split("/");
  const ti = parts.indexOf("thumb");
  const name = ti >= 0 ? parts[ti + 3] : parts[parts.length - 1];
  return name;
}

async function fetchMeta(title) {
  const api =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      titles: `File:${title}`,
      prop: "imageinfo",
      iiprop: "extmetadata|url",
      format: "json",
      origin: "*",
    });
  const res = await fetch(api, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`meta HTTP ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  const ii = page?.imageinfo?.[0];
  const em = ii?.extmetadata ?? {};
  const strip = (s) => (s ? String(s).replace(/<[^>]+>/g, "").trim() : "");
  return {
    file: title,
    descriptionUrl: ii?.descriptionurl ?? "",
    artist: strip(em.Artist?.value) || "Unknown",
    license: strip(em.LicenseShortName?.value) || "See source",
    licenseUrl: em.LicenseUrl?.value ?? "",
  };
}

const credits = {};
for (const [key, url] of Object.entries(urls)) {
  const dest = join(outDir, `${key}.jpg`);
  let ok = false;
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    if (attempt > 0) await sleep(4000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 3000) throw new Error("suspiciously small");
      writeFileSync(dest, buf);
      ok = true;
    } catch (e) {
      if (attempt === 4) console.error(`FAIL img ${key}: ${e.message}`);
    }
  }
  let meta = { file: fileTitle(url), artist: "Unknown", license: "See source", descriptionUrl: "", licenseUrl: "" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(3000);
    try {
      meta = await fetchMeta(fileTitle(url));
      break;
    } catch {
      /* keep fallback */
    }
  }
  credits[key] = meta;
  console.error(`${ok ? "ok  " : "MISS"} ${key}`);
  await sleep(1500);
}

writeFileSync(
  join(root, "src", "data", "credits.json"),
  JSON.stringify(credits, null, 2),
);
console.error("wrote credits.json");
