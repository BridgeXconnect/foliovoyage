import type { Attraction } from "./viator-catalog";

/**
 * Candidate query list for one city (BRI-206, spec child 0003).
 *
 * Everything here is a pure function of its inputs: the same tour rows, tag
 * names, attractions and cutoffs give the same list in the same order (AC-8).
 * No search provider call is made at this stage.
 */

// Cutoffs from spec child 0003. Every number on a candidate row comes from a
// Tour column, a Viator response, or one of these constants.
export const MIN_TAG_PRODUCTS = 10;
export const TOP_TAGS = 25;
export const MIN_RATING_COUNT = 5;
export const MIN_ATTRACTION_PRODUCTS = 5;
export const TOP_ATTRACTIONS = 25;
export const MAX_QUERY_CHARS = 80;
export const MAX_QUERY_WORDS = 10;

/**
 * Viator operational labels that sit in the `/products/tags` vocabulary but are
 * not traveller-facing categories, so no one searches for them ("zombie in
 * bangkok"). Excluded from candidate generation by exact tag id: no fuzzy
 * matching, no network. Ids are Viator's, not ours.
 *
 * Group A: seen in Bangkok's top 25 on 2026-09-20; both queries came back
 * no_data for every one of them, and none has a parent tag. Group B: the rest
 * of the same unparented 3676xx operational block that are clearly operational
 * by name, so another city's top 25 cannot surface them (no Bangkok evidence).
 * Deliberately left in, so the data decides (a miss costs about $0.002, over-
 * filtering loses a real candidate): Top Product (367652), Worry-Free Shore
 * Excursion (367649, could be a cruise-port query), Excellent Quality (21972),
 * Port Pickup (367660) and the Viator Experience Awards (367648, 367655).
 */
export const INTERNAL_TAGS: ReadonlyMap<number, string> = new Map([
  // Group A: evidenced in Bangkok
  [367653, "Low Supplier Cancellation Rate"],
  [367654, "Low Last Minute Supplier Cancellation Rate"],
  [367656, "Zombie"],
  [367658, "New Product"],
  [367661, "Short term availability"],
  [367664, "Weather Dependent - Moderate"],
  [367667, "Weather Dependent - Weather-Proof"],
  [367668, "Agent Low Quality Product"],
  // Group B: same block, by name only
  [367650, "Additional fees"],
  [367651, "DSA non-compliant"],
  [367657, "Zombie Slice"],
  [367659, "Curated Catalog"],
  [367662, "Agent Favorite"],
  [367663, "Weather Dependent - Low"],
  [367665, "Weather Dependent - High"],
  [367666, "Weather Dependent - Extreme"],
  [367669, "Conditional Booking Questions"],
]);

export type QueryFamily = "things_to_do" | "tag" | "attraction" | "best_time";

/** One tag as the database groups it: product count and mean rating over tours with enough reviews. */
export interface TagRow {
  tagId: number;
  productCount: number;
  ratingAvg: number | null;
}

/** The tour columns the attraction fallback needs. */
export interface TourRow {
  title: string;
  ratingAvg: number | null;
  ratingCount: number | null;
}

export interface Ranked {
  name: string;
  productCount: number;
  ratingAvg: number | null;
}

export interface CandidateRow {
  query: string;
  /** Every family that produced this exact query. */
  families: QueryFamily[];
  /** `city`, `tag` or `attraction`, from the row with the highest product count. */
  source: "city" | "tag" | "attraction";
  productCount: number;
  ratingAvg: number | null;
  rank: number;
}

export interface DroppedQuery {
  query: string;
  family: QueryFamily;
  reason: string;
}

export type AttractionMode = "viator_count" | "title_match";

const round2 = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

/** Highest count first, then highest rating (no rating last), then name, so ties never depend on input order. */
const byStrength = (a: Ranked, b: Ranked): number =>
  b.productCount - a.productCount ||
  (b.ratingAvg ?? -1) - (a.ratingAvg ?? -1) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Lowercase and trim, and turn anything that is not a letter, number, space,
 * apostrophe, ampersand or hyphen into a space. The provider rejects some
 * symbols, and an attraction like "Wat Arun (Temple of Dawn)" would otherwise
 * carry brackets into a search query.
 */
export function normalizeQuery(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tags with at least {@link MIN_TAG_PRODUCTS} products, named, ordered by
 * product count then rating, top {@link TOP_TAGS}. Viator-internal tags
 * ({@link INTERNAL_TAGS}) are removed before the cut, so they never take a slot;
 * `internal` lists the ones that would otherwise have qualified. A tag id with
 * no name in the names file cannot become a query, so it is listed in `dropped`.
 */
export function rankTags(
  rows: readonly TagRow[],
  names: ReadonlyMap<number, string>,
): { ranked: Ranked[]; unnamed: number[]; internal: number[] } {
  const unnamed: number[] = [];
  const internal: number[] = [];
  const named: Ranked[] = [];
  for (const row of rows) {
    if (row.productCount < MIN_TAG_PRODUCTS) continue;
    if (INTERNAL_TAGS.has(row.tagId)) {
      internal.push(row.tagId);
      continue;
    }
    const name = names.get(row.tagId);
    if (name === undefined) {
      unnamed.push(row.tagId);
      continue;
    }
    named.push({ name, productCount: row.productCount, ratingAvg: round2(row.ratingAvg) });
  }
  return { ranked: named.sort(byStrength).slice(0, TOP_TAGS), unnamed: unnamed.sort((a, b) => a - b), internal: internal.sort((a, b) => a - b) };
}

/**
 * Attractions with at least {@link MIN_ATTRACTION_PRODUCTS} products, top
 * {@link TOP_ATTRACTIONS}. If Viator's response carries a product count for any
 * attraction those counts rank them. If it carries none, the count is the
 * number of the city's tours whose title contains the attraction name (case
 * insensitive), which is free and deterministic.
 */
export function rankAttractions(
  attractions: readonly Attraction[],
  tours: readonly TourRow[],
): { ranked: Ranked[]; mode: AttractionMode } {
  const mode: AttractionMode = attractions.some((a) => a.productCount !== undefined)
    ? "viator_count"
    : "title_match";

  const seen = new Set<string>();
  const scored: Ranked[] = [];
  for (const attraction of attractions) {
    const key = normalizeQuery(attraction.name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);

    if (mode === "viator_count") {
      if (attraction.productCount === undefined) continue;
      scored.push({
        name: attraction.name,
        productCount: attraction.productCount,
        ratingAvg: round2(attraction.ratingAvg ?? null),
      });
      continue;
    }

    const needle = attraction.name.toLowerCase();
    const matches = tours.filter((t) => t.title.toLowerCase().includes(needle));
    const rated = matches.filter(
      (t) => t.ratingAvg !== null && (t.ratingCount ?? 0) >= MIN_RATING_COUNT,
    );
    scored.push({
      name: attraction.name,
      productCount: matches.length,
      ratingAvg: rated.length === 0 ? null : round2(rated.reduce((s, t) => s + (t.ratingAvg as number), 0) / rated.length),
    });
  }

  return {
    ranked: scored
      .filter((a) => a.productCount >= MIN_ATTRACTION_PRODUCTS)
      .sort(byStrength)
      .slice(0, TOP_ATTRACTIONS),
    mode,
  };
}

/** The whole city's product count and mean rating, for the two queries about the city itself. */
export function cityFigures(tours: readonly TourRow[]): { productCount: number; ratingAvg: number | null } {
  const rated = tours.filter((t) => t.ratingAvg !== null && (t.ratingCount ?? 0) >= MIN_RATING_COUNT);
  return {
    productCount: tours.length,
    ratingAvg:
      rated.length === 0 ? null : round2(rated.reduce((s, t) => s + (t.ratingAvg as number), 0) / rated.length),
  };
}

interface RawQuery {
  query: string;
  family: QueryFamily;
  source: CandidateRow["source"];
  productCount: number;
  ratingAvg: number | null;
}

/**
 * Cross the ranked tags and attractions with the query templates. Queries over
 * {@link MAX_QUERY_CHARS} characters or {@link MAX_QUERY_WORDS} words are
 * dropped and listed. Duplicates merge and keep every family label.
 */
export function buildCandidates(
  cityName: string,
  city: { productCount: number; ratingAvg: number | null },
  tags: readonly Ranked[],
  attractions: readonly Ranked[],
): { candidates: CandidateRow[]; dropped: DroppedQuery[] } {
  const place = normalizeQuery(cityName);
  const raw: RawQuery[] = [
    { query: `things to do in ${place}`, family: "things_to_do", source: "city", ...city },
    { query: `best time to visit ${place}`, family: "best_time", source: "city", ...city },
  ];
  for (const tag of tags) {
    for (const template of [`${tag.name} in ${place}`, `best ${tag.name} in ${place}`]) {
      raw.push({ query: template, family: "tag", source: "tag", productCount: tag.productCount, ratingAvg: tag.ratingAvg });
    }
  }
  for (const a of attractions) {
    for (const template of [`${a.name} tickets`, `${a.name} tours`]) {
      raw.push({ query: template, family: "attraction", source: "attraction", productCount: a.productCount, ratingAvg: a.ratingAvg });
    }
  }

  const dropped: DroppedQuery[] = [];
  const merged = new Map<string, { row: RawQuery; families: Set<QueryFamily> }>();
  for (const item of raw) {
    const query = normalizeQuery(item.query);
    const words = query === "" ? 0 : query.split(" ").length;
    if (query === "" || query.length > MAX_QUERY_CHARS || words > MAX_QUERY_WORDS) {
      dropped.push({
        query,
        family: item.family,
        reason: query === "" ? "empty after cleaning" : query.length > MAX_QUERY_CHARS ? `over ${MAX_QUERY_CHARS} characters` : `over ${MAX_QUERY_WORDS} words`,
      });
      continue;
    }
    const existing = merged.get(query);
    if (existing === undefined) {
      merged.set(query, { row: { ...item, query }, families: new Set([item.family]) });
    } else {
      existing.families.add(item.family);
      if (item.productCount > existing.row.productCount) existing.row = { ...item, query };
    }
  }

  const candidates = [...merged.values()]
    .map(({ row, families }) => ({ row, families: [...families].sort() as QueryFamily[] }))
    .sort(
      (a, b) =>
        b.row.productCount - a.row.productCount ||
        (b.row.ratingAvg ?? -1) - (a.row.ratingAvg ?? -1) ||
        (a.row.query < b.row.query ? -1 : a.row.query > b.row.query ? 1 : 0),
    )
    .map(({ row, families }, i): CandidateRow => ({
      query: row.query,
      families,
      source: row.source,
      productCount: row.productCount,
      ratingAvg: row.ratingAvg,
      rank: i + 1,
    }));

  dropped.sort((a, b) => (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
  return { candidates, dropped };
}

/** One row per query, families joined with `|`. */
export function candidatesToCsv(rows: readonly CandidateRow[]): string {
  const cell = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.query, r.families.join("|"), r.source, r.productCount, r.ratingAvg, r.rank].map(cell).join(","),
  );
  return ["query,families,source,productCount,ratingAvg,rank", ...lines].join("\n") + "\n";
}
