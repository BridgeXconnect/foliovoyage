import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { RuleError, checkRuleGate, describeRuleCommit, loadRule, parseRule, type GitRunner } from "./rule";

const REAL_RULE = path.resolve(__dirname, "../../../../../docs/research/bri-206/rule.md");
const NOW = new Date("2026-09-20T12:00:00.000Z");

describe("parseRule", () => {
  it("reads the committed rule.md", () => {
    const rule = loadRule(REAL_RULE);
    expect(rule.demandFloor).toBe(100);
    expect(rule.topN).toBe(10);
    expect(rule.openAtSmallSites).toBe(3);
    expect(rule.minValidatedPerFamily).toBe(5);
    expect(rule.pursueShare).toBe(0.5);
    expect(rule.market).toEqual({ locationCode: 2840, languageCode: "en" });
    expect(rule.marketplace.domains).toContain("viator.com");
  });

  it("refuses a file with no json block", () => {
    expect(() => parseRule("# no block here")).toThrow(RuleError);
  });

  it("refuses invalid json", () => {
    expect(() => parseRule("```json\n{ nope\n```")).toThrow(/not valid JSON/);
  });

  it("refuses a block missing a required number and names it", () => {
    expect(() => parseRule('```json\n{"version":1}\n```')).toThrow(/demandFloor/);
  });

  it("refuses a pursue share above 1", () => {
    const rule = JSON.parse(/```json\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(REAL_RULE, "utf8"))?.[1] as string);
    rule.pursueShare = 1.5;
    expect(() => parseRule(`\`\`\`json\n${JSON.stringify(rule)}\n\`\`\``)).toThrow(/pursueShare/);
  });
});

describe("checkRuleGate", () => {
  let dir: string;
  let ruleFile: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-gate-"));
    ruleFile = path.join(dir, "docs/research/bri-206/rule.md");
    fs.mkdirSync(path.dirname(ruleFile), { recursive: true });
    fs.writeFileSync(ruleFile, "x");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const git = (status: string, log: string): GitRunner => (args) => (args[0] === "status" ? status : log);
  const call = (g: GitRunner, now = NOW) => checkRuleGate({ ruleFile, repoRoot: dir, now, git: g });

  it("passes for a clean file with an older commit and returns the commit", () => {
    const gate = call(git("", "abc123\n2026-09-19T10:00:00+00:00\n"));
    expect(gate).toEqual({ commit: "abc123", committedAt: "2026-09-19T10:00:00+00:00" });
  });

  it("checks the file by its path relative to the repo root", () => {
    const seen: string[][] = [];
    call((args) => {
      seen.push([...args]);
      return args[0] === "status" ? "" : "abc\n2026-09-19T10:00:00+00:00\n";
    });
    expect(seen[0]).toEqual(["status", "--porcelain", "--", "docs/research/bri-206/rule.md"]);
  });

  it.each([
    ["a modified file", " M docs/research/bri-206/rule.md\n"],
    ["an untracked file", "?? docs/research/bri-206/rule.md\n"],
    ["a staged but uncommitted file", "A  docs/research/bri-206/rule.md\n"],
  ])("refuses %s", (_name, status) => {
    expect(() => call(git(status, "abc\n2026-09-19T10:00:00+00:00\n"))).toThrow(/uncommitted changes/);
  });

  it("refuses when the file has no commit yet", () => {
    expect(() => call(git("", ""))).toThrow(/no commit yet/);
  });

  it("refuses when the commit is not older than now", () => {
    expect(() => call(git("", "abc\n2026-09-20T12:00:00+00:00\n"))).toThrow(/not older than now/);
    expect(() => call(git("", "abc\n2026-09-21T00:00:00+00:00\n"))).toThrow(/not older than now/);
  });

  it("refuses when the file does not exist", () => {
    fs.rmSync(ruleFile);
    expect(() => call(git("", ""))).toThrow(/does not exist/);
  });

  it("refuses when git itself fails, rather than assuming the file is fine", () => {
    expect(() =>
      call(() => {
        throw new Error("not a git repository");
      }),
    ).toThrow(/git could not check/);
  });

  it("says nothing was sent and nothing was spent", () => {
    expect(() => call(git(" M x", ""))).toThrow(/Nothing was sent and nothing was spent/);
  });
});

describe("describeRuleCommit", () => {
  it("reports the commit and the dirty flag without refusing", () => {
    const g: GitRunner = (args) => (args[0] === "status" ? " M rule.md" : "abc\n");
    expect(describeRuleCommit({ ruleFile: "/r/rule.md", repoRoot: "/r", git: g })).toEqual({ commit: "abc", dirty: true });
  });

  it("reports dirty with no commit when git fails", () => {
    const g: GitRunner = () => {
      throw new Error("boom");
    };
    expect(describeRuleCommit({ ruleFile: "/r/rule.md", repoRoot: "/r", git: g })).toEqual({ commit: null, dirty: true });
  });
});
