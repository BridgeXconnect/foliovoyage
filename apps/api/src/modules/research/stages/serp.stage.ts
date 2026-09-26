import * as fs from "node:fs";
import * as path from "node:path";

import { type OrganicResult, organicTop } from "../core/classify";
import type { DemandFile } from "./demand.stage";
import { SERP_ORGANIC_ENDPOINT } from "../pricing/price-table";
import type { Rule, RuleGate } from "../core/rule";
import type { SearchProviderClient } from "../providers/search-provider.client";
import { SpendRefusedError, type SpendGuard, formatUsd, toMicros } from "../pricing/spend-guard";

/**
 * Results page pull for one city (BRI-206, spec child 0005): one
 * `serp/google/organic/live/regular` call per validated query, one keyword per
 * request, through the guard. The commit first gate is checked by the caller
 * before this runs, and its result is recorded next to every pulled query.
 */

export class SerpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpError";
  }
}

export interface SerpEntry {
  query: string;
  volume: number;
  /** Commit of rule.md in force when this query was pulled. */
  ruleCommit: string;
  /** ISO time of the paid call, or null when the response was already in the cache. */
  pulledAt: string | null;
  cacheKey: string;
  organic: OrganicResult[];
}

export interface SerpFailure {
  query: string;
  error: string;
  at: string;
}

export interface SerpFile {
  city: string;
  endpoint: string;
  /** Time of the first paid call for this city. Kept across reruns. */
  firstCallAt: string | null;
  ruleCommit: string;
  results: SerpEntry[];
  failures: SerpFailure[];
  /** Validated queries not pulled because the guard refused, with its reason. */
  notPulled: Array<{ query: string; reason: string }>;
}

export interface SerpSummary {
  city: string;
  validated: number;
  pulled: number;
  fromCache: number;
  alreadyHad: number;
  failed: number;
  notPulled: number;
  estimateUsd: number | null;
  path: string | null;
}

export async function runSerp(
  slug: string,
  deps: {
    dataDir: string;
    client: SearchProviderClient;
    guard: SpendGuard;
    rule: Rule;
    gate: RuleGate;
    execute: boolean;
    now: () => Date;
    log: (line: string) => void;
  },
): Promise<SerpSummary> {
  const dir = path.join(deps.dataDir, "bri-206", slug);
  const demandPath = path.join(dir, "demand.json");
  if (!fs.existsSync(demandPath)) {
    throw new SerpError(`No demand check for ${slug}. Run "research:hub demand --city ${slug} --execute" first.`);
  }
  const demand = JSON.parse(fs.readFileSync(demandPath, "utf8")) as DemandFile;
  // Highest volume first, so if the budget runs out the queries that matter most are already in.
  const validated = demand.entries
    .filter((e) => e.validated && e.volume !== null)
    .sort((a, b) => (b.volume as number) - (a.volume as number) || (a.query < b.query ? -1 : 1));

  const serpPath = path.join(dir, "serp.json");
  const previous: SerpFile | undefined = fs.existsSync(serpPath)
    ? (JSON.parse(fs.readFileSync(serpPath, "utf8")) as SerpFile)
    : undefined;
  const results = new Map<string, SerpEntry>((previous?.results ?? []).map((r) => [r.query, r]));
  let failures: SerpFailure[] = (previous?.failures ?? []).filter((f) => !results.has(f.query));
  const notPulled: SerpFile["notPulled"] = [];
  let firstCallAt = previous?.firstCallAt ?? null;

  const summary: SerpSummary = {
    city: slug,
    validated: validated.length,
    pulled: 0,
    fromCache: 0,
    alreadyHad: 0,
    failed: 0,
    notPulled: 0,
    estimateUsd: deps.execute ? null : 0,
    path: null,
  };

  const save = (): void => {
    // A dry run never writes anything.
    if (!deps.execute) return;
    const file: SerpFile = {
      city: slug,
      endpoint: SERP_ORGANIC_ENDPOINT,
      firstCallAt,
      ruleCommit: deps.gate.commit,
      results: [...results.values()].sort((a, b) => b.volume - a.volume || (a.query < b.query ? -1 : 1)),
      failures,
      notPulled,
    };
    const tmp = `${serpPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, serpPath);
    summary.path = serpPath;
  };

  for (const [index, entry] of validated.entries()) {
    const label = `[${index + 1}/${validated.length}] "${entry.query}" (${entry.volume} a month)`;
    if (results.has(entry.query)) {
      summary.alreadyHad++;
      deps.log(`${label}: already saved, skipped`);
      continue;
    }

    let outcome;
    try {
      outcome = await deps.client.request({
        stage: "serp",
        endpoint: SERP_ORGANIC_ENDPOINT,
        tasks: [
          {
            keyword: entry.query,
            location_code: deps.rule.market.locationCode,
            language_code: deps.rule.market.languageCode,
            depth: deps.rule.topN,
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SpendRefusedError) {
        // Anything after this would be refused the same way, so list what was left out and stop.
        for (const rest of validated.slice(index)) {
          if (!results.has(rest.query)) notPulled.push({ query: rest.query, reason: message });
        }
        summary.notPulled = notPulled.length;
        deps.log(`${label}: REFUSED by the spend guard. ${message}`);
        save();
        return summary;
      }
      // A failed call is never retried. Stop so a person can look before more is spent.
      failures = [...failures, { query: entry.query, error: message, at: deps.now().toISOString() }];
      summary.failed++;
      deps.log(`${label}: FAILED. ${message}`);
      save();
      return summary;
    }

    if (outcome.kind === "dry_run") {
      summary.estimateUsd = (summary.estimateUsd ?? 0) + outcome.estimateUsd;
      deps.log(`${label}: would send, about ${formatUsd(toMicros(outcome.estimateUsd))}`);
      continue;
    }

    const sentNow = outcome.kind === "sent";
    const pulledAt = sentNow ? deps.now().toISOString() : null;
    if (sentNow && firstCallAt === null) firstCallAt = pulledAt;
    results.set(entry.query, {
      query: entry.query,
      volume: entry.volume as number,
      ruleCommit: deps.gate.commit,
      pulledAt,
      cacheKey: outcome.cacheKey,
      organic: organicTop(outcome.response, deps.rule.topN),
    });
    if (sentNow) summary.pulled++;
    else summary.fromCache++;
    save();

    const left = deps.guard.totalBudgetLeftUsd();
    deps.log(
      outcome.kind === "sent"
        ? `${label}: sent, cost ${formatUsd(toMicros(outcome.costUsd))}, this run ${formatUsd(toMicros(deps.guard.runSpentUsd))}` +
            (left === undefined ? "" : `, total budget left ${formatUsd(toMicros(left))}`)
        : `${label}: from cache, no charge`,
    );
  }

  save();
  return summary;
}
