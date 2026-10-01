import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import { TOUR_COPY_FAILURE_REASON_CODES } from "./tour-copy-check.constants";
import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";
import { GOLDEN_TOUR_COUNT, GOLDEN_TOURS_FILE, validateSnapshotShape, type GoldenTourSource } from "./tour-copy-golden-data";
import { readNumbers } from "./tour-copy-numbers";
import { checklistText, combinedSourceTextLength, MIN_SOURCE_CHARS } from "./tour-copy-source-text";

/**
 * `tour-copy-golden:snapshot [--execute]` (BRI-201 / spec 0003, AC-14). Reads
 * real tours and writes `golden/tour-copy-golden-tours.json` WITHOUT reference
 * paragraphs, for Roy to review and add references to. Reads the database only:
 * no gateway settings, no model call. A dry run is the default and writes
 * nothing. It refuses to overwrite an existing tours file, because that file
 * holds reviewed work.
 *
 * Selection is deterministic (candidates ordered by sha256 of `Tour.id`) and
 * spread over three strata:
 * - 24 tours whose `TourCopy` row recorded a first attempt failure reason,
 *   taken round robin over the reason codes;
 * - 12 check edge tours (source just above the 300 character floor, no
 *   duration, many numbers, awkward markup, long exclusions);
 * - the rest typical tours, round robin over the cities.
 * A shortfall in the failure stratum is filled from the typical stratum.
 */

export const FAILURE_STRATUM_SIZE = 24;
export const EDGE_STRATUM_SIZE = 12;
export const EDGE_KINDS = ["short_source", "null_duration", "many_numbers", "markup", "long_exclusions"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Just above the 300 character floor. */
const SHORT_SOURCE_MAX_CHARS = 400;
const MANY_NUMBERS_MIN = 8;
const LONG_EXCLUSIONS_MIN_CHARS = 300;
const MARKUP_PATTERN = /<\/?[a-z][^>]*>|&[a-z#0-9]+;|\*\*|__/i;

export interface SnapshotCandidate {
  id: string;
  title: string;
  description: string;
  durationMin: number | null;
  inclusions: unknown;
  exclusions: unknown;
  citySlug: string;
  /** The reason codes on the tour's `TourCopy` row; empty when it has none or has no row. */
  failureReasons: string[];
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function edgeKinds(candidate: SnapshotCandidate): EdgeKind[] {
  const kinds: EdgeKind[] = [];
  const length = combinedSourceTextLength(candidate);
  if (length >= MIN_SOURCE_CHARS && length <= SHORT_SOURCE_MAX_CHARS) kinds.push("short_source");
  if (candidate.durationMin === null) kinds.push("null_duration");
  const allText = [candidate.title, candidate.description, checklistText(candidate.inclusions), checklistText(candidate.exclusions)].join(" ");
  if (readNumbers(allText).length >= MANY_NUMBERS_MIN) kinds.push("many_numbers");
  if (MARKUP_PATTERN.test(allText)) kinds.push("markup");
  if (checklistText(candidate.exclusions).length >= LONG_EXCLUSIONS_MIN_CHARS) kinds.push("long_exclusions");
  return kinds;
}

/** Takes items from each group in turn, in group order, until `limit` are taken or every group is empty. */
function roundRobin<T>(groups: Array<[string, T[]]>, limit: number, take: (group: string, item: T) => void): void {
  const queues = groups.map(([label, items]) => ({ label, items: [...items] }));
  let taken = 0;
  while (taken < limit && queues.some((queue) => queue.items.length > 0)) {
    for (const queue of queues) {
      if (taken >= limit) return;
      const item = queue.items.shift();
      if (item === undefined) continue;
      take(queue.label, item);
      taken++;
    }
  }
}

/**
 * Picks the 60 golden tours from the candidates (pure and deterministic). Only
 * tours whose source clears the thin source floor are used, since generation
 * skips the rest. Throws when there are fewer than 60 usable tours.
 */
export function selectGoldenTours(candidates: readonly SnapshotCandidate[]): GoldenTourSource[] {
  const usable = candidates
    .filter((candidate) => combinedSourceTextLength(candidate) >= MIN_SOURCE_CHARS)
    .map((candidate) => ({ candidate, hash: sha256(candidate.id) }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    .map(({ candidate }) => candidate);
  if (usable.length < GOLDEN_TOUR_COUNT) {
    throw new Error(`Only ${usable.length} tours are usable for the golden set, and it needs ${GOLDEN_TOUR_COUNT}.`);
  }

  const picked = new Map<string, string>();
  const pick = (stratum: string, candidate: SnapshotCandidate): void => void picked.set(candidate.id, stratum);

  // Failure stratum: primary reason of each tour, round robin over the reason codes.
  const failureCodes = (TOUR_COPY_FAILURE_REASON_CODES as readonly string[]).filter((code) => code !== "source_too_thin");
  const byReason: Array<[string, SnapshotCandidate[]]> = [...failureCodes]
    .sort()
    .map((code) => [code, usable.filter((c) => c.failureReasons[0] === code)] as [string, SnapshotCandidate[]])
    .filter(([, items]) => items.length > 0);
  roundRobin(byReason, FAILURE_STRATUM_SIZE, (code, candidate) => pick(`failure:${code}`, candidate));

  // Edge stratum: one tour per edge kind in turn, a tour may qualify for several kinds.
  const byKind: Array<[string, SnapshotCandidate[]]> = EDGE_KINDS.map((kind) => [
    kind,
    usable.filter((c) => !picked.has(c.id) && edgeKinds(c).includes(kind)),
  ]);
  let edgeTaken = 0;
  const edgeQueues = byKind.map(([kind, items]) => ({ kind, items }));
  while (edgeTaken < EDGE_STRATUM_SIZE && edgeQueues.some((queue) => queue.items.length > 0)) {
    for (const queue of edgeQueues) {
      if (edgeTaken >= EDGE_STRATUM_SIZE) break;
      const next = queue.items.find((c) => !picked.has(c.id));
      queue.items = queue.items.filter((c) => c.id !== next?.id && !picked.has(c.id));
      if (next === undefined) continue;
      pick(`edge:${queue.kind}`, next);
      edgeTaken++;
    }
  }

  // Typical stratum: fills to 60, round robin over the cities, plain tours before edge ones.
  const fill = (pool: SnapshotCandidate[]): void => {
    const cities = new Map<string, SnapshotCandidate[]>();
    for (const candidate of pool) {
      if (picked.has(candidate.id)) continue;
      cities.set(candidate.citySlug, [...(cities.get(candidate.citySlug) ?? []), candidate]);
    }
    const groups = [...cities.entries()].sort(([a], [b]) => a.localeCompare(b));
    roundRobin(groups, GOLDEN_TOUR_COUNT - picked.size, (city, candidate) => pick(`typical:${city}`, candidate));
  };
  fill(usable.filter((c) => edgeKinds(c).length === 0));
  if (picked.size < GOLDEN_TOUR_COUNT) fill(usable);

  return usable
    .filter((candidate) => picked.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      stratum: picked.get(candidate.id)!,
      title: candidate.title,
      description: candidate.description,
      durationMin: candidate.durationMin,
      inclusions: candidate.inclusions as string[],
      exclusions: candidate.exclusions as string[],
    }));
}

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface SnapshotStore {
  loadCandidates(): Promise<SnapshotCandidate[]>;
}

export interface SnapshotCliDeps {
  store?: SnapshotStore;
  writeFile?: (file: string, content: string) => void;
  fileExists?: (file: string) => boolean;
  disconnect?: () => Promise<void>;
}

/** Tours on a published Experience that pass the rating gate and have a description: the tours the site would generate copy for. */
export function createPrismaSnapshotStore(prisma: PrismaService): SnapshotStore {
  return {
    async loadCandidates() {
      const rows = await prisma.tour.findMany({
        where: { deletedAt: null, description: { not: null }, experience: { is: { status: "published" } } },
        select: {
          id: true,
          title: true,
          description: true,
          durationMin: true,
          inclusions: true,
          exclusions: true,
          ratingAvg: true,
          ratingCount: true,
          experience: { select: { city: { select: { slug: true } } } },
          tourCopy: { select: { failureReasons: true } },
        },
      });
      return rows
        .filter((row) => evaluateTourCopyEligibility(row).eligible && row.description !== null && row.experience !== null)
        .map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description as string,
          durationMin: row.durationMin,
          inclusions: row.inclusions,
          exclusions: row.exclusions,
          citySlug: row.experience!.city.slug,
          failureReasons: row.tourCopy?.failureReasons ?? [],
        }));
    },
  };
}

const USAGE = "Usage: tour-copy-golden:snapshot [--execute]";

export async function main(argv: readonly string[], _env: NodeJS.ProcessEnv, io: CliIo, deps: SnapshotCliDeps = {}): Promise<number> {
  const unknown = argv.filter((arg) => arg !== "--execute");
  if (unknown.length > 0) {
    io.err(`Unknown argument "${unknown[0]}".\n${USAGE}`);
    return 1;
  }
  const execute = argv.includes("--execute");
  const exists = deps.fileExists ?? existsSync;

  if (execute && exists(GOLDEN_TOURS_FILE)) {
    io.err(`${GOLDEN_TOURS_FILE} already exists. It holds reviewed work, so this command will not overwrite it. Move it aside first if you mean to start again.`);
    return 1;
  }

  const prisma = deps.store === undefined ? new PrismaService() : undefined;
  const store = deps.store ?? createPrismaSnapshotStore(prisma!);
  const disconnect = deps.disconnect ?? (prisma !== undefined ? () => prisma.$disconnect() : undefined);
  try {
    const candidates = await store.loadCandidates();
    let tours: GoldenTourSource[];
    try {
      tours = selectGoldenTours(candidates);
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    const problems = validateSnapshotShape(tours);
    if (problems.length > 0) {
      io.err(`The selection is not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      return 1;
    }

    const counts = new Map<string, number>();
    for (const tour of tours) counts.set(tour.stratum, (counts.get(tour.stratum) ?? 0) + 1);
    io.out(`${candidates.length} candidate tours, ${tours.length} selected:`);
    for (const [stratum, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) io.out(`  ${stratum}: ${count}`);

    if (!execute) {
      io.out(`Dry run: nothing written. Add --execute to write ${GOLDEN_TOURS_FILE}.`);
      if (exists(GOLDEN_TOURS_FILE)) io.out("  That file already exists, so --execute would refuse.");
      return 0;
    }
    (deps.writeFile ?? ((file, content) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, content, "utf8"))))(
      GOLDEN_TOURS_FILE,
      `${JSON.stringify(tours, null, 2)}\n`,
    );
    io.out(`Wrote ${tours.length} tours to ${GOLDEN_TOURS_FILE}, with no reference paragraphs.`);
    io.out("Next: review the tours, run tour-copy-golden:run --freeze-references --execute for draft references, and write the 30 seeded paragraphs.");
    return 0;
  } finally {
    await disconnect?.();
  }
}

if (require.main === module) {
  // BRI-210: long-running batch job (paid model calls), so ride out transient DB drops.
  setDbRetryProfile("import");
  main(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
