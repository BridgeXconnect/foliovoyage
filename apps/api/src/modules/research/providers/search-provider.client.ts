import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  AllowlistFetch,
  type FetchLike,
} from "../../import/http/allowlist-fetch";
import { estimateRequest } from "../pricing/price-table";
import { SpendGuard, toMicros } from "../pricing/spend-guard";

/**
 * The one code path to the search data provider (BRI-206, spec child 0001).
 *
 * Every request goes: build key, cache lookup, estimate, guard check, then
 * either stop (dry run) or send, record the provider reported cost in the
 * ledger, and keep the raw response on disk.
 *
 * - Credentials come only from the values handed in by the caller (the
 *   process environment, via Doppler). They are held in private fields, sent
 *   only as the Authorization header built at call time, and redacted from any
 *   error text. They are never written to the ledger or the cache.
 * - Outbound calls go through {@link AllowlistFetch} locked to the provider
 *   host, so nothing else can be reached from here.
 * - A failed call is never retried automatically.
 */

export const DATAFORSEO_HOST = "api.dataforseo.com";
const DATAFORSEO_BASE_URL = `https://${DATAFORSEO_HOST}/v3`;
const BODY_SNIPPET_CHARS = 200;
const DATAFORSEO_OK = 20000;

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(
      `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        `Set them in Doppler project foliovoyage, config dev, and run through ` +
        `"doppler run --". Nothing was sent.`,
    );
    this.name = "MissingCredentialsError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class CacheCorruptError extends Error {
  constructor(file: string) {
    super(
      `Cache entry ${file} is not valid JSON. Not sending a new paid request in its place. ` +
        `Delete that file to fetch it again.`,
    );
    this.name = "CacheCorruptError";
  }
}

/** The parts of a DataForSEO response envelope this client reads. */
export interface ProviderResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks_error?: number;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: unknown;
  }>;
  [key: string]: unknown;
}

export type ProviderOutcome =
  | { kind: "cache_hit"; cacheKey: string; response: ProviderResponse }
  | { kind: "dry_run"; cacheKey: string; estimateUsd: number; keywords: number }
  | {
      kind: "sent";
      cacheKey: string;
      costUsd: number;
      response: ProviderResponse;
    };

export interface SearchProviderClientOptions {
  credentials: { login: string | undefined; password: string | undefined };
  guard: SpendGuard;
  /** Directory for `<sha256>.json` raw responses. */
  cacheDir: string;
  /** False (the default in the CLI) means dry run: nothing is sent. */
  execute: boolean;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

export interface ProviderRequestInput {
  /** Pipeline stage, recorded in the ledger. */
  stage: string;
  /** Endpoint path under `/v3`, e.g. `serp/google/organic/live/regular`. */
  endpoint: string;
  /** DataForSEO task array (the request body). */
  tasks: readonly unknown[];
}

/** JSON with object keys sorted at every depth, so equal params hash equally. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** sha256 of the endpoint plus the sorted params. Credentials are never part of it. */
export function cacheKeyFor(endpoint: string, tasks: readonly unknown[]): string {
  return crypto
    .createHash("sha256")
    .update(`${endpoint}\n${canonicalJson(tasks)}`)
    .digest("hex");
}

export class SearchProviderClient {
  readonly #login: string;
  readonly #password: string;
  readonly #guard: SpendGuard;
  readonly #cacheDir: string;
  readonly #execute: boolean;
  readonly #http: AllowlistFetch;
  readonly #now: () => Date;
  #halted = false;

  constructor(options: SearchProviderClientOptions) {
    const missing: string[] = [];
    if (!options.credentials.login) missing.push("DATAFORSEO_LOGIN");
    if (!options.credentials.password) missing.push("DATAFORSEO_PASSWORD");
    if (missing.length > 0) throw new MissingCredentialsError(missing);

    this.#login = options.credentials.login as string;
    this.#password = options.credentials.password as string;
    this.#guard = options.guard;
    this.#cacheDir = options.cacheDir;
    this.#execute = options.execute;
    this.#now = options.now ?? (() => new Date());
    this.#http = new AllowlistFetch(
      [DATAFORSEO_HOST],
      options.fetchImpl ?? fetch,
      options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    );
  }

  async request(input: ProviderRequestInput): Promise<ProviderOutcome> {
    if (this.#halted) {
      throw new ProviderError(
        "This client stopped after a response that reported no cost. Check the provider " +
          "dashboard for what was charged, then start a new run.",
        input.endpoint,
      );
    }

    // Validates the endpoint and task shape before any file or network access.
    const { keywords, estimateUsd } = estimateRequest(input.endpoint, input.tasks);
    const cacheKey = cacheKeyFor(input.endpoint, input.tasks);

    const cached = this.#readCache(cacheKey);
    if (cached) return { kind: "cache_hit", cacheKey, response: cached };

    this.#guard.check(estimateUsd);

    if (!this.#execute) {
      this.#guard.plan(estimateUsd);
      return { kind: "dry_run", cacheKey, estimateUsd, keywords };
    }

    const text = await this.#send(input);
    const response = this.#parse(text, input.endpoint);

    const cost = response.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      this.#halted = true;
      throw new ProviderError(
        `${input.endpoint} answered without a usable cost, so the spend could not be recorded. ` +
          `Check the provider dashboard for what was charged. Stopping this run.`,
        input.endpoint,
      );
    }

    const failure = this.#failureOf(response);

    // Record spend whenever money moved, even if the call also failed.
    if (failure === undefined || cost > 0) {
      this.#guard.record({
        ts: this.#now().toISOString(),
        stage: input.stage,
        endpoint: input.endpoint,
        keywords,
        cost,
        cacheKey,
      });
    }
    if (failure !== undefined) {
      throw new ProviderError(
        this.#redact(`${input.endpoint} failed: ${failure}`),
        input.endpoint,
      );
    }

    try {
      this.#writeCache(cacheKey, text);
    } catch (error) {
      throw new ProviderError(
        `${input.endpoint} succeeded and its cost (${cost}) is in the ledger, but the response could not ` +
          `be saved to the cache: ${error instanceof Error ? error.message : String(error)}`,
        input.endpoint,
      );
    }

    return { kind: "sent", cacheKey, costUsd: toMicros(cost) / 1_000_000, response };
  }

  async #send(input: ProviderRequestInput): Promise<string> {
    const auth = Buffer.from(`${this.#login}:${this.#password}`).toString("base64");
    let res: Response;
    try {
      res = await this.#http.fetch(`${DATAFORSEO_BASE_URL}/${input.endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(input.tasks),
      });
    } catch (error) {
      throw new ProviderError(
        this.#redact(
          `${input.endpoint} did not get a response (${error instanceof Error ? error.message : String(error)}). ` +
            `It may still have been charged, so check the provider dashboard. Not retried.`,
        ),
        input.endpoint,
      );
    }

    if (!res.ok) {
      throw new ProviderError(
        this.#redact(
          `${input.endpoint} failed with HTTP ${res.status}${await this.#bodySnippet(res)}. Not retried.`,
          auth,
        ),
        input.endpoint,
      );
    }
    return res.text();
  }

  /** The first bit of an error reply, so a bare status code still says why. Empty if there is nothing to show. */
  async #bodySnippet(res: Response): Promise<string> {
    try {
      const text = (await res.text()).replace(/\s+/g, " ").trim();
      return text === "" ? "" : ` (reply: ${text.slice(0, BODY_SNIPPET_CHARS)})`;
    } catch {
      return "";
    }
  }

  #parse(text: string, endpoint: string): ProviderResponse {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError(
        `${endpoint} returned a body that is not JSON. It may still have been charged, so check the provider dashboard.`,
        endpoint,
      );
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new ProviderError(`${endpoint} returned an unexpected body shape.`, endpoint);
    }
    return json as ProviderResponse;
  }

  /** A plain description of why a response is a failure, or undefined if it is fine. */
  #failureOf(response: ProviderResponse): string | undefined {
    if (response.status_code !== DATAFORSEO_OK) {
      return `status ${String(response.status_code)} ${String(response.status_message ?? "")}`.trim();
    }
    if (typeof response.tasks_error === "number" && response.tasks_error > 0) {
      const bad = response.tasks?.find((t) => t.status_code !== DATAFORSEO_OK);
      return `task status ${String(bad?.status_code)} ${String(bad?.status_message ?? "")}`.trim();
    }
    return undefined;
  }

  #redact(message: string, ...also: string[]): string {
    // Longest values first, so a short login inside the encoded value can't leave fragments of it behind.
    return [...also, this.#login, this.#password].reduce(
      (text, secret) => text.split(secret).join("[redacted]"),
      message,
    );
  }

  #cacheFile(cacheKey: string): string {
    return path.join(this.#cacheDir, `${cacheKey}.json`);
  }

  #readCache(cacheKey: string): ProviderResponse | undefined {
    const file = this.#cacheFile(cacheKey);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ProviderResponse;
    } catch {
      throw new CacheCorruptError(file);
    }
  }

  /** Save the raw response text exactly as received, via a temp file so a crash never leaves half a file. */
  #writeCache(cacheKey: string, text: string): void {
    fs.mkdirSync(this.#cacheDir, { recursive: true });
    const file = this.#cacheFile(cacheKey);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
  }
}
