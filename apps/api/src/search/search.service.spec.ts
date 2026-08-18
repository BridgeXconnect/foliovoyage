import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../prisma/prisma.service";
import {
  concatenateFeaturedAndPaginate,
  type DestinationSearchRow,
  type ExperienceSearchRow,
  mergeRankAndPaginate,
  scoreDestinationRow,
  scoreExperienceRow,
  SearchService,
  SEARCH_WEIGHTS,
} from "./search.service";

function experienceRow(overrides: Partial<ExperienceSearchRow> = {}): ExperienceSearchRow {
  return {
    id: "exp_1",
    title: "Grand Palace Tour",
    description: "A guided walk through Bangkok's Grand Palace.",
    editorRating: null,
    citySlug: "bangkok",
    countrySlug: "thailand",
    cityName: "Bangkok",
    country: "Thailand",
    imageUrl: null,
    imageAlt: null,
    priceMinor: null,
    textRank: 0.5,
    clickCount: 0,
    ...overrides,
  };
}

function destinationRow(overrides: Partial<DestinationSearchRow> = {}): DestinationSearchRow {
  return {
    citySlug: "bangkok",
    countrySlug: "thailand",
    name: "Bangkok",
    country: "Thailand",
    heroImageUrl: "https://example.test/bkk.jpg",
    heroImageAlt: "Bangkok hero",
    textRank: 0.5,
    ...overrides,
  };
}

describe("scoreExperienceRow", () => {
  it("weights text/editor/popularity per SEARCH_WEIGHTS, summing to at most 1", () => {
    const score = scoreExperienceRow({ textRank: 1, editorRating: 5, clickCount: 1000 });
    expect(score).toBeCloseTo(
      SEARCH_WEIGHTS.text + SEARCH_WEIGHTS.editorRating + SEARCH_WEIGHTS.popularity,
      6,
    );
  });

  it("treats a null editorRating as zero contribution (not a penalty vs. rated rows only)", () => {
    const unrated = scoreExperienceRow({ textRank: 0.4, editorRating: null, clickCount: 0 });
    expect(unrated).toBeCloseTo(0.4 * SEARCH_WEIGHTS.text, 6);
  });

  it("clamps popularity so a runaway click count can't dominate ranking", () => {
    const clamped = scoreExperienceRow({ textRank: 0, editorRating: null, clickCount: 50 });
    const overClamped = scoreExperienceRow({ textRank: 0, editorRating: null, clickCount: 5000 });
    expect(overClamped).toBeCloseTo(clamped, 6);
    expect(overClamped).toBeCloseTo(SEARCH_WEIGHTS.popularity, 6);
  });
});

describe("scoreDestinationRow", () => {
  it("is the raw text rank, not scaled by SEARCH_WEIGHTS.text", () => {
    expect(scoreDestinationRow({ textRank: 0.42 })).toBe(0.42);
  });
});

describe("mergeRankAndPaginate", () => {
  it("merges Experience + Destination candidates into one score-sorted list", () => {
    const experiences = [
      experienceRow({ id: "low", title: "Low match", textRank: 0.1 }),
      experienceRow({ id: "high", title: "High match", textRank: 0.9 }),
    ];
    const destinations = [destinationRow({ citySlug: "mid", name: "Mid match", textRank: 0.5 })];

    const { results, total } = mergeRankAndPaginate(experiences, destinations, 3, 1, 10);

    expect(total).toBe(3);
    expect(results.map((r) => (r.type === "experience" ? r.id : r.citySlug))).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("a strong destination match outranks an equally-strong experience match (unscaled text score)", () => {
    const experiences = [experienceRow({ id: "exp", textRank: 0.6 })];
    const destinations = [destinationRow({ citySlug: "dest", textRank: 0.6 })];

    const { results } = mergeRankAndPaginate(experiences, destinations, 2, 1, 10);

    expect(results[0].type).toBe("destination");
  });

  it("tie-breaks equal scores alphabetically by name/title for deterministic ordering", () => {
    const experiences = [
      experienceRow({ id: "b", title: "Bravo", textRank: 0 }),
      experienceRow({ id: "a", title: "Alpha", textRank: 0 }),
    ];

    const { results } = mergeRankAndPaginate(experiences, [], 2, 1, 10);

    expect(results.map((r) => (r.type === "experience" ? r.title : ""))).toEqual([
      "Alpha",
      "Bravo",
    ]);
  });

  it("paginates the merged list (not each source list independently)", () => {
    const experiences = Array.from({ length: 5 }, (_, i) =>
      experienceRow({ id: `e${i}`, title: `Exp ${i}`, textRank: 1 - i / 10 }),
    );

    const page1 = mergeRankAndPaginate(experiences, [], 5, 1, 2);
    const page2 = mergeRankAndPaginate(experiences, [], 5, 2, 2);
    const page3 = mergeRankAndPaginate(experiences, [], 5, 3, 2);

    expect(page1.results.map((r) => (r.type === "experience" ? r.id : ""))).toEqual([
      "e0",
      "e1",
    ]);
    expect(page2.results.map((r) => (r.type === "experience" ? r.id : ""))).toEqual([
      "e2",
      "e3",
    ]);
    expect(page3.results.map((r) => (r.type === "experience" ? r.id : ""))).toEqual(["e4"]);
  });

  it("maps priceMinor to a priceBand and passes through editorRating/city context", () => {
    const experiences = [
      experienceRow({ priceMinor: 8000, editorRating: 4.5, cityName: "Kyoto", citySlug: "kyoto" }),
    ];

    const { results } = mergeRankAndPaginate(experiences, [], 1, 1, 10);
    const [result] = results;

    expect(result.type).toBe("experience");
    if (result.type === "experience") {
      expect(result.priceBand).toBe("$$");
      expect(result.editorRating).toBe(4.5);
      expect(result.city).toBe("Kyoto");
      expect(result.citySlug).toBe("kyoto");
    }
  });
});

describe("concatenateFeaturedAndPaginate", () => {
  it("puts Destinations before Experiences, regardless of score, and doesn't re-sort either side", () => {
    const experiences = [
      experienceRow({ id: "rated", title: "Zebra tour", editorRating: 5, textRank: 0 }),
      experienceRow({ id: "unrated", title: "Aardvark tour", editorRating: null, textRank: 0 }),
    ];
    const destinations = [
      destinationRow({ citySlug: "z-city", name: "Zzz City", textRank: 0 }),
      destinationRow({ citySlug: "a-city", name: "Aaa City", textRank: 0 }),
    ];

    const { results, total } = concatenateFeaturedAndPaginate(
      experiences,
      destinations,
      4,
      1,
      10,
    );

    expect(total).toBe(4);
    // Destinations first, in the order given (not alphabetized) — then
    // Experiences, in the order given (the SQL's editorRating-desc order),
    // not re-sorted by score.
    expect(
      results.map((r) => (r.type === "destination" ? r.citySlug : r.id)),
    ).toEqual(["z-city", "a-city", "rated", "unrated"]);
  });

  it("guarantees Destinations survive pagination even against many zero-score Experiences", () => {
    // Simulates real catalogue reality: ~all Experiences are unrated (score 0),
    // so a naive score-sorted merge would bury Destinations among thousands of
    // ties. This path must not do that.
    const manyUnratedExperiences = Array.from({ length: 500 }, (_, i) =>
      experienceRow({ id: `e${i}`, title: `Filler ${i}`, editorRating: null, textRank: 0 }),
    );
    const destinations = [destinationRow({ citySlug: "bangkok", textRank: 0 })];

    const { results } = concatenateFeaturedAndPaginate(
      manyUnratedExperiences,
      destinations,
      501,
      1,
      12,
    );

    expect(results.some((r) => r.type === "destination" && r.citySlug === "bangkok")).toBe(
      true,
    );
  });
});

/** Minimal Prisma surface SearchService touches: only $queryRaw, invoked as a
 * tagged template. Each call in Promise.all resolves in source order. */
function fakePrisma(
  responses: unknown[][],
): { prisma: PrismaService; queryRaw: jest.Mock<(...args: unknown[]) => Promise<unknown[]>> } {
  const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
  for (const r of responses) queryRaw.mockResolvedValueOnce(r);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { prisma, queryRaw };
}

describe("SearchService.search", () => {
  it("runs the text-search path (4 queries) for a non-empty q and returns merged results", async () => {
    const { prisma, queryRaw } = fakePrisma([
      [experienceRow({ id: "exp_1", textRank: 0.8 })], // experiences
      [destinationRow({ citySlug: "bangkok", textRank: 0.3 })], // destinations
      [{ n: 1 }], // experience count
      [{ n: 1 }], // destination count
    ]);
    const service = new SearchService(prisma);

    const response = await service.search("bangkok temple", 1, 10);

    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(response.query).toBe("bangkok temple");
    expect(response.pagination).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
    expect(response.results).toHaveLength(2);
    expect(response.results[0].type).toBe("experience"); // higher score (0.8*0.7 vs 0.3)
  });

  it("trims whitespace-only q and falls back to the featured path (also 4 queries)", async () => {
    const { prisma, queryRaw } = fakePrisma([
      [experienceRow()],
      [destinationRow()],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const service = new SearchService(prisma);

    const response = await service.search("   ", 1, 10);

    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(response.query).toBe("");
  });

  it("clamps page to >= 1 and pageSize into [1, 48]", async () => {
    const { prisma } = fakePrisma([[], [], [{ n: 0 }], [{ n: 0 }]]);
    const service = new SearchService(prisma);

    const response = await service.search("x", -5, 500);

    expect(response.pagination.page).toBe(1);
    expect(response.pagination.pageSize).toBe(48);
  });

  it("defaults an undefined q to the featured path", async () => {
    const { prisma, queryRaw } = fakePrisma([[], [], [{ n: 0 }], [{ n: 0 }]]);
    const service = new SearchService(prisma);

    const response = await service.search(undefined);

    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(response.query).toBe("");
    expect(response.results).toEqual([]);
  });
});
