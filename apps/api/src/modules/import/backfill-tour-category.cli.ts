import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import { CATEGORY_ROOTS_PRIORITY, derivePrimaryCategory, unresolvedTagIds } from "./category-rule";
import { CURATED_CITIES } from "./curated-cities";
import { AllowlistFetch } from "./http/allowlist-fetch";
import { cityForTour } from "./position";
import { PrismaTagVocabularyCache, TagResolver, type TagVocabulary } from "./tag-resolver";

/**
 * `backfill-tour-category:run [--execute] [--city SLUG]` (BRI-224). Derives
 * `Tour.primaryCategoryTagId` for every existing row from its `tags`, using
 * the exact same pure rule (`category-rule.ts`'s `derivePrimaryCategory`) and
 * vocabulary source (`TagResolver.getVocabulary()`) the live ingest pipeline
 * uses via `CategoryResolver`, so a backfilled row and a freshly-ingested row
 * are computed identically.
 *
 * Every row upserted before this ticket's ingest wiring landed has
 * `primaryCategoryTagId: null` even when it carries tags a category can be
 * derived from — this CLI closes that gap once, for the existing catalogue.
 *
 * **Dry run unless `--execute` is given.** `--city SLUG` restricts the run to
 * one curated city (matched the same way `ExperienceLinker` does, via
 * `cityForTour`).
 *
 * An unresolved tag id (present on a tour but absent from the vocabulary) is
 * reported in the summary, never silently dropped — same acceptance
 * criterion `CategoryResolver` enforces during ingest.
 *
 * Writes are guarded on the old value (`updateMany … WHERE primaryCategoryTagId
 * = old`), so a concurrent change is left alone; re-running is idempotent.
 *
 * Usage (from the repo root, against `dev` only — always via Doppler):
 *
 *   doppler run --config dev -- pnpm --filter @folio/api backfill-tour-category:run [--execute] [--city bangkok]
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CategoryTourRow {
  id: string;
  tags: number[];
  primaryCategoryTagId: number | null;
  destinationRefs: string[];
}

export interface CategoryBackfillStore {
  /** Every non-deleted tour. */
  tours(): Promise<CategoryTourRow[]>;
  /** Guarded write: returns rows changed (0 when the old value no longer matches). */
  updateCategory(id: string, from: number | null, to: number | null): Promise<number>;
}

export interface TagVocabularySource {
  getVocabulary(): Promise<TagVocabulary>;
}

export interface BackfillDeps {
  store?: CategoryBackfillStore;
  vocabulary?: TagVocabularySource;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  execute: boolean;
  city: string | null;
}

const USAGE = "Usage: backfill-tour-category:run [--execute] [--city SLUG]";

/** Same ceiling other backfill CLIs use: an unthrottled batch exhausts the Prisma pool. */
const WRITE_CONCURRENCY = 8;
const PAGE_SIZE = 5000;

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = { execute: false, city: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") {
      parsed.execute = true;
    } else if (arg === "--city") {
      const raw = argv[++i];
      if (!raw || !CURATED_CITIES.some((c) => c.slug === raw)) {
        const known = CURATED_CITIES.map((c) => c.slug).join(", ");
        return { error: `--city needs one of: ${known}. Got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      parsed.city = raw;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  return parsed;
}

export function createPrismaCategoryBackfillStore(prisma: PrismaService): CategoryBackfillStore {
  return {
    tours: async () => {
      const out: CategoryTourRow[] = [];
      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.tour.findMany({
          where: { deletedAt: null },
          select: { id: true, tags: true, primaryCategoryTagId: true, destinationRefs: true },
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) return out;
        out.push(...rows);
        cursor = rows[rows.length - 1].id;
      }
    },
    updateCategory: async (id, from, to) =>
      (
        await prisma.tour.updateMany({
          where: { id, primaryCategoryTagId: from },
          data: { primaryCategoryTagId: to },
        })
      ).count,
  };
}

function vocabularyFromEnv(env: NodeJS.ProcessEnv, prisma: PrismaService): TagVocabularySource | string {
  const apiKey = env.VIATOR_API_KEY;
  if (!apiKey) return "VIATOR_API_KEY is required (run via Doppler).";
  const baseUrl = env.VIATOR_API_BASE_URL ?? "https://api.viator.com/partner";
  return new TagResolver(
    { baseUrl, apiKey, language: env.VIATOR_API_LANGUAGE ?? "en-US" },
    new AllowlistFetch([new URL(baseUrl).host]),
    new PrismaTagVocabularyCache(prisma),
  );
}

async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: BackfillDeps = {},
): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.err(args.error);
    return 1;
  }

  const prisma = deps.store === undefined || deps.vocabulary === undefined ? new PrismaService() : undefined;
  const store: CategoryBackfillStore = deps.store ?? createPrismaCategoryBackfillStore(prisma!);
  const disconnect = deps.disconnect ?? (prisma ? () => prisma.$disconnect() : undefined);

  try {
    const vocabularySource = deps.vocabulary ?? vocabularyFromEnv(env, prisma!);
    if (typeof vocabularySource === "string") {
      io.err(vocabularySource);
      return 1;
    }

    io.out(
      `backfill-tour-category (${args.execute ? "EXECUTE, this will change rows" : "dry run, nothing is changed"})`,
    );

    const vocabulary = await vocabularySource.getVocabulary();
    const allTours = await store.tours();
    const tours = args.city
      ? allTours.filter((t) => cityForTour(t.destinationRefs)?.slug === args.city)
      : allTours;
    if (args.city) io.out(`  Restricted to ${args.city}: ${tours.length} of ${allTours.length} tour(s).`);

    const unresolved = new Set<number>();
    const plans = tours.map((tour) => {
      for (const id of unresolvedTagIds(tour.tags, vocabulary.graph)) unresolved.add(id);
      return { tour, newCategory: derivePrimaryCategory(tour.tags, vocabulary.graph) };
    });
    const changed = plans.filter((p) => p.newCategory !== p.tour.primaryCategoryTagId);

    report(plans, changed.length, vocabulary, unresolved, io);

    if (!args.execute) {
      io.out(`\nDry run: would update ${changed.length} row(s). Run again with --execute to do it.`);
      return 0;
    }

    let updated = 0;
    let skippedRaced = 0;
    await inBatches(changed, WRITE_CONCURRENCY, async (p) => {
      const n = await store.updateCategory(p.tour.id, p.tour.primaryCategoryTagId, p.newCategory);
      if (n === 0) skippedRaced += 1;
      else updated += n;
    });
    io.out(
      `\nUpdated ${updated} Tour row(s)${skippedRaced > 0 ? `; ${skippedRaced} skipped because the row changed underneath us` : ""}.`,
    );
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  } finally {
    await disconnect?.();
  }
}

function report(
  plans: readonly { tour: CategoryTourRow; newCategory: number | null }[],
  changedCount: number,
  vocabulary: TagVocabulary,
  unresolved: ReadonlySet<number>,
  io: CliIo,
): void {
  io.out("\nCategory distribution (after this run's derivation):");
  for (const root of CATEGORY_ROOTS_PRIORITY) {
    const count = plans.filter((p) => p.newCategory === root).length;
    const name = vocabulary.names.get(root) ?? "(unknown name)";
    io.out(`  ${String(root).padEnd(6)} ${name.padEnd(36)} ${String(count).padStart(6)}`);
  }
  const nullCount = plans.filter((p) => p.newCategory === null).length;
  io.out(`  ${"(null)".padEnd(6)} ${"no category root reachable".padEnd(36)} ${String(nullCount).padStart(6)}`);

  io.out(
    `\nTours scanned: ${plans.length}; would change ${changedCount} (${pct(changedCount, plans.length)}), ` +
      `already correct ${plans.length - changedCount}.`,
  );

  const ids = [...unresolved].sort((a, b) => a - b);
  io.out(
    ids.length > 0
      ? `\nUnresolved tag id(s) not in the Viator vocabulary (never silently dropped): ${ids.join(", ")}`
      : "\nEvery tag id referenced by a scanned tour is present in the vocabulary.",
  );
}

if (require.main === module) {
  // BRI-210: long-running batch job, so ride out transient DB drops.
  setDbRetryProfile("import");
  main(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    },
  );
}
