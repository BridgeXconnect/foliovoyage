import * as fs from "node:fs";
import * as path from "node:path";

import type { CandidatesFile } from "./candidates.stage";
import { MAX_QUERY_CHARS, MAX_QUERY_WORDS } from "./candidates";
import { KEYWORD_OVERVIEW_ENDPOINT } from "./price-table";
import type { Rule } from "./rule";
import type { SearchProviderClient } from "./search-provider.client";

/**
 * Demand check for one city (BRI-206, spec child 0004): one Keyword Overview
 * call carrying every candidate query, through the spend guard.
 */

/** Keyword Overview takes at most this many keywords in a task. */
export const MAX_KEYWORDS_PER_TASK = 700;

export class DemandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemandError";
  }
}

export interface DemandEntry {
  query: string;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  avgBacklinks: unknown;
  /** Volume at least the rule's demand floor. */
  validated: boolean;
  /** `no_data` when the provider returned nothing usable for the keyword. Nothing is guessed for it. */
  status: "ok" | "no_data";
}

export interface DemandFile {
  city: string;
  endpoint: string;
  market: { locationCode: number; languageCode: string };
  demandFloor: number;
  /** Cost the provider reported for the call. */
  costUsd: number | null;
  counts: { queries: number; ok: number; noData: number; validated: number };
  entries: DemandEntry[];
}

export type DemandResult =
  | { kind: "dry_run"; estimateUsd: number; keywords: number }
  | { kind: "done"; file: DemandFile; path: string; fromCache: boolean };

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The `items` of a Keyword Overview response, or an empty list. */
function itemsOf(response: unknown): unknown[] {
  const tasks = isRecord(response) && Array.isArray(response.tasks) ? response.tasks : [];
  const first = tasks[0];
  const result = isRecord(first) && Array.isArray(first.result) ? first.result[0] : undefined;
  return isRecord(result) && Array.isArray(result.items) ? result.items : [];
}

/** One entry per candidate, in candidate order. A keyword the provider did not return gets `no_data`. */
export function parseDemand(response: unknown, queries: readonly string[], demandFloor: number): DemandEntry[] {
  const byKeyword = new Map<string, Record<string, unknown>>();
  for (const item of itemsOf(response)) {
    if (isRecord(item) && typeof item.keyword === "string") byKeyword.set(item.keyword.trim().toLowerCase(), item);
  }

  return queries.map((query): DemandEntry => {
    const item = byKeyword.get(query.trim().toLowerCase());
    const info = item !== undefined && isRecord(item.keyword_info) ? item.keyword_info : {};
    const props = item !== undefined && isRecord(item.keyword_properties) ? item.keyword_properties : {};
    const intent = item !== undefined && isRecord(item.search_intent_info) ? item.search_intent_info : {};
    const volume = asNumber(info.search_volume);
    if (item === undefined || volume === null) {
      return { query, volume: null, difficulty: null, intent: null, avgBacklinks: null, validated: false, status: "no_data" };
    }
    return {
      query,
      volume,
      difficulty: asNumber(props.keyword_difficulty),
      intent: typeof intent.main_intent === "string" ? intent.main_intent : null,
      avgBacklinks: item.avg_backlinks_info ?? null,
      validated: volume >= demandFloor,
      status: "ok",
    };
  });
}

export async function runDemand(
  slug: string,
  deps: { dataDir: string; client: SearchProviderClient; rule: Rule },
): Promise<DemandResult> {
  const dir = path.join(deps.dataDir, "bri-206", slug);
  const candidatesPath = path.join(dir, "candidates.json");
  if (!fs.existsSync(candidatesPath)) {
    throw new DemandError(`No candidates for ${slug}. Run "research:hub candidates --city ${slug}" first.`);
  }
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8")) as CandidatesFile;
  const queries = candidates.candidates.map((c) => c.query);

  if (queries.length === 0) throw new DemandError(`${slug} has no candidate queries.`);
  if (queries.length > MAX_KEYWORDS_PER_TASK) {
    throw new DemandError(`${queries.length} queries is over the ${MAX_KEYWORDS_PER_TASK} a single task allows.`);
  }
  for (const q of queries) {
    if (q.length > MAX_QUERY_CHARS || q.split(" ").length > MAX_QUERY_WORDS) {
      throw new DemandError(`Query "${q}" is over ${MAX_QUERY_CHARS} characters or ${MAX_QUERY_WORDS} words. Nothing was sent.`);
    }
  }

  // No include_clickstream_data (doubles the price) and no include_serp_info (adds nothing here).
  const outcome = await deps.client.request({
    stage: "demand",
    endpoint: KEYWORD_OVERVIEW_ENDPOINT,
    tasks: [
      {
        keywords: queries,
        location_code: deps.rule.market.locationCode,
        language_code: deps.rule.market.languageCode,
      },
    ],
  });

  if (outcome.kind === "dry_run") {
    return { kind: "dry_run", estimateUsd: outcome.estimateUsd, keywords: outcome.keywords };
  }

  const entries = parseDemand(outcome.response, queries, deps.rule.demandFloor);
  const file: DemandFile = {
    city: slug,
    endpoint: KEYWORD_OVERVIEW_ENDPOINT,
    market: deps.rule.market,
    demandFloor: deps.rule.demandFloor,
    costUsd: asNumber(outcome.response.cost),
    counts: {
      queries: entries.length,
      ok: entries.filter((e) => e.status === "ok").length,
      noData: entries.filter((e) => e.status === "no_data").length,
      validated: entries.filter((e) => e.validated).length,
    },
    entries,
  };
  const out = path.join(dir, "demand.json");
  fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return { kind: "done", file, path: out, fromCache: outcome.kind === "cache_hit" };
}
