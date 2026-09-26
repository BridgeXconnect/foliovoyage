import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { getJudgeRubric } from "./tour-copy-judge-rubric";
import { createPrismaWithdrawStore, main } from "./tour-copy-withdraw.cli";

/**
 * Integration tests for the withdraw CLI's real store against **Postgres**
 * (BRI-201 / spec 0003, AC-10): a manual withdraw writes the CLI's run id, a
 * restore clears `withdrawnAt` and `withdrawnByRunId`, and the restore
 * refusal counts verdicts over both `published` and `withdrawn` rows. No
 * model call is made.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);
const store = createPrismaWithdrawStore(prisma as unknown as PrismaService);

const PROVIDER = "tour-copy-withdraw-test";
const COUNTRY_SLUG = "tour-copy-withdraw-land";
// A pair no real run uses, so the updateMany calls here cannot touch real rows.
const MODEL = "withdraw-test-model";
const PAIR = { promptVersion: 990, model: MODEL };
const RUBRIC_VERSION = getJudgeRubric("tour_copy").version;
const DESCRIPTION = "A calm boat ride through the old town canals with a local guide.";

let cityId = "";

async function seedCopy(providerTourId: string, status: "published" | "withdrawn", verdict?: "clean" | "unsupported"): Promise<string> {
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
      status,
      aiSummary: "A paragraph.",
      groundingHash: computeGroundingHash({ title, description: DESCRIPTION, durationMin: 120, inclusions: [], exclusions: [] }),
      model: PAIR.model,
      promptVersion: PAIR.promptVersion,
      generatedAt,
      attempts: 1,
      failureReasons: [],
      runId: "seed_run",
      ...(status === "withdrawn" ? { withdrawnAt: new Date(), withdrawnByRunId: "old_withdraw" } : {}),
    },
    select: { id: true },
  });
  if (verdict) {
    await prisma.tourCopyEval.create({
      data: {
        tourCopyId: copy.id,
        copyGeneratedAt: generatedAt,
        judgedText: "A paragraph.",
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
  return tour.id;
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
        slug: "withdraw-city",
        countrySlug: COUNTRY_SLUG,
        name: "Withdraw City",
        country: "Withdrawland",
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

const silent = { out: () => undefined, err: () => undefined };

describe("tour-copy-withdraw store (integration, spec 0003 AC-10)", () => {
  it("withdraws every published row of the pair and writes the run id, and only that pair", async () => {
    await seedCopy("W1", "published");
    await seedCopy("W2", "published");
    await seedCopy("W3", "withdrawn");
    const other = await seedCopy("W4", "published");
    await prisma.tourCopy.update({ where: { tourId: other }, data: { promptVersion: 991 } });

    expect(await store.withdraw(PAIR, "manual-run")).toBe(2);

    const rows = await prisma.tourCopy.findMany({ where: { tour: { provider: PROVIDER } }, select: { status: true, promptVersion: true, withdrawnByRunId: true, withdrawnAt: true } });
    const ours = rows.filter((row) => row.promptVersion === PAIR.promptVersion);
    expect(ours.filter((row) => row.withdrawnByRunId === "manual-run")).toHaveLength(2);
    expect(ours.every((row) => row.status === "withdrawn" && row.withdrawnAt !== null)).toBe(true);
    expect(rows.find((row) => row.promptVersion === 991)!.status).toBe("published");
  });

  it("restores withdrawn rows to published and clears both withdrawal fields", async () => {
    const tourId = await seedCopy("R1", "withdrawn");

    expect(await store.restore(PAIR)).toBe(1);

    const row = await prisma.tourCopy.findUniqueOrThrow({ where: { tourId } });
    expect(row).toMatchObject({ status: "published", withdrawnAt: null, withdrawnByRunId: null });
  });

  it("counts verdicts over both published and withdrawn rows", async () => {
    await seedCopy("C1", "published", "clean");
    await seedCopy("C2", "withdrawn", "unsupported");
    await seedCopy("C3", "withdrawn", "clean");

    expect(await store.judgedStats(PAIR, RUBRIC_VERSION)).toEqual({ judged: 3, bad: 1, leadsWithFact: 3 });
    expect(await store.judgedStats(PAIR, RUBRIC_VERSION + 1)).toEqual({ judged: 0, bad: 0, leadsWithFact: 0 });
  });

  it("main restore refuses while verdicts cross the limit, and proceeds once the rubric version has moved on", async () => {
    // 30 judged rows, 3 of them bad (10%), all withdrawn.
    for (let i = 0; i < 30; i++) await seedCopy(`M${i}`, "withdrawn", i < 3 ? "unsupported" : "clean");
    const args = ["--prompt-version", String(PAIR.promptVersion), "--model", MODEL, "--restore", "--execute"];

    expect(await main(args, {}, silent, { store })).toBe(1);
    expect(await prisma.tourCopy.count({ where: { tour: { provider: PROVIDER }, status: "withdrawn" } })).toBe(30);

    // Simulate a rubric bump: the old verdicts no longer count at the current version.
    await prisma.tourCopyEval.updateMany({
      where: { tourCopy: { tour: { provider: PROVIDER } } },
      data: { rubricVersion: RUBRIC_VERSION + 1 },
    });
    expect(await main(args, {}, silent, { store })).toBe(0);
    expect(await prisma.tourCopy.count({ where: { tour: { provider: PROVIDER }, status: "published" } })).toBe(30);
  });
});
