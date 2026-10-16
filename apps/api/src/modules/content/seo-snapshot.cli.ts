import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Client } from "pg";
import type { SeoSliceSnapshot } from "@folio/shared";

import { canonicalFileJson } from "./seo-slice-hash";
import { parseSeoSliceManifest } from "./seo-slice-manifest-schema";
import type { SeoSliceTourInput } from "./seo-slice-membership";
import { planSnapshot, SEO_SLICE_EXCLUSION_LABELS, SEO_SLICE_HUB_MIN_PAGES, type SeoSnapshotPlan } from "./seo-snapshot";

/**
 * `seo:snapshot [--out <dir>]` (spec 0006 prod snapshot, scope row 20). Run as
 * `doppler run --config prd -- pnpm --filter @folio/api seo:snapshot`.
 *
 * Reads Bangkok tours from prod on one read only `pg` client and writes one
 * `{slug}.snapshot.json` per category page and the hub. It refuses any
 * endpoint but the unpooled prod one before connecting, the client is made
 * read only before any data query, and the command stops when Postgres does
 * not confirm it (AC-S1). The connection string is never printed.
 */

/** The slice content folder in apps/web, the default `--out` and the manifest's home. */
export const SEO_SLICE_CONTENT_DIR = path.resolve(__dirname, "../../../../web/src/content/seo/bangkok");
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const INDEX_COMMAND = "pnpm --filter @folio/web seo:index";

/**
 * Every non deleted tour of any Experience that has a tour under the ref, so
 * the representative tour (the lowest id) is chosen from all of them, not only
 * from the ones under the ref (AC-S3, AC-M8).
 */
export const SEO_SNAPSHOT_QUERY = `
SELECT t.id, t."experienceId", e.status AS "experienceStatus", t."providerTourId", t.title,
       t."durationMin", t."ratingAvg", t."ratingCount", t."affiliateUrl", t."imageUrl",
       t."imageAlt", t.inclusions, t.tags, t."destinationRefs", t."deletedAt"
FROM "Tour" t
LEFT JOIN "Experience" e ON e.id = t."experienceId"
WHERE t."deletedAt" IS NULL
  AND ($1 = ANY(t."destinationRefs")
       OR t."experienceId" IN (
         SELECT "experienceId" FROM "Tour"
         WHERE "deletedAt" IS NULL AND $1 = ANY("destinationRefs") AND "experienceId" IS NOT NULL))
ORDER BY t.id`;

/**
 * The prod Neon endpoint (AC-S1). `DIRECT_URL` must be its unpooled host, whose
 * first label is exactly this name, so the dev and stg configs and the pooled
 * host (`…-pooler`) are all refused before any connection.
 */
export const SEO_SNAPSHOT_PROD_ENDPOINT = "ep-lingering-wildflower-ax1mdc4m";

export type EndpointCheck = { ok: true } | { ok: false; found: string | null; expected: string };

/** Pure: does this connection string point at the prod endpoint? Never echoes the URL. */
export function checkProdEndpoint(url: string): EndpointCheck {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { ok: false, found: null, expected: SEO_SNAPSHOT_PROD_ENDPOINT };
  }
  const endpoint = host.split(".")[0] || null;
  return endpoint === SEO_SNAPSHOT_PROD_ENDPOINT ? { ok: true } : { ok: false, found: endpoint, expected: SEO_SNAPSHOT_PROD_ENDPOINT };
}

/** The slice of `pg.Client` this command uses. */
export interface SnapshotDbClient {
  connect(): Promise<unknown>;
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<unknown>;
}

export interface SnapshotFiles {
  read(file: string): string | null;
  write(file: string, text: string): void;
  remove(file: string): void;
}

export interface SnapshotDeps {
  createClient?: (connectionString: string) => SnapshotDbClient;
  files?: SnapshotFiles;
  /** Runs `seo:index`; returns an error message, or null when it passed. */
  runIndex?: () => string | null;
  now?: () => Date;
  manifestPath?: string;
}

const nodeFiles: SnapshotFiles = {
  read: (file) => (existsSync(file) ? readFileSync(file, "utf8") : null),
  write: (file, text) => writeFileSync(file, text),
  remove: (file) => unlinkSync(file),
};

function runIndexCommand(): string | null {
  const result = spawnSync("pnpm", ["--filter", "@folio/web", "seo:index"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.error) return result.error.message;
  return result.status === 0 ? null : `exited with code ${result.status}`;
}

/** Today's date in Asia/Bangkok, as `YYYY-MM-DD`. */
export function bangkokDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parseArgs(argv: string[]): { outDir: string } | { error: string } {
  let outDir = SEO_SLICE_CONTENT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[++i];
      if (!value) return { error: "--out needs a folder" };
      outDir = path.resolve(value);
    } else {
      return { error: `unknown argument ${arg}` };
    }
  }
  return { outDir };
}

/**
 * Opens the client and makes it read only, then checks Postgres says so
 * (AC-S1). Returns null, having closed the client, when it does not.
 */
export async function openReadOnly(client: SnapshotDbClient, err: (line: string) => void): Promise<SnapshotDbClient | null> {
  await client.connect();
  let answer: string | undefined;
  try {
    await client.query("SET default_transaction_read_only = on");
    const { rows } = await client.query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only");
    answer = rows[0]?.default_transaction_read_only;
  } catch (error) {
    // Close the socket so the process can exit; main's caller prints the message only.
    await client.end();
    throw error;
  }
  if (answer !== "on") {
    err(`seo:snapshot: the connection reports default_transaction_read_only = ${answer ?? "nothing"}, not on. No data was read.`);
    await client.end();
    return null;
  }
  return client;
}

function printReport(plan: SeoSnapshotPlan, out: (line: string) => void): void {
  out("Exclusion counts (representative tours of published Experiences with an image, before the gate):");
  for (const row of plan.exclusions) {
    const counts = SEO_SLICE_EXCLUSION_LABELS.map((l) => `${l} ${row.counts[l]}`).join(", ");
    out(`  ${row.slug ?? "whole pool (hub and stats)"}: ${counts}`);
  }
  out("");
  out("Pages:");
  for (const page of plan.pages) out(`  ${page.slug}: ${page.status}${page.note ? ` (${page.note})` : ""}`);
}

function printNextSteps(plan: SeoSnapshotPlan, hubSlug: string, out: (line: string) => void): void {
  const steps: string[] = [];
  for (const slug of plan.thin) {
    if (slug === hubSlug) {
      steps.push(
        `${slug} is thin: fewer than ${SEO_SLICE_HUB_MIN_PAGES} category pages give it cards, so its snapshot was not written (and any old one deleted). It stays out of the live set until enough category pages pass; rerun seo:snapshot after that.`,
      );
      continue;
    }
    steps.push(
      `${slug} is thin, so its snapshot was not written (and any old one deleted). Set "held": true on it in manifest.json, then run doppler run -- pnpm --filter @folio/api hub-copy:run --page ${hubSlug} and approve the hub (hub-copy:approve --page ${hubSlug} --by <initials>), in this same PR.`,
    );
  }
  for (const page of plan.pages) {
    if (page.factsChanged) steps.push(`${page.slug}: facts changed. Run doppler run -- pnpm --filter @folio/api hub-copy:run --page ${page.slug}.`);
    else if (page.picksChanged) {
      steps.push(`${page.slug}: picks changed. Look at the new cards, then run pnpm --filter @folio/api hub-copy:approve --page ${page.slug} --by <initials>.`);
    }
  }
  if (steps.length === 0) return;
  out("");
  out("Next steps:");
  for (const step of steps) out(`  - ${step}`);
  out("");
  out("Put this refresh, the regenerated copy and every approve in one PR. CI's live guard fails the PR otherwise.");
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: { out: (line: string) => void; err: (line: string) => void },
  deps: SnapshotDeps = {},
): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.err(`seo:snapshot: ${args.error}. Usage: seo:snapshot [--out <dir>]`);
    return 1;
  }
  const files = deps.files ?? nodeFiles;

  // AC-S2: the manifest is checked before the database is touched.
  const manifestPath = deps.manifestPath ?? path.join(SEO_SLICE_CONTENT_DIR, "manifest.json");
  const manifestText = files.read(manifestPath);
  if (manifestText === null) {
    io.err(`seo:snapshot: no manifest at ${manifestPath}. Nothing written.`);
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch (error) {
    io.err(`seo:snapshot: manifest.json is not valid JSON (${(error as Error).message}). Nothing written.`);
    return 1;
  }
  const parsed = parseSeoSliceManifest(raw);
  if (!parsed.ok) {
    io.err(`seo:snapshot: the manifest has ${parsed.problems.length} problem(s), nothing written:`);
    for (const p of parsed.problems) io.err(`  - ${p}`);
    return 1;
  }
  const manifest = parsed.manifest;

  const url = env.DIRECT_URL;
  if (!url) {
    io.err("seo:snapshot: DIRECT_URL is not set. Run it through doppler run --config prd.");
    return 1;
  }
  // AC-S1: only the unpooled prod endpoint, checked before any connection.
  const endpoint = checkProdEndpoint(url);
  if (!endpoint.ok) {
    io.err(
      `seo:snapshot: DIRECT_URL points at endpoint ${endpoint.found ?? "(none, the URL could not be parsed)"}, ` +
        `expected ${endpoint.expected} (the unpooled prod host). Run it through doppler run --config prd. Nothing read or written.`,
    );
    return 1;
  }

  const createClient = deps.createClient ?? ((connectionString: string) => new Client({ connectionString }));
  const client = await openReadOnly(createClient(url), io.err);
  if (!client) return 1;
  let tours: SeoSliceTourInput[];
  try {
    const { rows } = await client.query<SeoSliceTourInput>(SEO_SNAPSHOT_QUERY, [manifest.city.destinationRef]);
    tours = rows;
  } finally {
    await client.end();
  }

  const fileOf = (slug: string) => path.join(args.outDir, `${slug}.snapshot.json`);
  const existing: Record<string, SeoSliceSnapshot | null> = {};
  for (const page of manifest.pages) {
    const text = files.read(fileOf(page.slug));
    existing[page.slug] = text === null ? null : (JSON.parse(text) as SeoSliceSnapshot);
  }

  const plan = planSnapshot({ tours, manifest, existing, today: bangkokDate((deps.now ?? (() => new Date()))()) });
  for (const page of plan.pages) {
    if (page.write) files.write(fileOf(page.slug), canonicalFileJson(page.write));
    if (page.remove) files.remove(fileOf(page.slug));
  }

  io.out(`seo:snapshot: read ${tours.length} tours under ref ${manifest.city.destinationRef}.`);
  printReport(plan, io.out);

  let code = plan.thin.length > 0 ? 1 : 0;
  if (args.outDir === SEO_SLICE_CONTENT_DIR) {
    io.out("");
    io.out(`Running ${INDEX_COMMAND}`);
    const indexError = (deps.runIndex ?? runIndexCommand)();
    if (indexError) {
      io.err(`seo:snapshot: seo:index failed (${indexError}). Fix the problem it printed, then run ${INDEX_COMMAND} yourself.`);
      code = 1;
    }
  } else {
    io.out("");
    io.out(`Wrote to ${args.outDir}, not the slice folder, so seo:index was not run.`);
  }

  printNextSteps(plan, manifest.pages.find((p) => p.kind === "hub")!.slug, io.out);
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // The message only, never the connection string.
      console.error(`seo:snapshot: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
