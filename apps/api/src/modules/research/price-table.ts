/**
 * Cost estimates for the DataForSEO endpoints the research CLI is allowed to
 * call (BRI-206, spec child 0001).
 *
 * These are ESTIMATES, used only to decide whether a call may be sent. The
 * ledger always records the `cost` the provider reports in its response, never
 * these numbers.
 *
 * UNVERIFIED: the figures come from the content engine strategy document, not
 * from DataForSEO's pricing page (open follow-up in the spec). If a real price
 * is higher, the guard under-estimates until the constants are corrected, so
 * check them before any large run.
 *
 * The table doubles as the endpoint allowlist: an endpoint with no entry here
 * cannot be sent, so there is exactly one place that decides what the tool may
 * buy.
 */

/** Keyword Overview live: charged per task plus per keyword returned. */
export const KEYWORD_OVERVIEW_ENDPOINT =
  "dataforseo_labs/google/keyword_overview/live";

/** SERP organic live regular: charged per 10 result page, one keyword per task. */
export const SERP_ORGANIC_ENDPOINT = "serp/google/organic/live/regular";

export const PRICE_USD = {
  keywordOverviewPerTask: 0.012,
  keywordOverviewPerKeyword: 0.00012,
  serpPerPage: 0.002,
} as const;

/** DataForSEO multiplies the SERP charge by this when the keyword uses a search operator. */
const SEARCH_OPERATOR_MULTIPLIER = 5;

const SEARCH_OPERATOR_PATTERN =
  /\b(site|inurl|intitle|allintitle|allinurl|intext|allintext|filetype|related|cache|define|info|link):/i;

const SERP_PAGE_SIZE = 10;

export class UnknownEndpointError extends Error {
  constructor(endpoint: string) {
    super(
      `Endpoint "${endpoint}" is not in the research price table, so it cannot be sent. ` +
        `Add it to price-table.ts with a price first.`,
    );
    this.name = "UnknownEndpointError";
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(`Invalid provider request: ${message}`);
    this.name = "InvalidRequestError";
  }
}

export interface RequestEstimate {
  /** Keywords the request covers, for the ledger's `keywords` field. */
  keywords: number;
  /** Estimated cost in USD, from the constants above. */
  estimateUsd: number;
}

function asTask(task: unknown, index: number): Record<string, unknown> {
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    throw new InvalidRequestError(`task ${index} is not an object`);
  }
  return task as Record<string, unknown>;
}

/**
 * Estimate a request from its endpoint and DataForSEO task array. Throws (never
 * guesses) on an unknown endpoint or a task shape it cannot price, so a
 * malformed request is refused before any money can move.
 */
export function estimateRequest(
  endpoint: string,
  tasks: readonly unknown[],
): RequestEstimate {
  if (tasks.length === 0) {
    throw new InvalidRequestError("no tasks");
  }

  if (endpoint === KEYWORD_OVERVIEW_ENDPOINT) {
    let keywords = 0;
    tasks.forEach((raw, i) => {
      const task = asTask(raw, i);
      if (
        !Array.isArray(task.keywords) ||
        task.keywords.length === 0 ||
        !task.keywords.every((k) => typeof k === "string")
      ) {
        throw new InvalidRequestError(
          `task ${i} needs a non empty "keywords" array of strings`,
        );
      }
      keywords += task.keywords.length;
    });
    return {
      keywords,
      estimateUsd:
        PRICE_USD.keywordOverviewPerTask * tasks.length +
        PRICE_USD.keywordOverviewPerKeyword * keywords,
    };
  }

  if (endpoint === SERP_ORGANIC_ENDPOINT) {
    let estimateUsd = 0;
    tasks.forEach((raw, i) => {
      const task = asTask(raw, i);
      if (typeof task.keyword !== "string" || task.keyword.length === 0) {
        throw new InvalidRequestError(
          `task ${i} needs a non empty "keyword" string`,
        );
      }
      const depth = task.depth ?? SERP_PAGE_SIZE;
      if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1) {
        throw new InvalidRequestError(
          `task ${i} "depth" must be a positive integer`,
        );
      }
      const pages = Math.ceil(depth / SERP_PAGE_SIZE);
      const multiplier = SEARCH_OPERATOR_PATTERN.test(task.keyword)
        ? SEARCH_OPERATOR_MULTIPLIER
        : 1;
      estimateUsd += PRICE_USD.serpPerPage * pages * multiplier;
    });
    return { keywords: tasks.length, estimateUsd };
  }

  throw new UnknownEndpointError(endpoint);
}
