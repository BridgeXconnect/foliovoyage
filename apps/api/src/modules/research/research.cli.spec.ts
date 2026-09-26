import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { RESEARCH_DATA_DIR, main } from "./research.cli";

const NOW = new Date("2026-09-20T12:00:00.000Z");

describe("research:hub data location", () => {
  // The spend ledger lives under this directory and is derived from __dirname.
  // If the CLI is ever moved, this silently relocates the ledger and the
  // monthly spend accounting restarts at $0, so pin it to apps/api/research-data.
  it("stays at apps/api/research-data", () => {
    expect(RESEARCH_DATA_DIR).toBe(path.resolve(__dirname, "../../..", "research-data"));
    expect(path.relative(path.resolve(__dirname, "../../.."), RESEARCH_DATA_DIR)).toBe("research-data");
    expect(path.basename(path.resolve(__dirname, "../../.."))).toBe("api");
  });
});

describe("research:hub CLI", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l) });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-cli-"));
    out = [];
    err = [];
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
    main(argv, env, io(), { dataDir: dir, now: () => NOW });

  describe("spend", () => {
    it("shows month, run cap and credential status with no ledger yet, and exits 0", async () => {
      const code = await run(["spend"], { DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" });
      const text = out.join("\n");

      expect(code).toBe(0);
      expect(text).toContain("Month spent:    $0.0000 of $25.0000");
      expect(text).toContain("Month left:     $25.0000");
      expect(text).toContain("Run cap:        $1.0000");
      expect(text).toContain("DATAFORSEO_LOGIN set, DATAFORSEO_PASSWORD set");
      expect(fs.existsSync(path.join(dir, "ledger.jsonl"))).toBe(false);
    });

    it("never prints credential values", async () => {
      await run(["spend"], { DATAFORSEO_LOGIN: "login-secret-abc", DATAFORSEO_PASSWORD: "password-secret-xyz" });
      const text = [...out, ...err].join("\n");
      expect(text).not.toContain("login-secret-abc");
      expect(text).not.toContain("password-secret-xyz");
    });

    it("reports missing credentials without failing", async () => {
      const code = await run(["spend"]);
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("DATAFORSEO_LOGIN missing, DATAFORSEO_PASSWORD missing");
    });

    it("reads this month's total from the ledger", async () => {
      fs.writeFileSync(
        path.join(dir, "ledger.jsonl"),
        `${JSON.stringify({
          ts: "2026-09-02T00:00:00.000Z",
          stage: "demand",
          endpoint: "e",
          keywords: 5,
          cost: 0.25,
          cacheKey: "k",
        })}\n`,
      );
      await run(["spend"]);
      const text = out.join("\n");
      expect(text).toContain("Month spent:    $0.2500");
      expect(text).toContain("Month left:     $24.7500");
    });

    it("clamps HUB_RESEARCH_MAX_USD above 5 and says so", async () => {
      await run(["spend"], { HUB_RESEARCH_MAX_USD: "10" });
      const text = out.join("\n");
      expect(text).toContain("Run cap:        $5.0000");
      expect(text).toContain("clamped");
    });

    it("rejects a bad HUB_RESEARCH_MAX_USD instead of loosening the cap", async () => {
      const code = await run(["spend"], { HUB_RESEARCH_MAX_USD: "-3" });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("HUB_RESEARCH_MAX_USD");
      expect(out).toEqual([]);
    });

    it("says when no total budget is set", async () => {
      await run(["spend"]);
      expect(out.join("\n")).toContain("Total budget:   not set");
    });

    it("shows the total budget and what is left of it from the whole ledger", async () => {
      fs.writeFileSync(
        path.join(dir, "ledger.jsonl"),
        `${JSON.stringify({
          ts: "2026-08-02T00:00:00.000Z",
          stage: "demand",
          endpoint: "e",
          keywords: 5,
          cost: 0.25,
          cacheKey: "k",
        })}\n`,
      );
      await run(["spend"], { HUB_RESEARCH_MAX_USD: "0.6", HUB_RESEARCH_BUDGET_USD: "0.6" });
      const text = out.join("\n");
      expect(text).toContain("Run cap:        $0.6000");
      expect(text).toContain("Total budget:   $0.6000 across all runs, $0.3500 left");
    });

    it("rejects a bad HUB_RESEARCH_BUDGET_USD instead of loosening the budget", async () => {
      const code = await run(["spend"], { HUB_RESEARCH_BUDGET_USD: "0" });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("HUB_RESEARCH_BUDGET_USD");
      expect(out).toEqual([]);
    });

    it("stops on a corrupt ledger with a plain message", async () => {
      fs.writeFileSync(path.join(dir, "ledger.jsonl"), "garbage\n");
      const code = await run(["spend"]);
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("unreadable");
    });
  });

  describe("candidates", () => {
    const tourRow = (title: string) => ({ title, ratingAvg: 4.5, ratingCount: 20 });
    const reader = (tours = [tourRow("Bangkok food tour")]) => ({
      tagRows: async () => [{ tagId: 1, productCount: 40, ratingAvg: 4.6 }],
      tourRows: async () => tours,
    });
    const catalog = {
      tagNames: async () => new Map([[1, "Food Tours"]]),
      attractions: async () => [{ name: "Grand Palace", productCount: 30, ratingAvg: 4.7 }],
    };
    const runCandidates = (argv: string[], deps: Record<string, unknown> = {}) =>
      main(argv, {}, io(), { dataDir: dir, now: () => NOW, reader: reader(), catalog, ...deps });

    it("writes candidates.json and candidates.csv and reports a cost of zero", async () => {
      const code = await runCandidates(["candidates", "--city", "bangkok"]);
      const text = out.join("\n");

      expect(code).toBe(0);
      expect(text).toContain("Cost: $0.0000");
      const folder = path.join(dir, "bri-206", "bangkok");
      const file = JSON.parse(fs.readFileSync(path.join(folder, "candidates.json"), "utf8"));
      expect(file.city).toBe("bangkok");
      expect(file.candidates.map((c: { query: string }) => c.query)).toContain("things to do in bangkok");
      expect(fs.readFileSync(path.join(folder, "candidates.csv"), "utf8")).toContain("grand palace tickets");
    });

    it("never writes to the ledger", async () => {
      await runCandidates(["candidates", "--city", "bangkok"]);
      expect(fs.existsSync(path.join(dir, "ledger.jsonl"))).toBe(false);
    });

    it("gives the same file on a second run", async () => {
      await runCandidates(["candidates", "--city", "bangkok"]);
      const file = path.join(dir, "bri-206", "bangkok", "candidates.json");
      const first = fs.readFileSync(file, "utf8");
      await runCandidates(["candidates", "--city", "bangkok"]);
      expect(fs.readFileSync(file, "utf8")).toBe(first);
    });

    it("needs --city", async () => {
      expect(await runCandidates(["candidates"])).toBe(2);
      expect(err.join("\n")).toContain("--city");
    });

    it("names the curated cities when the city is unknown", async () => {
      expect(await runCandidates(["candidates", "--city", "atlantis"])).toBe(1);
      expect(err.join("\n")).toContain("Unknown city");
      expect(err.join("\n")).toContain("bangkok");
    });

    it("stops when no tours are stored for the city", async () => {
      expect(await runCandidates(["candidates", "--city", "bangkok"], { reader: reader([]) })).toBe(1);
      expect(err.join("\n")).toContain("nothing to rank");
    });

    it("stops with a plain message when Viator config is missing and no fake is given", async () => {
      const code = await main(["candidates", "--city", "bangkok"], {}, io(), { dataDir: dir, reader: reader() });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("VIATOR_API_KEY");
    });
  });

  describe("usage", () => {
    it("prints usage and exits 2 with no stage", async () => {
      expect(await run([])).toBe(2);
      expect(err.join("\n")).toContain("Usage:");
    });

    it("rejects an unknown stage", async () => {
      expect(await run(["frobnicate"])).toBe(2);
      expect(err.join("\n")).toContain('Unknown stage "frobnicate"');
    });
  });
});
