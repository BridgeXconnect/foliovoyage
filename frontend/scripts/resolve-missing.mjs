// Targeted re-resolve for the subjects the batch run missed to rate limiting.
// Merges results into /tmp/img_urls.json.
import { readFileSync, writeFileSync } from "node:fs";

const subjects = {
  kyo_hero: "Kiyomizu-dera Kyoto autumn",
  lis_belem: "Belem Tower",
  lis_jeronimos: "Jeronimos Monastery",
  lis_natas: "Pastel de nata Portuguese custard tart",
  lis_alfama: "Alfama district Lisbon",
  rom_borghese: "Galleria Borghese building Rome",
  rom_testaccio: "Cacio e pepe pasta",
  han_hero: "Hanoi Old Quarter street view",
  han_hoankiem: "The Huc Bridge Hoan Kiem Lake",
  bal_tanahlot: "Pura Tanah Lot",
  bal_monkey: "Sacred Monkey Forest Ubud",
  bal_waterfall: "Bali waterfall jungle",
  bal_seminyak: "Kuta beach Bali sunset",
};

const WIDTH = 1280;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolve(term) {
  const url =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap ${term}`,
      gsrnamespace: "6",
      gsrlimit: "6",
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: String(WIDTH),
      format: "json",
      origin: "*",
    });
  const res = await fetch(url, {
    headers: { "User-Agent": "FolioVoyage-scaffold/0.1 (placeholder content)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return "";
  const best = Object.values(pages)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => p.imageinfo?.[0])
    .filter((ii) => ii && /^image\/(jpeg|png)$/.test(ii.mime) && ii.width >= 1000)[0];
  return best ? best.thumburl || best.url : "";
}

const existing = JSON.parse(readFileSync("/tmp/img_urls.json", "utf8"));

for (const [key, term] of Object.entries(subjects)) {
  let url = "";
  for (let attempt = 0; attempt < 6 && !url; attempt++) {
    if (attempt > 0) await sleep(3000);
    try {
      url = await resolve(term);
    } catch {
      url = "";
    }
  }
  existing[key] = url;
  console.error(`${url ? "ok  " : "MISS"} ${key}`);
  await sleep(2500);
}

writeFileSync("/tmp/img_urls.json", JSON.stringify(existing, null, 2));
console.error("merged");
