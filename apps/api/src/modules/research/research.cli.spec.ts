import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { main } from "./research.cli";

const NOW = new Date("2026-09-20T12:00:00.000Z");

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

  describe("stages not built yet", () => {
    it.each(["candidates", "demand", "serp", "classify"])(
      "%s says it is not built and that nothing was spent",
      async (stage) => {
        const code = await run([stage, "--city", "rome"]);
        expect(code).toBe(2);
        expect(err.join("\n")).toContain("not built yet");
        expect(err.join("\n")).toContain("Nothing was sent and nothing was spent");
      },
    );
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
