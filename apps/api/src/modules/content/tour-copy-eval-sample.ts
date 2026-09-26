import type { PrismaService } from "../../prisma/prisma.service";
import { EVAL_CITY_FLOOR, EVAL_FIRST_ROWS_FULL } from "./tour-copy-eval.constants";
import type { PromptModelPair } from "./tour-copy-eval-stats";
import { buildJudgeUserMessage, getJudgeRubric } from "./tour-copy-judge-rubric";
import { isServedCopy } from "./tour-copy-served";

/**
 * Which paragraphs `tour-copy-eval:run` judges (BRI-201 / spec 0003, AC-7).
 * {@link planEvalSample} is pure: rows in, an ordered plan out, with an
 * injected random source so tests are deterministic. {@link loadEvalInputs}
 * is the one database read that feeds it.
 */

/** One currently served paragraph, as the planner sees it. */
export interface ServedRow {
  tourId: string;
  promptVersion: number;
  model: string;
  cityId: string;
  cityLabel: string;
  /** Has a judge verdict for this exact copy at the current rubric version. */
  judged: boolean;
  /** Rubric prompt plus user message characters, for the dry run's token estimate. */
  promptChars: number;
}

export interface CityPlan {
  cityId: string;
  cityLabel: string;
  served: number;
  /** Served rows in the city that already have a verdict. */
  judged: number;
  /** Rows this run will judge in the city (stage 1 and top up together, after the cap). */
  toJudge: number;
}

export interface PairPlan {
  pair: PromptModelPair;
  /** The pair's stored model is the judge model, so it is skipped whole (AC-7). */
  sameModel: boolean;
  served: number;
  alreadyJudged: number;
  stage1: ServedRow[];
  topUp: ServedRow[];
  cities: CityPlan[];
}

export interface EvalPlan {
  pairs: PairPlan[];
  /** Stage 1 of every pair first, then the top ups, in pair order. */
  queue: ServedRow[];
  /** True when the cap dropped rows that would otherwise have been judged. */
  truncated: boolean;
}

/** Deterministic random source in [0, 1). mulberry32. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

const byTourId = (a: ServedRow, b: ServedRow): number => (a.tourId < b.tourId ? -1 : a.tourId > b.tourId ? 1 : 0);

export function comparePairs(a: PromptModelPair, b: PromptModelPair): number {
  if (a.promptVersion !== b.promptVersion) return b.promptVersion - a.promptVersion;
  return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
}

export interface PlanOptions {
  judgeModel: string;
  /** `min(--limit, TOUR_COPY_EVAL_MAX_JUDGMENTS)`. */
  cap: number;
  random: () => number;
}

/**
 * `pairs` is every `(promptVersion, model)` pair the run covers (the distinct
 * pairs of published rows, already narrowed by the flags). `rows` is every
 * currently served row of those pairs.
 */
export function planEvalSample(pairs: PromptModelPair[], rows: ServedRow[], options: PlanOptions): EvalPlan {
  const pairPlans: PairPlan[] = [];
  let dropped = false;

  for (const pair of [...pairs].sort(comparePairs)) {
    const pairRows = rows
      .filter((row) => row.promptVersion === pair.promptVersion && row.model === pair.model)
      .sort(byTourId);
    const sameModel = pair.model === options.judgeModel;

    // Stage 1 (AC-7): the lowest Tour.id rows, judged or not. Only the unjudged ones are sent.
    const firstRows = sameModel ? [] : pairRows.slice(0, EVAL_FIRST_ROWS_FULL);
    const stage1 = firstRows.filter((row) => !row.judged);
    const stage1Ids = new Set(stage1.map((row) => row.tourId));

    // Top up: every city reaches min(floor, served rows in the city) judged rows, round robin in city id order.
    const cityIds = [...new Set(pairRows.map((row) => row.cityId))].sort();
    const need = new Map<string, number>();
    const pools = new Map<string, ServedRow[]>();
    for (const cityId of cityIds) {
      const cityRows = pairRows.filter((row) => row.cityId === cityId);
      const judgedNow = cityRows.filter((row) => row.judged || stage1Ids.has(row.tourId)).length;
      need.set(cityId, Math.max(0, Math.min(EVAL_CITY_FLOOR, cityRows.length) - judgedNow));
      pools.set(
        cityId,
        shuffle(cityRows.filter((row) => !row.judged && !stage1Ids.has(row.tourId)), options.random),
      );
    }
    const topUp: ServedRow[] = [];
    if (!sameModel) {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const cityId of cityIds) {
          const pool = pools.get(cityId)!;
          if ((need.get(cityId) ?? 0) > 0 && pool.length > 0) {
            topUp.push(pool.pop()!);
            need.set(cityId, need.get(cityId)! - 1);
            progressed = true;
          }
        }
      }
    }

    pairPlans.push({
      pair,
      sameModel,
      served: pairRows.length,
      alreadyJudged: pairRows.filter((row) => row.judged).length,
      stage1,
      topUp,
      cities: cityIds.map((cityId) => {
        const cityRows = pairRows.filter((row) => row.cityId === cityId);
        return { cityId, cityLabel: cityRows[0]!.cityLabel, served: cityRows.length, judged: cityRows.filter((row) => row.judged).length, toJudge: 0 };
      }),
    });
  }

  // The cap: stage 1 of every pair first, then the top ups (AC-7).
  let remaining = options.cap;
  for (const plan of pairPlans) {
    if (plan.stage1.length > remaining) dropped = true;
    plan.stage1 = plan.stage1.slice(0, remaining);
    remaining -= plan.stage1.length;
  }
  for (const plan of pairPlans) {
    if (plan.topUp.length > remaining) dropped = true;
    plan.topUp = plan.topUp.slice(0, remaining);
    remaining -= plan.topUp.length;
  }

  for (const plan of pairPlans) {
    for (const row of [...plan.stage1, ...plan.topUp]) {
      plan.cities.find((city) => city.cityId === row.cityId)!.toJudge++;
    }
  }

  return {
    pairs: pairPlans,
    queue: [...pairPlans.flatMap((plan) => plan.stage1), ...pairPlans.flatMap((plan) => plan.topUp)],
    truncated: dropped,
  };
}

export interface EvalInputs {
  pairs: PromptModelPair[];
  rows: ServedRow[];
}

/** Narrowing flags of `tour-copy-eval:run`. */
export interface PairFilter {
  promptVersion?: number;
  model?: string;
}

/**
 * Read the published pairs and every currently served row of them, with the
 * city and whether each already has a verdict at `rubricVersion`. Paged by
 * cursor like the generation CLI.
 */
export async function loadEvalInputs(
  prisma: PrismaService,
  filter: PairFilter,
  rubricVersion: number,
): Promise<EvalInputs> {
  const pairWhere = {
    status: "published" as const,
    ...(filter.promptVersion !== undefined ? { promptVersion: filter.promptVersion } : {}),
    ...(filter.model !== undefined ? { model: filter.model } : {}),
  };

  const groups = await prisma.tourCopy.groupBy({ by: ["promptVersion", "model"], where: pairWhere });
  const pairs = groups.map((group) => ({ promptVersion: group.promptVersion, model: group.model }));

  const systemChars = getJudgeRubric("tour_copy").systemPrompt.length;
  const rows: ServedRow[] = [];
  const PAGE_SIZE = 500;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.tourCopy.findMany({
      where: pairWhere,
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        aiSummary: true,
        groundingHash: true,
        promptVersion: true,
        model: true,
        generatedAt: true,
        evals: { where: { evaluator: "judge", rubricVersion }, select: { copyGeneratedAt: true } },
        tour: {
          select: {
            id: true,
            title: true,
            description: true,
            durationMin: true,
            inclusions: true,
            exclusions: true,
            ratingAvg: true,
            ratingCount: true,
            deletedAt: true,
            experience: { select: { status: true, city: { select: { id: true, slug: true } } } },
          },
        },
      },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    for (const copy of page) {
      const tour = copy.tour;
      if (!isServedCopy(tour, copy) || !tour.experience) continue;
      rows.push({
        tourId: tour.id,
        promptVersion: copy.promptVersion,
        model: copy.model,
        cityId: tour.experience.city.id,
        cityLabel: tour.experience.city.slug,
        judged: copy.evals.some((verdict) => verdict.copyGeneratedAt.getTime() === copy.generatedAt.getTime()),
        promptChars: systemChars + buildJudgeUserMessage(tour, copy.aiSummary as string).length,
      });
    }
  }

  return { pairs, rows };
}
