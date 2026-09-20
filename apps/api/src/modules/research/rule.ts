import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

/**
 * The pursue or skip rule as a program can read it (BRI-206, spec child 0002).
 *
 * `docs/research/bri-206/rule.md` is the single source. Its fenced JSON block
 * holds the numbers and the class lists, so the prose and the code cannot
 * drift apart. This file parses that block and enforces the commit first gate:
 * no paid results page is fetched until the rule file is committed and clean.
 */

const domainList = z.array(z.string().min(1));
const pathMap = z.record(z.string(), z.array(z.string().min(1)));

const ruleSchema = z.object({
  version: z.number().int(),
  market: z.object({ locationCode: z.number().int(), languageCode: z.string().min(2) }),
  demandFloor: z.number().int().positive(),
  topN: z.number().int().positive(),
  openAtSmallSites: z.number().int().positive(),
  minValidatedPerFamily: z.number().int().positive(),
  pursueShare: z.number().gt(0).lte(1),
  marketplace: z.object({ domains: domainList, exceptPaths: pathMap.default({}) }),
  forumOrSocial: z.object({ domains: domainList, paths: pathMap.default({}) }),
  bigPublisher: z.object({
    domains: domainList,
    suffixes: domainList.default([]),
    firstLabelPrefixes: domainList.default([]),
  }),
});

export type Rule = z.infer<typeof ruleSchema>;

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

/** Reads the first ```json fence in the rule file. */
export function parseRule(markdown: string): Rule {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(markdown);
  if (match === null) throw new RuleError("rule.md has no ```json block, so the rule cannot be read.");
  let raw: unknown;
  try {
    raw = JSON.parse(match[1] as string);
  } catch {
    throw new RuleError("The ```json block in rule.md is not valid JSON.");
  }
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuleError(
      `The rule block in rule.md is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export function loadRule(ruleFile: string): Rule {
  if (!fs.existsSync(ruleFile)) throw new RuleError(`${ruleFile} does not exist.`);
  return parseRule(fs.readFileSync(ruleFile, "utf8"));
}

/** Runs `git <args>` in `cwd` and returns stdout. Injectable so the gate is testable without a real repo. */
export type GitRunner = (args: readonly string[], cwd: string) => string;

export const realGit: GitRunner = (args, cwd) =>
  execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export interface RuleGate {
  /** Full commit hash of the last commit that touched the rule file. */
  commit: string;
  /** ISO time of that commit. */
  committedAt: string;
}

/**
 * The commit first gate. Passes only if the rule file exists, git reports no
 * local change to it (modified or untracked), and the last commit touching it
 * is older than `now`. Returns the commit to record next to each result.
 */
export function checkRuleGate(options: {
  ruleFile: string;
  repoRoot: string;
  now: Date;
  git?: GitRunner;
}): RuleGate {
  const git = options.git ?? realGit;
  const rel = path.relative(options.repoRoot, options.ruleFile);
  const refuse = (why: string): never => {
    throw new RuleError(
      `Refusing to fetch results pages: ${why} The rule must be committed before any results are pulled. Nothing was sent and nothing was spent.`,
    );
  };

  if (!fs.existsSync(options.ruleFile)) refuse(`${rel} does not exist.`);

  let status: string;
  let log: string;
  try {
    status = git(["status", "--porcelain", "--", rel], options.repoRoot);
    log = git(["log", "-1", "--format=%H%n%cI", "--", rel], options.repoRoot);
  } catch (error) {
    return refuse(`git could not check ${rel} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`);
  }

  if (status.trim() !== "") refuse(`${rel} has uncommitted changes.`);
  const [commit, committedAt] = log.trim().split("\n");
  if (commit === undefined || commit === "" || committedAt === undefined) refuse(`${rel} has no commit yet.`);
  if (!(new Date(committedAt as string).getTime() < options.now.getTime())) {
    refuse(`the last commit of ${rel} is not older than now.`);
  }
  return { commit: commit as string, committedAt: committedAt as string };
}

/** The rule file's last commit and whether it has local changes, without refusing. For labelling reclassified output. */
export function describeRuleCommit(options: {
  ruleFile: string;
  repoRoot: string;
  git?: GitRunner;
}): { commit: string | null; dirty: boolean } {
  const git = options.git ?? realGit;
  const rel = path.relative(options.repoRoot, options.ruleFile);
  try {
    const dirty = git(["status", "--porcelain", "--", rel], options.repoRoot).trim() !== "";
    const commit = git(["log", "-1", "--format=%H", "--", rel], options.repoRoot).trim();
    return { commit: commit === "" ? null : commit, dirty };
  } catch {
    return { commit: null, dirty: true };
  }
}
