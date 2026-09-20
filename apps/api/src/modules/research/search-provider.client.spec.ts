import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { FetchLike } from "../import/http/allowlist-fetch";
import { KEYWORD_OVERVIEW_ENDPOINT, SERP_ORGANIC_ENDPOINT } from "./price-table";
import {
  CacheCorruptError,
  MissingCredentialsError,
  ProviderError,
  SearchProviderClient,
  cacheKeyFor,
  canonicalJson,
} from "./search-provider.client";
import { Ledger, SpendGuard, SpendRefusedError } from "./spend-guard";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const LOGIN = "login-secret-abc";
const PASSWORD = "password-secret-xyz";

const okBody = (cost: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    status_code: 20000,
    status_message: "Ok.",
    cost,
    tasks_error: 0,
    tasks: [{ status_code: 20000, result: [{ ok: true }] }],
    ...extra,
  });

const reply = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("SearchProviderClient", () => {
  let dir: string;
  let cacheDir: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-client-"));
    cacheDir = path.join(dir, "cache");
    ledger = new Ledger(path.join(dir, "ledger.jsonl"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const build = (opts: {
    execute: boolean;
    fetchImpl?: FetchLike;
    runCapUsd?: number;
    login?: string | undefined;
    password?: string | undefined;
  }) => {
    const guard = new SpendGuard({
      ledger,
      ...(opts.runCapUsd === undefined ? {} : { runCapUsd: opts.runCapUsd }),
      now: () => NOW,
    });
    const client = new SearchProviderClient({
      credentials: {
        login: "login" in opts ? opts.login : LOGIN,
        password: "password" in opts ? opts.password : PASSWORD,
      },
      guard,
      cacheDir,
      execute: opts.execute,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      now: () => NOW,
    });
    return { client, guard };
  };

  const serp = (keyword = "things to do in rome") => ({
    stage: "serp",
    endpoint: SERP_ORGANIC_ENDPOINT,
    tasks: [{ keyword, location_code: 2380, language_code: "en" }],
  });

  const ledgerText = () => (fs.existsSync(ledger.file) ? fs.readFileSync(ledger.file, "utf8") : "");
  const cacheFiles = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);

  describe("dry run", () => {
    it("makes zero fetch calls and returns the estimate", async () => {
      const fetchImpl = jest.fn<FetchLike>();
      const { client, guard } = build({ execute: false, fetchImpl });

      const outcome = await client.request(serp());

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ kind: "dry_run", keywords: 1 });
      expect((outcome as { estimateUsd: number }).estimateUsd).toBeCloseTo(0.002, 9);
      expect(guard.plannedCallCount).toBe(1);
      expect(ledgerText()).toBe("");
      expect(cacheFiles()).toEqual([]);
    });

    it("counts planned calls against the run cap so a dry run shows a real run would be refused", async () => {
      const fetchImpl = jest.fn<FetchLike>();
      const { client } = build({ execute: false, fetchImpl, runCapUsd: 0.003 });

      await client.request(serp("one"));
      await expect(client.request(serp("two"))).rejects.toBeInstanceOf(SpendRefusedError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("works without a network at all, even with an unreachable fetch", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockRejectedValue(new Error("offline"));
      const { client } = build({ execute: false, fetchImpl });
      await expect(client.request(serp())).resolves.toMatchObject({ kind: "dry_run" });
    });
  });

  describe("execute", () => {
    it("sends one authenticated POST to the provider host and records the reported cost", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      const { client, guard } = build({ execute: true, fetchImpl });

      const outcome = await client.request(serp());

      expect(outcome.kind).toBe("sent");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string | URL, RequestInit];
      expect(String(url)).toBe(`https://api.dataforseo.com/v3/${SERP_ORGANIC_ENDPOINT}`);
      expect(init.method).toBe("POST");
      const auth = (init.headers as Record<string, string>).Authorization;
      expect(auth).toBe(`Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`);

      expect(guard.runSpentUsd).toBeCloseTo(0.002, 9);
      const lines = ledger.read();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ stage: "serp", endpoint: SERP_ORGANIC_ENDPOINT, keywords: 1, cost: 0.002 });
      expect(cacheFiles()).toHaveLength(1);
    });

    it("charges once for the same request twice: the second is a cache hit with no fetch and no ledger line", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      const { client, guard } = build({ execute: true, fetchImpl });

      const first = await client.request(serp());
      const second = await client.request(serp());

      expect(first.kind).toBe("sent");
      expect(second.kind).toBe("cache_hit");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(ledger.read()).toHaveLength(1);
      expect(guard.runSpentUsd).toBeCloseTo(0.002, 9);
    });

    it("serves a cache hit across client instances (a later run) without a fetch", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      await build({ execute: true, fetchImpl }).client.request(serp());

      const second = jest.fn<FetchLike>();
      const outcome = await build({ execute: true, fetchImpl: second }).client.request(serp());
      expect(outcome.kind).toBe("cache_hit");
      expect(second).not.toHaveBeenCalled();
    });

    it("serves a cache hit even in dry run and charges nothing", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      await build({ execute: true, fetchImpl }).client.request(serp());

      const dry = build({ execute: false, fetchImpl: jest.fn<FetchLike>() });
      const outcome = await dry.client.request(serp());
      expect(outcome.kind).toBe("cache_hit");
      expect(dry.guard.plannedCallCount).toBe(0);
    });

    it("refuses over the run cap before sending: nothing fetched, ledger unchanged", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      const { client } = build({ execute: true, fetchImpl, runCapUsd: 0.001 });

      await expect(client.request(serp())).rejects.toBeInstanceOf(SpendRefusedError);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(ledgerText()).toBe("");
      expect(cacheFiles()).toEqual([]);
    });

    it("refuses over the month ceiling before sending", async () => {
      ledger.append({
        ts: NOW.toISOString(),
        stage: "demand",
        endpoint: KEYWORD_OVERVIEW_ENDPOINT,
        keywords: 1,
        cost: 24.999,
        cacheKey: "seed",
      });
      const before = ledgerText();
      const fetchImpl = jest.fn<FetchLike>();
      const { client } = build({ execute: true, fetchImpl });

      await expect(client.request(serp())).rejects.toMatchObject({ reason: "month_ceiling" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(ledgerText()).toBe(before);
    });

    it("refuses an endpoint outside the price table before any network access", async () => {
      const fetchImpl = jest.fn<FetchLike>();
      const { client } = build({ execute: true, fetchImpl });
      await expect(
        client.request({ stage: "x", endpoint: "appendix/user_data", tasks: [{}] }),
      ).rejects.toThrow(/not in the research price table/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("credentials", () => {
    it("stops with a plain message naming what is missing and never sends", () => {
      const guard = new SpendGuard({ ledger, now: () => NOW });
      expect(
        () =>
          new SearchProviderClient({
            credentials: { login: undefined, password: PASSWORD },
            guard,
            cacheDir,
            execute: true,
          }),
      ).toThrow(MissingCredentialsError);

      try {
        new SearchProviderClient({
          credentials: { login: "", password: "" },
          guard,
          cacheDir,
          execute: true,
        });
        throw new Error("should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("DATAFORSEO_LOGIN");
        expect(message).toContain("DATAFORSEO_PASSWORD");
        expect(message).toContain("Doppler");
      }
    });

    it("never writes the login or password to the ledger, the cache, or error text", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      const { client } = build({ execute: true, fetchImpl });
      await client.request(serp());

      const everything = [
        ledgerText(),
        ...cacheFiles().map((f) => fs.readFileSync(path.join(cacheDir, f), "utf8")),
        Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64"),
      ];
      // The base64 form is included on purpose as the last item: it must not appear in the first two.
      const stored = everything.slice(0, -1).join("\n");
      expect(stored).not.toContain(LOGIN);
      expect(stored).not.toContain(PASSWORD);
      expect(stored).not.toContain(everything[everything.length - 1] as string);
    });

    it("redacts credentials that a network error message happens to echo back", async () => {
      const fetchImpl = jest
        .fn<FetchLike>()
        .mockRejectedValue(new Error(`connect failed for ${LOGIN}:${PASSWORD}`));
      const { client } = build({ execute: true, fetchImpl });

      let message = "";
      try {
        await client.request(serp());
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        message = (error as Error).message;
      }
      expect(message).toContain("[redacted]");
      expect(message).not.toContain(LOGIN);
      expect(message).not.toContain(PASSWORD);
    });
  });

  describe("failures", () => {
    it("does not cache a failed provider response, and does not retry", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(
        reply(
          JSON.stringify({ status_code: 40501, status_message: "Invalid Field", cost: 0, tasks_error: 1, tasks: [] }),
        ),
      );
      const { client } = build({ execute: true, fetchImpl });

      await expect(client.request(serp())).rejects.toBeInstanceOf(ProviderError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(cacheFiles()).toEqual([]);
      expect(ledgerText()).toBe("");
    });

    it("still records money that moved on a failed call", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(
        reply(
          JSON.stringify({
            status_code: 20000,
            cost: 0.002,
            tasks_error: 1,
            tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
          }),
        ),
      );
      const { client, guard } = build({ execute: true, fetchImpl });

      await expect(client.request(serp())).rejects.toBeInstanceOf(ProviderError);
      expect(ledger.read()).toHaveLength(1);
      expect(guard.runSpentUsd).toBeCloseTo(0.002, 9);
      expect(cacheFiles()).toEqual([]);
    });

    it("halts the client when a response has no usable cost, and refuses every later request", async () => {
      const fetchImpl = jest
        .fn<FetchLike>()
        .mockResolvedValue(reply(JSON.stringify({ status_code: 20000, tasks_error: 0, tasks: [] })));
      const { client } = build({ execute: true, fetchImpl });

      await expect(client.request(serp("one"))).rejects.toThrow(/without a usable cost/);
      await expect(client.request(serp("two"))).rejects.toThrow(/stopped after a response that reported no cost/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(ledgerText()).toBe("");
    });

    it("reports an HTTP error without retrying", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply("nope", 500));
      const { client } = build({ execute: true, fetchImpl });
      await expect(client.request(serp())).rejects.toThrow(/HTTP 500/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("stops on a corrupt cache entry instead of paying to replace it", async () => {
      const fetchImpl = jest.fn<FetchLike>();
      const { client } = build({ execute: true, fetchImpl });
      const request = serp();
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir, `${cacheKeyFor(request.endpoint, request.tasks)}.json`),
        "{not json",
      );

      await expect(client.request(request)).rejects.toBeInstanceOf(CacheCorruptError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("leaves no temp file behind after a successful cache write", async () => {
      const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(reply(okBody(0.002)));
      await build({ execute: true, fetchImpl }).client.request(serp());
      expect(cacheFiles().every((f) => f.endsWith(".json") && !f.endsWith(".tmp"))).toBe(true);
    });
  });

  describe("cache key", () => {
    it("is the same whatever order the params are written in, at every depth", () => {
      const a = cacheKeyFor("e", [{ keyword: "rome", location_code: 2380, nested: { b: 1, a: 2 } }]);
      const b = cacheKeyFor("e", [{ nested: { a: 2, b: 1 }, location_code: 2380, keyword: "rome" }]);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes with the endpoint or any param value", () => {
      const base = cacheKeyFor("e", [{ keyword: "rome" }]);
      expect(cacheKeyFor("f", [{ keyword: "rome" }])).not.toBe(base);
      expect(cacheKeyFor("e", [{ keyword: "paris" }])).not.toBe(base);
    });

    it("keeps array order, since task order is meaningful", () => {
      expect(canonicalJson([{ a: 1 }, { a: 2 }])).not.toBe(canonicalJson([{ a: 2 }, { a: 1 }]));
    });
  });
});
