import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { LIVE_FILE, SLICE_CONTENT_DIR, renderLiveFile } from "./index-files";
import { parseLiveSlugs } from "./live-guard";

/**
 * `pnpm --filter @folio/web seo:live-guard --base <ref>` end to end (spec 0006
 * AC-8). The base side comes from a throwaway git repo (GIT_DIR points the
 * script's `git show` at it), so this repo's history is never touched. The head
 * side is this working tree's real content, so the base sets below are chosen
 * to hold whatever the head currently is: the head's own live set (nothing
 * dropped) and a slug that can never be in any manifest.
 */

const WEB_ROOT = path.resolve(__dirname, "../../..");
const REPO_PATH = "apps/web/src/content/seo/bangkok/live.generated.ts";
const NEVER_A_SLUG = "not-a-slice-page-zz";

let gitDir: string;
let work: string;
const commits: Record<string, string> = {};

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", ...args], {
    cwd: work,
    encoding: "utf8",
  }).trim();
}

/** Commits the given live slugs (or no live file at all) and returns the sha. */
function commitBase(slugs: string[] | null): string {
  const file = path.join(work, REPO_PATH);
  rmSync(file, { force: true });
  if (slugs) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, renderLiveFile(slugs));
  }
  writeFileSync(path.join(work, "marker"), String(Math.random()));
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return git("rev-parse", "HEAD");
}

function runGuard(args: string[]) {
  const res = spawnSync(
    path.join(WEB_ROOT, "node_modules/.bin/ts-node"),
    ["--project", "scripts/tsconfig.seo.json", "scripts/seo-live-guard.ts", ...args],
    { cwd: WEB_ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: gitDir } },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const headSlugs = () => parseLiveSlugs(readFileSync(path.join(SLICE_CONTENT_DIR, LIVE_FILE), "utf8"));

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), "seo-live-guard-"));
  gitDir = path.join(work, ".git");
  git("init", "-q");
  commits.noFile = commitBase(null);
  commits.sameAsHead = commitBase(headSlugs());
  commits.removed = commitBase([...headSlugs(), NEVER_A_SLUG]);
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("seo:live-guard script (spec 0006 AC-8)", () => {
  it("passes when the base has no live file yet", () => {
    const { status, out } = runGuard(["--base", commits.noFile]);
    expect(status).toBe(0);
    expect(out).toContain("has no apps/web/src/content/seo/bangkok/live.generated.ts");
  });

  it("passes when the base live set matches the head", () => {
    const { status, out } = runGuard(["--base", commits.sameAsHead]);
    expect(status).toBe(0);
    expect(out).toContain("seo:live-guard: ok");
  });

  it("fails when a page live at the base is gone from the head manifest", () => {
    const { status, out } = runGuard(["--base", commits.removed]);
    expect(status).toBe(1);
    expect(out).toContain(`${NEVER_A_SLUG}: live on the base branch but removed from the manifest`);
  });

  it("exits 2 with a usage line when --base is missing", () => {
    const { status, out } = runGuard([]);
    expect(status).toBe(2);
    expect(out).toContain("Usage: seo:live-guard --base <commit>");
  });
});
