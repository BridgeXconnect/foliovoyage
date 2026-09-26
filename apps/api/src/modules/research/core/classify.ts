import type { QueryFamily } from "./candidates";
import type { Rule } from "./rule";

/**
 * Domain classification and the pursue or skip verdicts (BRI-206, spec
 * children 0002 and 0005). Everything here is a pure function of saved data
 * and the rule, so the rule can be reapplied to the same raw responses for
 * free and a wrong class list never needs a second purchase.
 */

export type DomainClass = "marketplace" | "forum_or_social" | "big_publisher" | "small_site";

export interface OrganicResult {
  domain: string;
  url: string;
  rank: number;
}

export interface ClassifiedResult extends OrganicResult {
  class: DomainClass;
  /** True when the domain matched no list and fell to the small site default. */
  unlisted: boolean;
}

/** Lower case, no leading `www.`, no trailing dot or port. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

const matchesDomain = (domain: string, listed: string): boolean =>
  domain === listed || domain.endsWith(`.${listed}`);

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

const onPath = (map: Record<string, string[]>, domain: string, urlPath: string): boolean =>
  Object.entries(map).some(
    ([listed, prefixes]) => matchesDomain(domain, listed) && prefixes.some((p) => urlPath.startsWith(p)),
  );

/** The class of one result, checked in the rule's order, first match wins. Anything unmatched is a small site. */
export function classifyDomain(
  domainInput: string,
  url: string,
  rule: Rule,
): { class: DomainClass; unlisted: boolean } {
  const domain = normalizeDomain(domainInput);
  const urlPath = pathOf(url);

  if (
    rule.marketplace.domains.some((d) => matchesDomain(domain, d)) &&
    !onPath(rule.marketplace.exceptPaths, domain, urlPath)
  ) {
    return { class: "marketplace", unlisted: false };
  }

  if (
    rule.forumOrSocial.domains.some((d) => matchesDomain(domain, d)) ||
    onPath(rule.forumOrSocial.paths, domain, urlPath)
  ) {
    return { class: "forum_or_social", unlisted: false };
  }

  const firstLabel = domain.split(".")[0] ?? "";
  if (
    rule.bigPublisher.domains.some((d) => matchesDomain(domain, d)) ||
    rule.bigPublisher.suffixes.some((s) => domain.endsWith(s)) ||
    rule.bigPublisher.firstLabelPrefixes.some((p) => firstLabel.startsWith(p))
  ) {
    return { class: "big_publisher", unlisted: false };
  }

  return { class: "small_site", unlisted: true };
}

/**
 * The organic top results of one provider response: `type` is `organic`, in
 * `rank_group` order, one result per domain (its best rank), at most `topN`.
 * Featured snippets, people also ask, maps and video blocks are ignored.
 */
export function organicTop(response: unknown, topN: number): OrganicResult[] {
  const tasks = (response as { tasks?: Array<{ result?: Array<{ items?: unknown[] }> }> } | null)?.tasks;
  const items = tasks?.[0]?.result?.[0]?.items;
  if (!Array.isArray(items)) return [];

  const organic: OrganicResult[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (r.type !== "organic") continue;
    const rank = r.rank_group;
    const url = r.url;
    const domain = r.domain ?? (typeof url === "string" ? safeHost(url) : undefined);
    if (typeof rank !== "number" || typeof url !== "string" || typeof domain !== "string") continue;
    organic.push({ domain: normalizeDomain(domain), url, rank });
  }
  organic.sort((a, b) => a.rank - b.rank);

  const seen = new Set<string>();
  const result: OrganicResult[] = [];
  for (const o of organic) {
    if (o.rank > topN || seen.has(o.domain)) continue;
    seen.add(o.domain);
    result.push(o);
  }
  return result;
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export interface QueryVerdict {
  results: ClassifiedResult[];
  counts: Record<DomainClass, number>;
  smallSites: number;
  verdict: "open" | "closed";
}

/** Classify a query's top results and decide open or closed. */
export function judgeQuery(top: readonly OrganicResult[], rule: Rule): QueryVerdict {
  const results = top.map((r): ClassifiedResult => ({ ...r, ...classifyDomain(r.domain, r.url, rule) }));
  const counts: Record<DomainClass, number> = { marketplace: 0, forum_or_social: 0, big_publisher: 0, small_site: 0 };
  for (const r of results) counts[r.class]++;
  return {
    results,
    counts,
    smallSites: counts.small_site,
    verdict: counts.small_site >= rule.openAtSmallSites ? "open" : "closed",
  };
}

export interface FamilyInput {
  query: string;
  families: readonly QueryFamily[];
  verdict: "open" | "closed";
  marketplaces: number;
}

export interface FamilyVerdict {
  family: QueryFamily;
  validated: number;
  open: number;
  closed: number;
  openShare: number | null;
  medianMarketplaces: number | null;
  verdict: "pursue" | "skip" | "insufficient_data";
}

export const ALL_FAMILIES: readonly QueryFamily[] = ["things_to_do", "tag", "attraction", "best_time"];

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * One verdict per family over the validated queries that have a results page.
 * A query with two family labels counts in both. Fewer than the minimum is
 * insufficient data, otherwise pursue if at least the share are open.
 */
export function judgeFamilies(queries: readonly FamilyInput[], rule: Rule): FamilyVerdict[] {
  return ALL_FAMILIES.map((family) => {
    const mine = queries.filter((q) => q.families.includes(family));
    const open = mine.filter((q) => q.verdict === "open").length;
    const validated = mine.length;
    const openShare = validated === 0 ? null : open / validated;
    const verdict: FamilyVerdict["verdict"] =
      validated < rule.minValidatedPerFamily
        ? "insufficient_data"
        : (openShare as number) >= rule.pursueShare
          ? "pursue"
          : "skip";
    return {
      family,
      validated,
      open,
      closed: validated - open,
      openShare,
      medianMarketplaces: median(mine.map((q) => q.marketplaces)),
      verdict,
    };
  });
}
