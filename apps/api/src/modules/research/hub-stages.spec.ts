import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { FetchLike } from "../import/http/allowlist-fetch";
import { parseDemand } from "./stages/demand.stage";
import { KEYWORD_OVERVIEW_ENDPOINT } from "./pricing/price-table";
import { main } from "./research.cli";
import type { GitRunner } from "./core/rule";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const RULE_FILE = path.resolve(__dirname, "../../../../../docs/research/bri-206/rule.md");
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const ENV = { DATAFORSEO_LOGIN: "login-secret-abc", DATAFORSEO_PASSWORD: "password-secret-xyz", HUB_RESEARCH_MAX_USD: "0.60", HUB_RESEARCH_BUDGET_USD: "0.60" };

// Real git prints one line for `--format=%H` and two for `--format=%H%n%cI`, so the fake does the same.
const gitLog = (args: readonly string[]): string =>
  args.includes("--format=%H") ? `${COMMIT}\n` : `${COMMIT}\n2026-09-19T10:00:00+00:00\n`;
const cleanGit: GitRunner = (args) => (args[0] === "status" ? "" : gitLog(args));
const dirtyGit: GitRunner = (args) => (args[0] === "status" ? " M docs/research/bri-206/rule.md\n" : gitLog(args));

// Candidate queries: 6 tag queries, one things_to_do query, one under the floor, one the provider has no data for.
const CANDIDATES = [
  ["things to do in bangkok", "things_to_do"],
  ["tour a", "tag"],
  ["tour b", "tag"],
  ["tour c", "tag"],
  ["tour d", "tag"],
  ["tour e", "tag"],
  ["tour f", "tag"],
  ["tour tiny", "tag"],
  ["tour ghost", "tag"],
] as const;
const VOLUMES: Record<string, number> = {
  "things to do in bangkok": 5000,
  "tour a": 900,
  "tour b": 800,
  "tour c": 700,
  "tour d": 600,
  "tour e": 500,
  "tour f": 400,
  "tour tiny": 50,
};
const OPEN = new Set(["tour a", "tour b", "tour c", "tour d"]);

const demandBody = (cost: number) =>
  JSON.stringify({
    status_code: 20000,
    cost,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            items: Object.entries(VOLUMES).map(([keyword, volume]) => ({
              keyword,
              keyword_info: { search_volume: volume },
              keyword_properties: { keyword_difficulty: 30 },
              search_intent_info: { main_intent: "commercial" },
              avg_backlinks_info: { backlinks: 10 },
            })),
          },
        ],
      },
    ],
  });

const serpBody = (keyword: string, cost = 0.002) => {
  const open = OPEN.has(keyword);
  const domains = open
    ? ["viator.com", "blog-one.com", "blog-two.com", "blog-three.com", "timeout.com"]
    : ["viator.com", "getyourguide.com", "reddit.com", "timeout.com", "blog-one.com"];
  return JSON.stringify({
    status_code: 20000,
    cost,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            items: [
              { type: "people_also_ask", rank_group: 1 },
              ...domains.map((d, i) => ({ type: "organic", rank_group: i + 1, domain: d, url: `https://${d}/${keyword.replace(/ /g, "-")}` })),
            ],
          },
        ],
      },
    ],
  });
};

const reply = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("demand, serp and classify stages", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l) });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-stages-"));
    out = [];
    err = [];
    const cityDir = path.join(dir, "bri-206", "bangkok");
    fs.mkdirSync(cityDir, { recursive: true });
    fs.writeFileSync(
      path.join(cityDir, "candidates.json"),
      JSON.stringify({ city: "bangkok", candidates: CANDIDATES.map(([query, family]) => ({ query, families: [family] })) }),
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A fake provider that answers demand and serp calls and records each request body. */
  const provider = (over: { serpCost?: number; failSerpOn?: string } = {}) =>
    jest.fn<FetchLike>().mockImplementation(async (url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as Array<Record<string, unknown>>;
      if (String(url).endsWith(KEYWORD_OVERVIEW_ENDPOINT)) return reply(demandBody(0.0246));
      const keyword = String(body[0]?.keyword);
      if (keyword === over.failSerpOn) return reply("upstream broke", 500);
      return reply(serpBody(keyword, over.serpCost));
    });

  const run = (argv: string[], fetchImpl: FetchLike, opts: { git?: GitRunner; env?: NodeJS.ProcessEnv } = {}) =>
    main(argv, opts.env ?? ENV, io(), {
      dataDir: dir,
      now: () => NOW,
      providerFetch: fetchImpl,
      ruleFile: RULE_FILE,
      repoRoot: REPO_ROOT,
      git: opts.git ?? cleanGit,
    });

  const cityFile = (name: string) => path.join(dir, "bri-206", "bangkok", name);
  const readJson = (name: string) => JSON.parse(fs.readFileSync(cityFile(name), "utf8"));
  const ledgerLines = () =>
    fs.existsSync(path.join(dir, "ledger.jsonl"))
      ? fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];

  describe("demand", () => {
    it("dry run sends nothing, writes nothing and prints the estimate", async () => {
      const fetchImpl = provider();
      expect(await run(["demand", "--city", "bangkok"], fetchImpl)).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(out.join("\n")).toContain("would send one request with 9 keywords");
      expect(fs.existsSync(cityFile("demand.json"))).toBe(false);
      expect(ledgerLines()).toEqual([]);
    });

    it("sends every keyword in one request and records the provider's cost", async () => {
      const fetchImpl = provider();
      expect(await run(["demand", "--city", "bangkok", "--execute"], fetchImpl)).toBe(0);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
      expect(body).toHaveLength(1);
      expect(body[0].keywords).toHaveLength(9);
      expect(body[0]).toMatchObject({ location_code: 2840, language_code: "en" });
      expect(body[0]).not.toHaveProperty("include_clickstream_data");

      const demand = readJson("demand.json");
      expect(demand.costUsd).toBe(0.0246);
      expect(demand.counts).toEqual({ queries: 9, ok: 8, noData: 1, validated: 7 });
      expect(ledgerLines()).toHaveLength(1);
      expect(ledgerLines()[0].cost).toBe(0.0246);
    });

    it("marks a keyword the provider did not return as no_data, and one under the floor as not validated", async () => {
      await run(["demand", "--city", "bangkok", "--execute"], provider());
      const byQuery = Object.fromEntries(readJson("demand.json").entries.map((e: { query: string }) => [e.query, e]));
      expect(byQuery["tour ghost"]).toMatchObject({ status: "no_data", validated: false, volume: null });
      expect(byQuery["tour tiny"]).toMatchObject({ status: "ok", validated: false, volume: 50 });
      expect(byQuery["tour a"]).toMatchObject({ status: "ok", validated: true, volume: 900 });
    });

    it("answers a rerun from the saved response at no charge", async () => {
      const fetchImpl = provider();
      await run(["demand", "--city", "bangkok", "--execute"], fetchImpl);
      await run(["demand", "--city", "bangkok", "--execute"], fetchImpl);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(ledgerLines()).toHaveLength(1);
    });

    it("stops with a plain message when there are no candidates yet", async () => {
      fs.rmSync(cityFile("candidates.json"));
      expect(await run(["demand", "--city", "bangkok", "--execute"], provider())).toBe(1);
      expect(err.join("\n")).toContain("candidates");
    });

    it("refuses before sending when the estimate would pass the total budget", async () => {
      const fetchImpl = provider();
      const code = await run(["demand", "--city", "bangkok", "--execute"], fetchImpl, { env: { ...ENV, HUB_RESEARCH_BUDGET_USD: "0.01" } });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("total budget");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(ledgerLines()).toEqual([]);
    });

    it("--pilot reads and writes the pilot folder, --market asks about another market, and the ledger stays shared", async () => {
      const pilotDir = path.join(dir, "bri-206-pilot", "bangkok");
      fs.mkdirSync(pilotDir, { recursive: true });
      fs.copyFileSync(cityFile("candidates.json"), path.join(pilotDir, "candidates.json"));
      const fetchImpl = provider();
      expect(await run(["demand", "--city", "bangkok", "--pilot", "--market", "2826:en", "--execute"], fetchImpl)).toBe(0);

      const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
      expect(body[0]).toMatchObject({ location_code: 2826, language_code: "en" });
      const saved = JSON.parse(fs.readFileSync(path.join(pilotDir, "demand.2826-en.json"), "utf8"));
      expect(saved).toMatchObject({ exploratory: true, market: { locationCode: 2826, languageCode: "en" } });
      expect(fs.existsSync(cityFile("demand.json"))).toBe(false);
      expect(ledgerLines()).toHaveLength(1);
    });

    it("rejects a malformed --market before sending", async () => {
      const fetchImpl = provider();
      await expect(run(["demand", "--city", "bangkok", "--market", "uk", "--execute"], fetchImpl)).resolves.toBe(1);
      expect(err.join("\n")).toContain("--market needs");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("never prints credentials", async () => {
      await run(["demand", "--city", "bangkok", "--execute"], provider());
      expect([...out, ...err].join("\n")).not.toMatch(/login-secret-abc|password-secret-xyz/);
    });
  });

  describe("serp", () => {
    beforeEach(async () => {
      await run(["demand", "--city", "bangkok", "--execute"], provider());
      out.length = 0;
    });

    it("refuses when rule.md has uncommitted changes, in a dry run and an execute run, before any call", async () => {
      for (const flag of [[], ["--execute"]]) {
        const fetchImpl = provider();
        expect(await run(["serp", "--city", "bangkok", ...flag], fetchImpl, { git: dirtyGit })).toBe(1);
        expect(err.join("\n")).toContain("uncommitted changes");
        expect(fetchImpl).not.toHaveBeenCalled();
      }
      expect(fs.existsSync(cityFile("serp.json"))).toBe(false);
      expect(ledgerLines()).toHaveLength(1); // only the demand call
    });

    it("dry run sends nothing and estimates 2 tenths of a cent per validated query", async () => {
      const fetchImpl = provider();
      expect(await run(["serp", "--city", "bangkok"], fetchImpl)).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(out.join("\n")).toContain("dry run estimate: $0.0140");
      expect(fs.existsSync(cityFile("serp.json"))).toBe(false);
    });

    it("sends one request per validated keyword, highest volume first, and records the rule commit", async () => {
      const fetchImpl = provider();
      expect(await run(["serp", "--city", "bangkok", "--execute"], fetchImpl)).toBe(0);

      const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(bodies).toHaveLength(7);
      for (const b of bodies) {
        expect(b).toHaveLength(1);
        expect(typeof b[0].keyword).toBe("string");
        expect(b[0]).toMatchObject({ location_code: 2840, language_code: "en", depth: 10 });
      }
      expect(bodies.map((b) => b[0].keyword)).toEqual(["things to do in bangkok", "tour a", "tour b", "tour c", "tour d", "tour e", "tour f"]);

      const serp = readJson("serp.json");
      expect(serp.ruleCommit).toBe(COMMIT);
      expect(serp.firstCallAt).toBe(NOW.toISOString());
      expect(serp.results).toHaveLength(7);
      expect(serp.results[0].ruleCommit).toBe(COMMIT);
      expect(serp.results[0].organic.map((o: { rank: number }) => o.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(ledgerLines()).toHaveLength(8); // demand plus 7 pulls
    });

    it("stops before sending the call that would pass the budget and lists what was left out", async () => {
      // 0.0246 is already spent. Two more 0.002 calls reach 0.0286, a third would reach 0.0306, over 0.0296.
      const fetchImpl = provider();
      const code = await run(["serp", "--city", "bangkok", "--execute"], fetchImpl, { env: { ...ENV, HUB_RESEARCH_BUDGET_USD: "0.0296" } });
      expect(code).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const serp = readJson("serp.json");
      expect(serp.results.map((r: { query: string }) => r.query)).toEqual(["things to do in bangkok", "tour a"]);
      expect(serp.notPulled.map((n: { query: string }) => n.query)).toEqual(["tour b", "tour c", "tour d", "tour e", "tour f"]);
      expect(serp.notPulled[0].reason).toContain("total budget");
      expect(ledgerLines()).toHaveLength(3);
      expect(out.join("\n")).toContain("REFUSED by the spend guard");
    });

    it("skips queries already saved on a rerun and spends nothing more", async () => {
      const fetchImpl = provider();
      await run(["serp", "--city", "bangkok", "--execute"], fetchImpl);
      const before = ledgerLines().length;
      fetchImpl.mockClear();
      expect(await run(["serp", "--city", "bangkok", "--execute"], fetchImpl)).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(ledgerLines()).toHaveLength(before);
      expect(out.join("\n")).toContain("already saved");
    });

    it("resumes after a refusal: only the queries left out are sent once the budget allows", async () => {
      const fetchImpl = provider();
      await run(["serp", "--city", "bangkok", "--execute"], fetchImpl, { env: { ...ENV, HUB_RESEARCH_BUDGET_USD: "0.0296" } });
      fetchImpl.mockClear();
      expect(await run(["serp", "--city", "bangkok", "--execute"], fetchImpl)).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(5);
      expect(readJson("serp.json").results).toHaveLength(7);
      expect(readJson("serp.json").notPulled).toEqual([]);
    });

    it("stops on a failed call, records it, does not retry and does not charge", async () => {
      const fetchImpl = provider({ failSerpOn: "tour b" });
      expect(await run(["serp", "--city", "bangkok", "--execute"], fetchImpl)).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(3); // things to do, tour a, tour b (failed), then stop
      const serp = readJson("serp.json");
      expect(serp.results).toHaveLength(2);
      expect(serp.failures).toHaveLength(1);
      expect(serp.failures[0].query).toBe("tour b");
      expect(ledgerLines()).toHaveLength(3);
    });

    it("needs the demand check first", async () => {
      fs.rmSync(cityFile("demand.json"));
      expect(await run(["serp", "--city", "bangkok", "--execute"], provider())).toBe(1);
      expect(err.join("\n")).toContain("demand");
    });
  });

  describe("classify", () => {
    beforeEach(async () => {
      await run(["demand", "--city", "bangkok", "--execute"], provider());
      await run(["serp", "--city", "bangkok", "--execute"], provider());
      out.length = 0;
    });

    const classify = (git: GitRunner = cleanGit) => run(["classify", "--city", "bangkok"], jest.fn<FetchLike>(), { git });

    it("is free: no provider call and no ledger line", async () => {
      const fetchImpl = jest.fn<FetchLike>();
      const before = ledgerLines().length;
      expect(await run(["classify", "--city", "bangkok"], fetchImpl)).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(ledgerLines()).toHaveLength(before);
      expect(out.join("\n")).toContain("Cost: $0.0000");
    });

    it("marks 3 or more small sites open and fewer closed, and gives a family verdict", async () => {
      await classify();
      const c = readJson("classified.json");
      const byQuery = Object.fromEntries(c.queries.map((q: { query: string }) => [q.query, q]));
      expect(byQuery["tour a"]).toMatchObject({ verdict: "open", smallSites: 3 });
      expect(byQuery["tour e"]).toMatchObject({ verdict: "closed", smallSites: 1 });
      const tag = c.families.find((f: { family: string }) => f.family === "tag");
      expect(tag).toMatchObject({ validated: 6, open: 4, closed: 2, verdict: "pursue" });
      const things = c.families.find((f: { family: string }) => f.family === "things_to_do");
      expect(things).toMatchObject({ validated: 1, verdict: "insufficient_data" });
      expect(c.rule).toMatchObject({ commit: COMMIT, dirty: false });
    });

    it("lists validated queries with no results page instead of counting them", async () => {
      const serp = readJson("serp.json");
      serp.results = serp.results.filter((r: { query: string }) => r.query !== "tour f");
      fs.writeFileSync(cityFile("serp.json"), JSON.stringify(serp));
      await classify();
      const c = readJson("classified.json");
      expect(c.missingSerp).toEqual(["tour f"]);
      expect(c.queries).toHaveLength(6);
    });

    it("writes the unlisted domains with the queries they appeared in", async () => {
      await classify();
      const csv = fs.readFileSync(cityFile("unlisted-domains.csv"), "utf8");
      expect(csv.split("\n")[0]).toBe("domain,queries_seen_in,queries");
      expect(csv).toContain("blog-one.com,7,");
    });

    it("labels the output as reclassified under local rule changes when rule.md is dirty, and still runs", async () => {
      expect(await classify(dirtyGit)).toBe(0);
      expect(readJson("classified.json").rule.dirty).toBe(true);
    });

    it("gives the same file twice on the same data", async () => {
      await classify();
      const first = fs.readFileSync(cityFile("classified.json"), "utf8");
      await classify();
      expect(fs.readFileSync(cityFile("classified.json"), "utf8")).toBe(first);
    });

    it("needs the serp pull first", async () => {
      fs.rmSync(cityFile("serp.json"));
      expect(await classify()).toBe(1);
      expect(err.join("\n")).toContain("serp");
    });
  });
});

describe("parseDemand", () => {
  it("matches keywords ignoring case and spacing, and treats a non numeric volume as no_data", () => {
    const response = {
      tasks: [{ result: [{ items: [{ keyword: " Tour A ", keyword_info: { search_volume: 300 } }, { keyword: "tour b", keyword_info: { search_volume: "lots" } }] }] }],
    };
    const [a, b] = parseDemand(response, ["tour a", "tour b"], 100);
    expect(a).toMatchObject({ volume: 300, validated: true, status: "ok" });
    expect(b).toMatchObject({ volume: null, validated: false, status: "no_data" });
  });

  it("validates at exactly the floor", () => {
    const response = { tasks: [{ result: [{ items: [{ keyword: "x", keyword_info: { search_volume: 100 } }] }] }] };
    expect(parseDemand(response, ["x"], 100)[0]?.validated).toBe(true);
  });

  it("returns no_data for every query when the response has no items", () => {
    expect(parseDemand({}, ["a", "b"], 100).every((e) => e.status === "no_data")).toBe(true);
  });
});
