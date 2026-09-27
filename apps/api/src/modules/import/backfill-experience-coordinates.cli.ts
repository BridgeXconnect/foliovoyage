import { PrismaService } from "../../prisma/prisma.service";
import { AllowlistFetch } from "./http/allowlist-fetch";
import { CURATED_CITIES, CURATED_REFS } from "./curated-cities";
import {
  extractLocationCandidates,
  type LocationCandidate,
} from "./location-candidates";
import {
  LocationResolver,
  type LocationCache,
  type ResolvedLocation,
} from "./location-resolver";
import { PrismaLocationCache } from "./location-cache.prisma";
import {
  anchorFor,
  cityForTour,
  distanceKm,
  pickCandidatePosition,
  REAL_BASES,
  resolveExperiencePosition,
  subRegionForTour,
  type LatLng,
  type PositionBasis,
} from "./position";
import {
  R2RawArchiveReader,
  type RawArchiveReader,
} from "./storage/raw-archive.reader";

/**
 * `backfill-experience-coordinates:run [--execute] [--dates D1,D2] [--max-pages N]
 * [--sample N] [--concurrency N]` (BRI-218). Re-resolves the position of every
 * active curated Viator tour with the priority-ordered resolution
 * (`location-candidates.ts` → `position.ts`) and updates `Tour.latitude/longitude`
 * and the linked `Experience.latitude/longitude` to match. **Dry run unless
 * `--execute` is given**: a dry run reads the DB, R2 and Viator's
 * `/locations/bulk` but writes nothing, not even the `ProviderLocation` cache.
 *
 * Why a backfill at all: `ExperienceLinker` sets Experience coordinates only at
 * creation, and the nightly upsert only rewrites tours Viator reports as
 * modified, so existing rows would otherwise keep their old coordinates.
 *
 * Why R2: `Tour` rows keep only one `location_ref`; the itinerary and pickup
 * refs live in the raw payloads Atlas already archived (newest crawl wins per
 * product). `/products/bulk` is not used (docs/13: not for ingestion).
 *
 * Safety:
 * - A tour with no archived payload keeps its current pair (reported, not guessed).
 * - An Experience whose coordinates are neither the tour's old pair, nor its
 *   sub-region centre, nor the city centroid was set by hand and is skipped.
 * - Writes are guarded on the old value (`updateMany … WHERE lat = old`), so a
 *   concurrent change is left alone; re-running is idempotent.
 *
 * Exit codes: 0 ok, 1 bad arguments or failure.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CityRow {
  viatorDestRef: string;
  slug: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

export interface TourRow {
  id: string;
  providerTourId: string;
  destinationRefs: string[];
  latitude: number | null;
  longitude: number | null;
  experience: { id: string; latitude: number; longitude: number } | null;
}

export interface BackfillStore {
  cities(): Promise<CityRow[]>;
  /** Every active (not soft-deleted) curated Viator tour. */
  activeTours(): Promise<TourRow[]>;
  /** Guarded write: returns rows changed (0 when the old value no longer matches). */
  updateTour(id: string, from: LatLng | null, to: LatLng | null): Promise<number>;
  updateExperience(id: string, from: LatLng, to: LatLng): Promise<number>;
}

export interface PositionResolver {
  resolve(references: string[]): Promise<Map<string, ResolvedLocation>>;
}

export interface BackfillDeps {
  store?: BackfillStore;
  reader?: RawArchiveReader;
  resolver?: PositionResolver;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  execute: boolean;
  dates: string[] | null;
  maxPages: number | null;
  sample: number;
  concurrency: number;
  /** Curated-city slug: only that city's tours are scanned, planned and written. */
  city: string | null;
}

const USAGE =
  "Usage: backfill-experience-coordinates:run [--execute] [--dates YYYY-MM-DD,…] " +
  "[--max-pages N] [--sample N] [--concurrency N] [--city SLUG]";

/** Same ceiling as backfill-reference-price: a full unthrottled batch exhausted the Prisma pool. */
const WRITE_CONCURRENCY = 8;
const RESOLVE_CHUNK = 5000;
const SOURCE = "viator";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = {
    execute: false,
    dates: null,
    maxPages: null,
    sample: 3,
    concurrency: 3,
    city: null,
  };
  const positiveInt = (flag: string, raw: string | undefined): number | string => {
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(value) && value >= 1
      ? value
      : `${flag} needs a positive integer, got ${raw ?? "(nothing)"}.\n${USAGE}`;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--dates") {
      const raw = argv[++i];
      const dates = raw?.split(",").filter(Boolean) ?? [];
      if (dates.length === 0 || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
        return { error: `--dates needs YYYY-MM-DD[,YYYY-MM-DD…], got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      parsed.dates = dates;
    } else if (arg === "--city") {
      const raw = argv[++i];
      if (!raw || !CURATED_CITIES.some((c) => c.slug === raw)) {
        const known = CURATED_CITIES.map((c) => c.slug).join(", ");
        return { error: `--city needs one of: ${known}. Got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      parsed.city = raw;
    } else if (arg === "--max-pages" || arg === "--sample" || arg === "--concurrency") {
      const value = positiveInt(arg, argv[++i]);
      if (typeof value === "string") return { error: value };
      if (arg === "--max-pages") parsed.maxPages = value;
      else if (arg === "--sample") parsed.sample = value;
      else parsed.concurrency = value;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  return parsed;
}

// --- Prisma-backed store ----------------------------------------------------

export function createPrismaBackfillStore(prisma: PrismaService): BackfillStore {
  return {
    cities: () =>
      prisma.city
        .findMany({
          where: { viatorDestRef: { not: null } },
          select: { viatorDestRef: true, slug: true, centroidLat: true, centroidLng: true },
        })
        .then((rows) =>
          rows.map((r) => ({ ...r, viatorDestRef: r.viatorDestRef as string })),
        ),
    activeTours: async () => {
      const out: TourRow[] = [];
      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.tour.findMany({
          where: {
            provider: SOURCE,
            deletedAt: null,
            destinationRefs: { hasSome: [...CURATED_REFS] },
          },
          select: {
            id: true,
            providerTourId: true,
            destinationRefs: true,
            latitude: true,
            longitude: true,
            experience: { select: { id: true, latitude: true, longitude: true } },
          },
          orderBy: { id: "asc" },
          take: 5000,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) return out;
        out.push(...rows);
        cursor = rows[rows.length - 1].id;
      }
    },
    updateTour: async (id, from, to) =>
      (
        await prisma.tour.updateMany({
          where: {
            id,
            latitude: from?.latitude ?? null,
            longitude: from?.longitude ?? null,
          },
          data: { latitude: to?.latitude ?? null, longitude: to?.longitude ?? null },
        })
      ).count,
    updateExperience: async (id, from, to) =>
      (
        await prisma.experience.updateMany({
          where: { id, latitude: from.latitude, longitude: from.longitude },
          data: { latitude: to.latitude, longitude: to.longitude },
        })
      ).count,
  };
}

/**
 * Wraps the persistent cache so a dry run can read it but never write it:
 * fresh `/locations/bulk` results live in memory only.
 */
export class ReadOnlyOverlayCache implements LocationCache {
  private readonly overlay = new Map<string, ResolvedLocation>();
  constructor(private readonly inner: LocationCache) {}

  async getMany(references: string[]): Promise<Map<string, ResolvedLocation>> {
    const hits = await this.inner.getMany(references);
    for (const ref of references) {
      const loc = this.overlay.get(ref);
      if (loc) hits.set(ref, loc);
    }
    return hits;
  }

  putMany(locations: ResolvedLocation[]): Promise<void> {
    for (const loc of locations) this.overlay.set(loc.reference, loc);
    return Promise.resolve();
  }
}

// --- planning ---------------------------------------------------------------

type Before = "real" | "subregion" | "city";

interface TourPlan {
  tour: TourRow;
  citySlug: string;
  hadPayload: boolean;
  /** Pair the Tour row should hold after the run (`null` = none). */
  tourTo: LatLng | null;
  tourChanged: boolean;
  /** Basis of the position the linked Experience should hold. */
  basis: PositionBasis | null;
  experienceTo: LatLng | null;
  experienceAction: "update" | "unchanged" | "skip-manual" | "none";
  before: Before | null;
}

const same = (a: LatLng | null, b: LatLng | null): boolean =>
  a === null || b === null
    ? a === b
    : a.latitude === b.latitude && a.longitude === b.longitude;

const pairOf = (lat: number | null, lng: number | null): LatLng | null =>
  lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null;

/** Build the per-tour plan. Pure: no I/O. */
export function planTour(input: {
  tour: TourRow;
  cityBySlug: ReadonlyMap<string, CityRow>;
  candidates: readonly LocationCandidate[] | undefined;
  resolved: ReadonlyMap<string, LatLng>;
}): TourPlan | null {
  const { tour, candidates, resolved } = input;
  const curated = cityForTour(tour.destinationRefs);
  if (!curated) return null;
  const cityRow = input.cityBySlug.get(curated.slug);
  const centroid = cityRow ? pairOf(cityRow.centroidLat, cityRow.centroidLng) : null;
  const city = { curated, centroid };

  const oldPair = pairOf(tour.latitude, tour.longitude);
  const hadPayload = candidates !== undefined;
  const picked = hadPayload
    ? pickCandidatePosition(candidates, resolved, anchorFor(city, tour.destinationRefs))
    : null;
  const tourTo = hadPayload ? (picked ? { latitude: picked.latitude, longitude: picked.longitude } : null) : oldPair;

  const position = resolveExperiencePosition({
    tourLatitude: tourTo?.latitude ?? null,
    tourLongitude: tourTo?.longitude ?? null,
    city,
    destinationRefs: tour.destinationRefs,
  });
  const sub = subRegionForTour(curated, tour.destinationRefs);

  const plan: TourPlan = {
    tour,
    citySlug: curated.slug,
    hadPayload,
    tourTo,
    tourChanged: !same(oldPair, tourTo),
    basis: position?.basis === "tour" ? (picked?.basis ?? "tour") : (position?.basis ?? null),
    experienceTo: position ? { latitude: position.latitude, longitude: position.longitude } : null,
    experienceAction: "none",
    before: null,
  };

  const exp = tour.experience;
  if (exp) {
    const current = { latitude: exp.latitude, longitude: exp.longitude };
    plan.before = same(current, centroid)
      ? "city"
      : sub && same(current, sub)
        ? "subregion"
        : "real";
    if (!plan.experienceTo || same(current, plan.experienceTo)) {
      plan.experienceAction = "unchanged";
    } else if (
      // Auto-derived values only: the old tour pair, the city centroid, or this
      // tour's sub-region centre. Anything else was set by hand.
      same(current, oldPair) ||
      same(current, centroid) ||
      (sub !== null && same(current, sub))
    ) {
      plan.experienceAction = "update";
    } else {
      plan.experienceAction = "skip-manual";
    }
  }
  return plan;
}

// --- archive scan -----------------------------------------------------------

async function scanArchive(
  reader: RawArchiveReader,
  wanted: ReadonlySet<string>,
  args: ParsedArgs,
  io: CliIo,
): Promise<Map<string, LocationCandidate[]>> {
  let keys = await reader.listPageKeys(SOURCE);
  if (args.dates) {
    const dates = new Set(args.dates);
    keys = keys.filter((k) => dates.has(k.split("/")[2]));
  }
  if (args.maxPages !== null) keys = keys.slice(0, args.maxPages);
  io.out(`  Scanning ${keys.length} archived page(s), ${args.concurrency} at a time…`);

  // Lowest key index (= newest crawl) wins, regardless of completion order.
  const found = new Map<string, { index: number; candidates: LocationCandidate[] }>();
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < keys.length && found.size < wanted.size) {
      const index = next++;
      const products = await reader.readPage(keys[index]);
      for (const product of products) {
        const code = product.productCode;
        if (typeof code !== "string" || !wanted.has(code)) continue;
        const existing = found.get(code);
        if (existing && existing.index < index) continue;
        found.set(code, { index, candidates: extractLocationCandidates(product) });
      }
      done += 1;
      if (done % 50 === 0) io.out(`    …${done}/${keys.length} pages, ${found.size}/${wanted.size} tours found`);
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  io.out(`  Found archived payloads for ${found.size} of ${wanted.size} tours (${done} pages read).`);
  return new Map([...found].map(([code, v]) => [code, v.candidates]));
}

// --- main -------------------------------------------------------------------

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

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

  const prisma = deps.store === undefined || deps.resolver === undefined ? new PrismaService() : undefined;
  const store = deps.store ?? createPrismaBackfillStore(prisma!);
  const disconnect = deps.disconnect ?? (prisma ? () => prisma.$disconnect() : undefined);

  try {
    const reader = deps.reader ?? readerFromEnv(env);
    const resolver = deps.resolver ?? resolverFromEnv(env, prisma!, args.execute);
    if (typeof reader === "string") {
      io.err(reader);
      return 1;
    }
    if (typeof resolver === "string") {
      io.err(resolver);
      return 1;
    }

    io.out(`backfill-experience-coordinates (${args.execute ? "EXECUTE, this will change rows" : "dry run, nothing is changed"})`);
    const [cityRows, allTours] = await Promise.all([store.cities(), store.activeTours()]);
    const tours = args.city ? allTours.filter((t) => cityForTour(t.destinationRefs)?.slug === args.city) : allTours;
    if (args.city) io.out(`  Restricted to ${args.city}: ${tours.length} of ${allTours.length} tour(s).`);
    const cityBySlug = new Map(cityRows.map((c) => [c.slug, c]));
    io.out(`  ${tours.length} active curated tour(s), ${tours.filter((t) => t.experience).length} linked to an Experience.`);

    const candidatesByCode = await scanArchive(reader, new Set(tours.map((t) => t.providerTourId)), args, io);

    const refs = [...new Set([...candidatesByCode.values()].flatMap((cs) => cs.map((c) => c.ref)))];
    io.out(`  Resolving ${refs.length} distinct location ref(s)…`);
    const resolved = new Map<string, LatLng>();
    for (let i = 0; i < refs.length; i += RESOLVE_CHUNK) {
      const batch = await resolver.resolve(refs.slice(i, i + RESOLVE_CHUNK));
      for (const [ref, loc] of batch) resolved.set(ref, loc);
    }
    io.out(`  ${resolved.size} of ${refs.length} resolved to coordinates.`);

    const plans: TourPlan[] = [];
    for (const tour of tours) {
      const plan = planTour({ tour, cityBySlug, candidates: candidatesByCode.get(tour.providerTourId), resolved });
      if (plan) plans.push(plan);
    }

    report(plans, cityBySlug, args, io);

    const tourWrites = plans.filter((p) => p.tourChanged);
    const expWrites = plans.filter((p) => p.experienceAction === "update");
    if (!args.execute) {
      io.out(`\nDry run: would update ${tourWrites.length} Tour row(s) and ${expWrites.length} Experience row(s). Run again with --execute to do it.`);
      return 0;
    }

    let toursWritten = 0;
    let expsWritten = 0;
    let skippedRaced = 0;
    await inBatches(plans.filter((p) => p.tourChanged || p.experienceAction === "update"), WRITE_CONCURRENCY, async (p) => {
      const oldPair = pairOf(p.tour.latitude, p.tour.longitude);
      // Tour first, then Experience, so an interrupted run leaves the Experience
      // stale (re-runnable) rather than ahead of its Tour.
      if (p.tourChanged) {
        const n = await store.updateTour(p.tour.id, oldPair, p.tourTo);
        if (n === 0) {
          skippedRaced += 1;
          return;
        }
        toursWritten += n;
      }
      if (p.experienceAction === "update" && p.tour.experience && p.experienceTo) {
        const exp = p.tour.experience;
        // Await first: `x += await f()` reads x before the await, so concurrent writers lose each other's increments.
        const written = await store.updateExperience(exp.id, { latitude: exp.latitude, longitude: exp.longitude }, p.experienceTo);
        expsWritten += written;
      }
    });
    io.out(`\nUpdated ${toursWritten} Tour row(s) and ${expsWritten} Experience row(s)${skippedRaced > 0 ? `; ${skippedRaced} skipped because the row changed underneath us` : ""}.`);
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  } finally {
    await disconnect?.();
  }
}

function readerFromEnv(env: NodeJS.ProcessEnv): RawArchiveReader | string {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return "R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required (run via Doppler).";
  }
  return new R2RawArchiveReader({
    endpoint: R2_ENDPOINT,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
}

function resolverFromEnv(env: NodeJS.ProcessEnv, prisma: PrismaService, execute: boolean): PositionResolver | string {
  const apiKey = env.VIATOR_API_KEY;
  if (!apiKey) return "VIATOR_API_KEY is required (run via Doppler).";
  const baseUrl = env.VIATOR_API_BASE_URL ?? "https://api.viator.com/partner";
  const persistent = new PrismaLocationCache(prisma);
  return new LocationResolver(
    { baseUrl, apiKey, language: env.VIATOR_API_LANGUAGE ?? "en-US" },
    new AllowlistFetch([new URL(baseUrl).host]),
    execute ? persistent : new ReadOnlyOverlayCache(persistent),
  );
}

// --- report -----------------------------------------------------------------

function report(
  plans: readonly TourPlan[],
  cityBySlug: ReadonlyMap<string, CityRow>,
  args: ParsedArgs,
  io: CliIo,
): void {
  const slugs = [...new Set(plans.map((p) => p.citySlug))].sort();
  const linked = plans.filter((p) => p.tour.experience);
  io.out("\nExperience coordinate coverage (real = a resolved place, not a city/sub-region fallback):");
  const line = (label: string, ps: readonly TourPlan[]): void => {
    const exps = ps.filter((p) => p.tour.experience);
    const before = exps.filter((p) => p.before === "real").length;
    const after = exps.filter((p) => afterReal(p)).length;
    io.out(`  ${label.padEnd(8)} ${String(exps.length).padStart(6)} Experiences   real before ${pct(before, exps.length).padStart(6)}  after ${pct(after, exps.length).padStart(6)}`);
  };
  for (const slug of slugs) line(slug, plans.filter((p) => p.citySlug === slug));
  line("ALL", plans);

  const basisCounts = new Map<string, number>();
  for (const p of linked) {
    const key = p.experienceAction === "skip-manual" ? "manual (kept)" : (p.basis ?? "none");
    basisCounts.set(key, (basisCounts.get(key) ?? 0) + 1);
  }
  io.out(`\nAfter, by basis: ${[...basisCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const withPayload = plans.filter((p) => p.hadPayload);
  const bothPairs = withPayload.filter((p) => p.tour.latitude !== null && p.tourTo && p.tourChanged);
  const moved = (km: number): number =>
    bothPairs.filter((p) => distanceKm({ latitude: p.tour.latitude!, longitude: p.tour.longitude! }, p.tourTo!) > km).length;
  const dropped = withPayload.filter((p) => p.tour.latitude !== null && p.tourTo === null).length;
  io.out(
    `\nTours: ${plans.length}; with archived payload ${withPayload.length}, without ${plans.length - withPayload.length} (left as is).` +
      `\n  Tour pair before ${pct(plans.filter((p) => p.tour.latitude !== null).length, plans.length)} → after ${pct(plans.filter((p) => p.tourTo !== null).length, plans.length)}.` +
      `\n  Existing start pairs replaced: ${bothPairs.length} (moved >1 km: ${moved(1)}, >5 km: ${moved(5)}); cleared (no candidate within radius): ${dropped}.` +
      `\n  Experiences: update ${plans.filter((p) => p.experienceAction === "update").length}, unchanged ${plans.filter((p) => p.experienceAction === "unchanged").length}, ` +
      `skipped as manual overrides ${plans.filter((p) => p.experienceAction === "skip-manual").length}.`,
  );

  io.out(`\nSample of updated positions (${args.sample} per city):`);
  for (const slug of slugs) {
    const city = cityBySlug.get(slug);
    const centroid = city ? pairOf(city.centroidLat, city.centroidLng) : null;
    const rows = plans.filter((p) => p.citySlug === slug && p.experienceAction === "update" && p.basis && REAL_BASES.has(p.basis));
    for (const p of rows.slice(0, args.sample)) {
      const to = p.experienceTo!;
      const km = centroid ? distanceKm(centroid, to).toFixed(1) : "?";
      io.out(`  ${slug.padEnd(8)} ${p.tour.providerTourId.padEnd(12)} ${String(p.basis).padEnd(7)} ${to.latitude.toFixed(5)}, ${to.longitude.toFixed(5)}  (${km} km from centroid)`);
    }
  }
}

/** Whether the Experience ends the run on a real place (its plan, or kept as-is). */
function afterReal(p: TourPlan): boolean {
  if (!p.tour.experience) return false;
  if (p.experienceAction === "skip-manual" || p.experienceAction === "none") return p.before === "real";
  if (p.experienceAction === "unchanged") return p.before === "real";
  return p.basis !== null && REAL_BASES.has(p.basis);
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
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    },
  );
}
