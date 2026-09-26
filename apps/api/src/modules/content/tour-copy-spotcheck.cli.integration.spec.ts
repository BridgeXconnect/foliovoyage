import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { getJudgeRubric } from "./tour-copy-judge-rubric";
import { createPrismaSpotcheckStore } from "./tour-copy-spotcheck.cli";

/**
 * Integration tests for the spot check's real store against **Postgres**
 * (BRI-201 / spec 0003, AC-8, AC-13): the pool splits judged from unjudged
 * rows and leaves out rows a human already answered, a saved answer is a
 * human `TourCopyEval` row at the current rubric version, and the report
 * pairs it with the judge's verdict. No model call is made.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);
const store = createPrismaSpotcheckStore(prisma as unknown as PrismaService);

const PROVIDER = "tour-copy-spotcheck-test";
const COUNTRY_SLUG = "tour-copy-spotcheck-land";
const PAIR = { promptVersion: 992, model: "spotcheck-test-model" };
const RUBRIC_VERSION = getJudgeRubric("tour_copy").version;
const DESCRIPTION = "A calm boat ride through the old town canals with a local guide.";

let cityId = "";

interface Seeded {
  tourId: string;
  copyId: string;
  generatedAt: Date;
}

async function seed(providerTourId: string, options: { hashMoved?: boolean } = {}): Promise<Seeded> {
  const experience = await prisma.experience.create({
    data: {
      title: `Experience ${providerTourId}`,
      description: "An experience.",
      status: "published",
      latitude: 1,
      longitude: 1,
      cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: providerTourId,
    },
    select: { id: true },
  });
  const title = `Tour ${providerTourId}`;
  const tour = await prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId,
      title,
      description: DESCRIPTION,
      durationMin: 120,
      inclusions: [] as never,
      exclusions: [] as never,
      ratingAvg: 4.5,
      ratingCount: 20,
      experienceId: experience.id,
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
  const generatedAt = new Date();
  const copy = await prisma.tourCopy.create({
    data: {
      tourId: tour.id,
      status: "published",
      aiSummary: `Paragraph ${providerTourId}.`,
      groundingHash: options.hashMoved
        ? "v1:stale"
        : computeGroundingHash({ title, description: DESCRIPTION, durationMin: 120, inclusions: [], exclusions: [] }),
      model: PAIR.model,
      promptVersion: PAIR.promptVersion,
      generatedAt,
      attempts: 1,
      failureReasons: [],
      runId: "seed_run",
    },
    select: { id: true },
  });
  return { tourId: tour.id, copyId: copy.id, generatedAt };
}

async function judgeVerdict(row: Seeded, verdict: "clean" | "unsupported" | "contradicted"): Promise<void> {
  await prisma.tourCopyEval.create({
    data: {
      tourCopyId: row.copyId,
      copyGeneratedAt: row.generatedAt,
      judgedText: "x",
      promptVersion: PAIR.promptVersion,
      model: PAIR.model,
      groundingHash: "h",
      evaluator: "judge",
      evaluatorModel: "claude-opus-5-5",
      rubricVersion: RUBRIC_VERSION,
      claims: [],
      claimVerdict: verdict,
      leadsWithFact: true,
      evalRunId: "eval_run",
    },
  });
}

async function cleanup(): Promise<void> {
  await prisma.tourCopy.deleteMany({ where: { tour: { provider: PROVIDER } } });
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY_SLUG } });
}

beforeEach(async () => {
  await cleanup();
  cityId = (
    await prisma.city.create({
      data: {
        slug: "spotcheck-city",
        countrySlug: COUNTRY_SLUG,
        name: "Spotcheck City",
        country: "Spotcheckland",
        heroImageUrl: "https://example.test/hero.jpg",
        heroImageAlt: "hero",
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("tour-copy-spotcheck store (integration, spec 0003 AC-13)", () => {
  it("splits the pool into judged and unjudged rows and leaves out rows a human answered", async () => {
    const judged = await seed("P1");
    const unjudged = await seed("P2");
    const answered = await seed("P3");
    await judgeVerdict(judged, "clean");
    await store.saveHuman(
      { tourCopyId: answered.copyId, tourId: answered.tourId, copyGeneratedAt: answered.generatedAt, paragraph: "x", source: {} as never },
      PAIR,
      { claimVerdict: "clean", note: null, leadsWithFact: true },
      RUBRIC_VERSION,
      "spot-run",
    );

    const pool = await store.pool(PAIR, RUBRIC_VERSION);

    expect(pool.judged).toEqual([judged.copyId]);
    expect(pool.unjudged).toEqual([unjudged.copyId]);
    expect(pool.answered).toBe(1);
  });

  it("loads a served row with its five source fields and refuses one whose hash moved on", async () => {
    const good = await seed("L1");
    const stale = await seed("L2", { hashMoved: true });

    const loaded = await store.loadRow(good.copyId);
    expect(loaded).toMatchObject({ tourId: good.tourId, paragraph: "Paragraph L1." });
    expect(loaded!.source).toMatchObject({ title: "Tour L1", durationMin: 120 });
    expect(await store.loadRow(stale.copyId)).toBeNull();
  });

  it("stores a good answer as a clean human row with no claims and the current rubric version", async () => {
    const row = await seed("G1");

    const result = await store.saveHuman(
      { tourCopyId: row.copyId, tourId: row.tourId, copyGeneratedAt: row.generatedAt, paragraph: "Paragraph G1.", source: {} as never },
      PAIR,
      { claimVerdict: "clean", note: null, leadsWithFact: false },
      RUBRIC_VERSION,
      "spot-run",
    );

    expect(result).toBe("saved");
    const stored = await prisma.tourCopyEval.findFirstOrThrow({ where: { tourCopyId: row.copyId } });
    expect(stored).toMatchObject({
      evaluator: "human",
      evaluatorModel: null,
      rubricVersion: RUBRIC_VERSION,
      claimVerdict: "clean",
      leadsWithFact: false,
      claims: [],
      evalRunId: "spot-run",
    });
  });

  it("stores a bad answer with one claim holding the note, and reports a second answer as a duplicate", async () => {
    const row = await seed("B1");
    const args = [
      { tourCopyId: row.copyId, tourId: row.tourId, copyGeneratedAt: row.generatedAt, paragraph: "Paragraph B1.", source: {} as never },
      PAIR,
      { claimVerdict: "unsupported" as const, note: "invented a price", leadsWithFact: true },
      RUBRIC_VERSION,
      "spot-run",
    ] as const;

    expect(await store.saveHuman(...args)).toBe("saved");
    expect(await store.saveHuman(...args)).toBe("duplicate");

    const stored = await prisma.tourCopyEval.findFirstOrThrow({ where: { tourCopyId: row.copyId } });
    expect(stored.claims).toEqual([{ text: "invented a price", verdict: "unsupported", evidenceQuote: "" }]);
  });

  it("reports human rows next to the judge's verdict on the same copy", async () => {
    const both = await seed("R1");
    const humanOnly = await seed("R2");
    await judgeVerdict(both, "clean");
    const human = (row: Seeded, claimVerdict: "clean" | "unsupported") =>
      store.saveHuman(
        { tourCopyId: row.copyId, tourId: row.tourId, copyGeneratedAt: row.generatedAt, paragraph: "x", source: {} as never },
        PAIR,
        { claimVerdict, note: claimVerdict === "clean" ? null : "wrong", leadsWithFact: true },
        RUBRIC_VERSION,
        "spot-run",
      );
    await human(both, "unsupported");
    await human(humanOnly, "clean");

    const rows = await store.reportRows(PAIR, RUBRIC_VERSION);
    const byTour = new Map(rows.map((r) => [r.tourId, r]));

    expect(rows).toHaveLength(2);
    expect(byTour.get(both.tourId)).toMatchObject({ judge: "clean", human: { claimVerdict: "unsupported", note: "wrong" } });
    expect(byTour.get(humanOnly.tourId)).toMatchObject({ judge: null, human: { claimVerdict: "clean", note: null } });
  });
});
