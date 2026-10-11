import * as fs from "node:fs";
import * as path from "node:path";

import { CURATED_CITIES } from "../../import/curated-cities";
import {
  type AttractionMode,
  type CandidateRow,
  type DroppedQuery,
  MAX_QUERY_CHARS,
  MAX_QUERY_WORDS,
  MIN_ATTRACTION_PRODUCTS,
  MIN_TAG_PRODUCTS,
  TOP_ATTRACTIONS,
  TOP_TAGS,
  buildCandidates,
  candidatesToCsv,
  cityFigures,
  rankAttractions,
  rankTags,
} from "../core/candidates";
import type { CatalogReader } from "./catalog-reader";
import type { Attraction } from "../core/viator-catalog";

/** What the stage needs from the Viator side, so tests can hand in a fake. */
export interface CatalogSource {
  tagNames(): Promise<Map<number, string>>;
  attractions(destRef: string): Promise<Attraction[]>;
}

export class CandidatesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidatesError";
  }
}

export interface CandidatesFile {
  city: string;
  viatorRefs: string[];
  /** How attraction counts were made: Viator's own, or a title match over the city's tours. */
  attractionMode: AttractionMode;
  cutoffs: Record<string, number>;
  counts: { tours: number; tags: number; attractions: number; queries: number; internalTagsFiltered?: number };
  candidates: CandidateRow[];
  dropped: DroppedQuery[];
}

export interface CandidatesResult {
  file: CandidatesFile;
  jsonPath: string;
  csvPath: string;
}

/**
 * Build one city's candidate query list and write `candidates.json` and
 * `candidates.csv` under `<dataDir>/bri-206/<slug>/`. Reads the database and
 * the free Viator partner endpoints only. It never touches the search
 * provider, so it cannot spend anything.
 */
export async function runCandidates(
  slug: string,
  deps: { dataDir: string; reader: CatalogReader; catalog: CatalogSource },
): Promise<CandidatesResult> {
  const city = CURATED_CITIES.find((c) => c.slug === slug);
  if (city === undefined) {
    throw new CandidatesError(
      `Unknown city "${slug}". Curated cities: ${CURATED_CITIES.map((c) => c.slug).join(", ")}.`,
    );
  }

  const [tagRows, tours] = await Promise.all([
    deps.reader.tagRows(city.viatorRefs),
    deps.reader.tourRows(city.viatorRefs),
  ]);
  if (tours.length === 0) {
    throw new CandidatesError(
      `No tours are stored for ${city.name} (refs ${city.viatorRefs.join(", ")}), so there is nothing to rank. Run the import first.`,
    );
  }

  const names = await deps.catalog.tagNames();
  const attractions = await deps.catalog.attractions(city.primaryRef);

  const tags = rankTags(tagRows, names);
  const attractionRank = rankAttractions(attractions, tours);
  const { candidates, dropped } = buildCandidates(city.name, cityFigures(tours), tags.ranked, attractionRank.ranked);

  for (const tagId of tags.unnamed) {
    dropped.push({ query: `tag ${tagId}`, family: "tag", reason: "no name in the Viator tags response" });
  }

  const file: CandidatesFile = {
    city: city.slug,
    viatorRefs: [...city.viatorRefs],
    attractionMode: attractionRank.mode,
    cutoffs: {
      minTagProducts: MIN_TAG_PRODUCTS,
      topTags: TOP_TAGS,
      minAttractionProducts: MIN_ATTRACTION_PRODUCTS,
      topAttractions: TOP_ATTRACTIONS,
      maxQueryChars: MAX_QUERY_CHARS,
      maxQueryWords: MAX_QUERY_WORDS,
    },
    counts: {
      tours: tours.length,
      tags: tags.ranked.length,
      attractions: attractionRank.ranked.length,
      queries: candidates.length,
      internalTagsFiltered: tags.internal.length,
    },
    candidates,
    dropped,
  };

  const dir = path.join(deps.dataDir, "bri-206", city.slug);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "candidates.json");
  const csvPath = path.join(dir, "candidates.csv");
  fs.writeFileSync(jsonPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  fs.writeFileSync(csvPath, candidatesToCsv(candidates), "utf8");
  return { file, jsonPath, csvPath };
}
