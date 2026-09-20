import * as fs from "node:fs";
import * as path from "node:path";

import { ALL_FAMILIES, type FamilyInput, type FamilyVerdict, type QueryVerdict, judgeFamilies, judgeQuery } from "./classify";
import type { CandidatesFile } from "./candidates.stage";
import type { DemandFile } from "./demand.stage";
import type { Rule } from "./rule";
import type { SerpFile } from "./serp.stage";
import type { QueryFamily } from "./candidates";

/**
 * Classify saved results pages and apply the rule (BRI-206, spec children
 * 0002 and 0005). It reads only saved files and makes no provider call, so it
 * costs nothing and can be rerun after a list change in rule.md.
 */

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifyError";
  }
}

export interface ClassifiedQuery extends QueryVerdict {
  query: string;
  families: QueryFamily[];
  volume: number;
  pulledAt: string | null;
  pulledUnderRuleCommit: string;
}

export interface ClassifiedFile {
  city: string;
  /** Commit of rule.md the classification used, and whether the file had local changes at that moment. */
  rule: { commit: string | null; dirty: boolean; version: number };
  citiesCounted: string[];
  queries: ClassifiedQuery[];
  /** Validated queries with no results page, so they are not in any count. */
  missingSerp: string[];
  families: FamilyVerdict[];
}

export interface ClassifyResult {
  file: ClassifiedFile;
  classifiedPath: string;
  unlistedPath: string;
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const readJson = <T>(file: string, hint: string): T => {
  if (!fs.existsSync(file)) throw new ClassifyError(`${file} is missing. ${hint}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
};

export function runClassify(
  slug: string,
  deps: { dataDir: string; rule: Rule; ruleCommit: { commit: string | null; dirty: boolean } },
): ClassifyResult {
  const dir = path.join(deps.dataDir, "bri-206", slug);
  const candidates = readJson<CandidatesFile>(path.join(dir, "candidates.json"), `Run candidates for ${slug} first.`);
  const demand = readJson<DemandFile>(path.join(dir, "demand.json"), `Run demand for ${slug} first.`);
  const serp = readJson<SerpFile>(path.join(dir, "serp.json"), `Run serp for ${slug} first.`);

  const familiesOf = new Map(candidates.candidates.map((c) => [c.query, c.families]));
  const validated = demand.entries.filter((e) => e.validated && e.volume !== null);
  const serpByQuery = new Map(serp.results.map((r) => [r.query, r]));

  const queries: ClassifiedQuery[] = [];
  const missingSerp: string[] = [];
  for (const entry of validated) {
    const pulled = serpByQuery.get(entry.query);
    if (pulled === undefined) {
      missingSerp.push(entry.query);
      continue;
    }
    queries.push({
      query: entry.query,
      families: [...(familiesOf.get(entry.query) ?? [])],
      volume: entry.volume as number,
      pulledAt: pulled.pulledAt,
      pulledUnderRuleCommit: pulled.ruleCommit,
      ...judgeQuery(pulled.organic, deps.rule),
    });
  }
  queries.sort((a, b) => b.volume - a.volume || (a.query < b.query ? -1 : 1));

  const familyInput: FamilyInput[] = queries.map((q) => ({
    query: q.query,
    families: q.families,
    verdict: q.verdict,
    marketplaces: q.counts.marketplace,
  }));
  const families = judgeFamilies(familyInput, deps.rule);
  // Keep a fixed order so two runs on the same data give the same file.
  families.sort((a, b) => ALL_FAMILIES.indexOf(a.family) - ALL_FAMILIES.indexOf(b.family));

  const file: ClassifiedFile = {
    city: slug,
    rule: { commit: deps.ruleCommit.commit, dirty: deps.ruleCommit.dirty, version: deps.rule.version },
    citiesCounted: [slug],
    queries,
    missingSerp,
    families,
  };

  // Domains that matched no list and fell to the small site default, with the queries they appeared in.
  const unlisted = new Map<string, Set<string>>();
  for (const q of queries) {
    for (const r of q.results) {
      if (!r.unlisted) continue;
      if (!unlisted.has(r.domain)) unlisted.set(r.domain, new Set());
      unlisted.get(r.domain)?.add(q.query);
    }
  }
  const rows = [...unlisted.entries()]
    .map(([domain, qs]) => ({ domain, count: qs.size, queries: [...qs].sort() }))
    .sort((a, b) => b.count - a.count || (a.domain < b.domain ? -1 : 1));

  const classifiedPath = path.join(dir, "classified.json");
  const unlistedPath = path.join(dir, "unlisted-domains.csv");
  fs.writeFileSync(classifiedPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    unlistedPath,
    ["domain,queries_seen_in,queries", ...rows.map((r) => [r.domain, r.count, r.queries.join(" | ")].map(csvCell).join(","))].join("\n") + "\n",
    "utf8",
  );
  return { file, classifiedPath, unlistedPath };
}
