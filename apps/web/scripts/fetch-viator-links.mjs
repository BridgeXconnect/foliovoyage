// Wire up live Viator affiliate links for the 6 hand-written destinations
// (Basic Access tier). See docs/06 (API reference) and docs/07 (this brief).
//
// What it does, per doc 07's "match, don't overwrite" rule:
//   1. Resolve each destination (Bangkok, Kyoto, Lisbon, Rome, Hanoi, Bali) to
//      a Viator destination ID via /destinations.
//   2. For each destination, fetch product summaries from /products/search.
//   3. Fuzzy-match each hand-written Experience (by title/keywords) to the best
//      real product. Attach that product's `productUrl` VERBATIM plus our own
//      `&campaign=<slug>-card`. A wrong match is worse than no match, so weak
//      matches are left unset (the card keeps its "Booking coming soon" state).
//   4. Write the results to two files the app reads at build time:
//        src/data/viator-destinations.json  — { slug: destinationId }
//        src/data/viator-links.json         — { "<slug>/<expId>": { affiliateUrl,
//          provider, fromPrice?, currency?, freeCancel? } }
//          (the commerce fields are additive card badges — BRI-168.)
//
// It never touches the editorial title/description, never rewrites Viator's
// pid/mcid/medium params, and needs no database (that's Full Access territory).
//
// A re-run PRESERVES every already-curated match and only refreshes its commerce
// badges (fromPrice/freeCancel) — it never silently re-points a reviewed
// card. Auto-matching only fills experiences that still have no link. Set
// ENRICH_ONLY=1 to refresh badges alone and add no new (uncurated) matches.
//
// Usage:
//   1. Put your key in apps/web/.env.local:  VIATOR_API_KEY=xxxxx
//   2. From apps/web/:  node scripts/fetch-viator-links.mjs
//        (badge-only refresh:  ENRICH_ONLY=1 node scripts/fetch-viator-links.mjs)
//   3. Review the printed match report and the JSON diff, then rebuild.
//
// Nothing here runs at request time. Review the output before shipping.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = join(root, "src", "data");

// ── Config ────────────────────────────────────────────────────────────────
// Base URL + headers follow Viator's Partner API v2. If a call 401s or 404s,
// confirm these against your dashboard's API docs (docs/06 lists the sources).
const API_BASE = "https://api.viator.com/partner";
const API_VERSION = "2.0";
const CURRENCY = "USD";
const MATCH_THRESHOLD = 0.5; // min match score to accept; tune after first run.
// ENRICH_ONLY=1 → keep the curated match set exactly as-is and only refresh
// commerce badges; never auto-add a new (uncurated) match. Use this for a
// badge-refresh run (BRI-168); leave unset to bootstrap / extend coverage.
const ENRICH_ONLY = process.env.ENRICH_ONLY === "1";

// Some destination names are ambiguous across countries (e.g. "Bali" is both an
// Indonesian region and a village in Crete). Pin the expected country per slug
// so the resolver can disambiguate via the destination's parent chain.
const EXPECTED_COUNTRY = {
  bangkok: "Thailand",
  kyoto: "Japan",
  lisbon: "Portugal",
  rome: "Italy",
  hanoi: "Vietnam",
  bali: "Indonesia",
};

// ── Env ─────────────────────────────────────────────────────────────────--
function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

const API_KEY = process.env.VIATOR_API_KEY;
if (!API_KEY || API_KEY === "your-viator-partner-api-key") {
  console.error(
    "✗ VIATOR_API_KEY is not set.\n" +
      "  Add it to frontend/.env.local (VIATOR_API_KEY=...) and re-run.\n" +
      "  Get the key from the Viator partner dashboard → Tools → Affiliate API.",
  );
  process.exit(1);
}

const headers = {
  "exp-api-key": API_KEY,
  Accept: `application/json;version=${API_VERSION}`,
  "Accept-Language": "en-US",
  "Content-Type": "application/json",
};

// ── Parse the hand-written experiences out of destinations.ts ───────────────
// The file is regular enough to read with light regex: each destination has a
// `slug:` + `city:`, and each experience an `id:` + `title:`. We only need
// slug, city, and the experience id/title to drive matching — no TS runtime.
function parseDestinations() {
  const src = readFileSync(join(dataDir, "destinations.ts"), "utf8");
  const slugRe = /slug:\s*"([^"]+)"/g;
  const boundaries = [];
  let m;
  while ((m = slugRe.exec(src))) boundaries.push({ slug: m[1], index: m.index });

  return boundaries.map((b, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : src.length;
    const block = src.slice(b.index, end);
    const city = (block.match(/city:\s*"([^"]+)"/) || [])[1] || b.slug;
    const country = (block.match(/country:\s*"([^"]+)"/) || [])[1] || "";
    const expRe = /id:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)"/g;
    const experiences = [];
    let e;
    while ((e = expRe.exec(block))) experiences.push({ id: e[1], title: e[2] });
    return { slug: b.slug, city, country, experiences };
  });
}

// ── Fuzzy matching ──────────────────────────────────────────────────────---
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "at", "in", "on", "to", "by", "with",
  "for", "from", "tour", "tours", "ticket", "tickets", "day", "trip", "visit",
  "experience", "guided", "private", "small", "group", "half", "full", "hour",
  "hours", "tailored", "optional", "add", "ons", "included", "skip", "line",
  "get", "know", "discover", "explore", "complete", "sightseeing", "luxury",
  "semi", "you", "your", "our", "best", "top", "must", "see", "local", "world",
  // generic transport / format words that shouldn't drive a match on their own
  "tuk", "tuktuk", "scooter", "motorbike", "bike", "car", "van", "mini",
  "safari", "golf", "cart", "walk", "walking", "cruise", "self",
]);

function tokens(s) {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function score(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  // Weighted toward covering the hand-written title's distinctive words.
  return inter / ta.size;
}

function rankMatches(expTitle, products) {
  return products
    .map((p) => ({ p, s: score(expTitle, p.title || "") }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
}

// ── Viator API calls ────────────────────────────────────────────────────---
async function getDestinationIndex() {
  // v2 primary; v1 taxonomy is the Golden Path fallback (see docs/06 step 3).
  for (const path of ["/destinations", "/v1/taxonomy/destinations"]) {
    try {
      const res = await fetch(API_BASE + path, { headers });
      if (!res.ok) continue;
      const json = await res.json();
      const list = json.destinations || json.data || [];
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* try next */
    }
  }
  throw new Error("Could not fetch destination list from /destinations.");
}

// Walk parentDestinationId up to the COUNTRY node and return its name.
function countryOf(dest, byId) {
  let c = dest;
  for (let i = 0; i < 12 && c; i += 1) {
    if (/country/i.test(c.type || "")) return c.name;
    c = byId.get(c.parentDestinationId);
  }
  return null;
}

function resolveDestinationId(slug, city, index, byId) {
  const cityL = city.toLowerCase();
  const expected = (EXPECTED_COUNTRY[slug] || "").toLowerCase();
  const named = index.filter((d) => (d.name || "").toLowerCase() === cityL);
  if (!named.length) return null;
  // Disambiguate strictly by country ancestry (e.g. Indonesian Bali, not the
  // Cretan village of the same name). Only fall back to a lone name match.
  const inCountry = named.filter(
    (d) => (countryOf(d, byId) || "").toLowerCase() === expected,
  );
  const chosen = inCountry[0] || (named.length === 1 ? named[0] : null);
  return chosen ? (chosen.destinationId ?? chosen.id ?? null) : null;
}

async function searchProducts(destinationId) {
  const body = {
    filtering: { destination: String(destinationId) },
    sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
    pagination: { start: 1, count: 50 },
    currency: CURRENCY,
  };
  const res = await fetch(API_BASE + "/products/search", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`/products/search ${destinationId} → HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.products || json.data || [];
}

// Append our own analytics campaign param WITHOUT altering Viator's params.
function withCampaign(productUrl, slug) {
  const campaign = `${slug}-card`.replace(/[^a-z0-9-]/g, "");
  const sep = productUrl.includes("?") ? "&" : "?";
  return `${productUrl}${sep}campaign=${campaign}`;
}

// Provider commerce signals from a /products/search summary (BRI-168), for the
// card badges. All optional and only included when present — this is pure
// enrichment (docs/07 "match, don't overwrite"); nothing here touches the
// editorial title/description. `fromPrice`/`currency` come from the summary's
// `pricing.summary.fromPrice` + `pricing.currency`; `freeCancel` from the
// `FREE_CANCELLATION` flag. Review/rating data is protected and never written.
// Pull the Viator productCode out of a stored affiliate URL, e.g.
// ".../d343-66102P2?mcid=..." → "66102P2". Used to re-find a *curated* match in
// fresh search results so its badges can be refreshed without re-matching.
function productCodeFromUrl(url) {
  const m = String(url).match(/\/d\d+-([0-9A-Za-z]+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function commerceFields(p) {
  const out = {};
  const fromPrice = p?.pricing?.summary?.fromPrice;
  if (typeof fromPrice === "number" && Number.isFinite(fromPrice)) {
    out.fromPrice = fromPrice;
    if (typeof p?.pricing?.currency === "string") out.currency = p.pricing.currency;
  }
  if (Array.isArray(p?.flags) && p.flags.includes("FREE_CANCELLATION")) {
    out.freeCancel = true;
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────--
async function main() {
  const destinations = parseDestinations();
  console.log(`Parsed ${destinations.length} destinations from destinations.ts\n`);

  const index = await getDestinationIndex();
  const byId = new Map(index.map((d) => [d.destinationId, d]));
  console.log(`Fetched ${index.length} Viator destinations\n`);

  // Load already-curated links so a re-run **preserves the human-reviewed match**
  // for each experience and only refreshes its commerce badges (BRI-168). A wrong
  // match is worse than none (docs/07), so we never silently re-point a curated
  // card; auto-matching only fills experiences that have no link yet.
  const linksPath = join(dataDir, "viator-links.json");
  const existingLinks = existsSync(linksPath)
    ? JSON.parse(readFileSync(linksPath, "utf8"))
    : {};

  const destMap = {};
  const links = {};
  const review = {}; // slug/expId → { expTitle, candidates:[{title,productCode,score,productUrl}] }
  let matched = 0;
  let enriched = 0;
  let missed = 0;

  for (const d of destinations) {
    const destId = resolveDestinationId(d.slug, d.city, index, byId);
    destMap[d.slug] = destId;
    if (!destId) {
      console.log(`✗ ${d.city}: no Viator destination ID found — skipping.`);
      missed += d.experiences.length;
      continue;
    }
    console.log(`\n${d.city} (destinationId=${destId})`);

    let products = [];
    try {
      products = await searchProducts(destId);
    } catch (err) {
      console.log(`  ! product search failed: ${err.message}`);
      missed += d.experiences.length;
      continue;
    }
    console.log(`  ${products.length} products returned`);
    const byCode = new Map(products.map((p) => [p.productCode, p]));

    for (const exp of d.experiences) {
      const ranked = rankMatches(exp.title, products);
      const key = `${d.slug}/${exp.id}`;
      review[key] = {
        expTitle: exp.title,
        candidates: ranked.map(({ p, s }) => ({
          title: p.title,
          productCode: p.productCode,
          score: Number(s.toFixed(2)),
          productUrl: p.productUrl ? withCampaign(p.productUrl, d.slug) : null,
        })),
      };

      // Preserve a curated match: keep the human-chosen affiliate link, just
      // refresh its commerce badges from the same product in fresh results.
      const prior = existingLinks[key];
      if (prior?.affiliateUrl) {
        const prod = byCode.get(productCodeFromUrl(prior.affiliateUrl));
        // Old curated files may still contain protected fields. Never carry
        // them forward, including when the product is absent from this search.
        const publicPrior = { ...prior };
        delete publicPrior.rating;
        delete publicPrior.ratingCount;
        links[key] = { ...publicPrior, ...(prod ? commerceFields(prod) : {}) };
        enriched += 1;
        console.log(
          `  ↻ ${exp.title} — kept curated match, ` +
            `${prod ? "refreshed badges" : "product not in fresh results, badges unchanged"}`,
        );
        continue;
      }

      // No curated link yet → auto-match (bootstrap / new coverage). Auto-matches
      // are a starting point to curate, not a final answer (docs/07). Skipped
      // under ENRICH_ONLY so a badge-refresh run never adds uncurated matches.
      if (ENRICH_ONLY) {
        missed += 1;
        console.log(`  · ${exp.title} — no curated link; skipped (ENRICH_ONLY)`);
        continue;
      }
      const top = ranked[0];
      if (top && top.s >= MATCH_THRESHOLD && top.p.productUrl) {
        links[key] = {
          affiliateUrl: withCampaign(top.p.productUrl, d.slug),
          provider: "Viator",
          ...commerceFields(top.p),
        };
        matched += 1;
        console.log(
          `  ✓ ${exp.title}\n      → ${top.p.title} (score ${top.s.toFixed(2)})`,
        );
      } else {
        missed += 1;
        console.log(
          `  · ${exp.title} — no confident match (best ${top ? top.s.toFixed(2) : "0.00"}); left unset`,
        );
      }
    }
  }

  writeFileSync(
    join(dataDir, "viator-destinations.json"),
    JSON.stringify(destMap, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "viator-links.json"),
    JSON.stringify(links, null, 2) + "\n",
  );
  // Review artifact: top candidates per experience, for manual curation.
  writeFileSync(
    join(__dirname, "viator-match-review.json"),
    JSON.stringify(review, null, 2) + "\n",
  );

  console.log(
    `\nPreserved + badge-refreshed ${enriched} curated match(es); ` +
      `auto-matched ${matched} new at threshold ${MATCH_THRESHOLD}; ${missed} left unset.\n` +
      `Wrote viator-destinations.json, viator-links.json, and scripts/viator-match-review.json.\n` +
      `IMPORTANT: auto-matches are a starting point — curate viator-links.json against\n` +
      `the review file before building. A wrong match is worse than none (docs/07).`,
  );
}

main().catch((err) => {
  console.error("\n✗ Failed:", err.message);
  process.exit(1);
});
