import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { destinationResponseSchema } from "@folio/shared";

import type { PrismaService } from "../prisma/prisma.service";
import { DestinationService, priceBandFromMinor } from "./destination.service";

/** Minimal Prisma surface the service touches. */
interface Mocks {
  cityFindUnique: jest.Mock<(args: unknown) => Promise<unknown>>;
  experienceCount: jest.Mock<(args: unknown) => Promise<number>>;
  experienceFindMany: jest.Mock<(args: unknown) => Promise<unknown[]>>;
}

function makeService(m: Mocks): DestinationService {
  const prisma = {
    city: { findUnique: m.cityFindUnique },
    experience: { count: m.experienceCount, findMany: m.experienceFindMany },
  } as unknown as PrismaService;
  return new DestinationService(prisma);
}

describe("DestinationService", () => {
  it("maps a found city + published experiences to the response shape", async () => {
    const cityFindUnique = jest.fn<(a: unknown) => Promise<unknown>>();
    cityFindUnique.mockResolvedValue({
      name: "Bangkok",
      slug: "bangkok",
      country: "Thailand",
      countrySlug: "thailand",
      heroImageUrl: "https://example.test/bkk.jpg",
      heroImageAlt: "Bangkok hero",
    });
    const experienceCount = jest.fn<(a: unknown) => Promise<number>>();
    experienceCount.mockResolvedValue(2);
    const experienceFindMany = jest.fn<(a: unknown) => Promise<unknown[]>>();
    experienceFindMany.mockResolvedValue([
      {
        id: "exp_1",
        title: "Wat Pho",
        description: "Temples.",
        editorRating: 4.7,
        tours: [
          {
            imageUrl: "https://img/1.jpg",
            imageAlt: "Wat Pho",
            priceMinor: 3500,
            priceReferenceMinor: 3500,
          },
        ],
      },
      {
        id: "exp_2",
        title: "River cruise",
        description: "Boats.",
        editorRating: null,
        tours: [],
      },
    ]);

    const service = makeService({
      cityFindUnique,
      experienceCount,
      experienceFindMany,
    });

    const result = await service.getByCountryAndCity("thailand", "bangkok", {
      page: 1,
      pageSize: 12,
    });

    expect(result).toEqual({
      city: "Bangkok",
      citySlug: "bangkok",
      country: "Thailand",
      countrySlug: "thailand",
      heroImageUrl: "https://example.test/bkk.jpg",
      heroImageAlt: "Bangkok hero",
      experiences: [
        {
          id: "exp_1",
          title: "Wat Pho",
          description: "Temples.",
          imageUrl: "https://img/1.jpg",
          imageAlt: "Wat Pho",
          editorRating: 4.7,
          priceBand: "$",
          tags: [],
          aiSummary: null,
        },
        {
          id: "exp_2",
          title: "River cruise",
          description: "Boats.",
          imageUrl: null,
          imageAlt: null,
          editorRating: null,
          priceBand: null,
          tags: [],
          aiSummary: null,
        },
      ],
      pagination: { page: 1, pageSize: 12, total: 2, totalPages: 1 },
    });

    // Contract check (BRI-214): what the service returns must satisfy the same
    // schema `apps/web` parses the response with, so an API-side change that
    // the web can't read fails here, in CI, before deploy.
    expect(destinationResponseSchema.safeParse(result).success).toBe(true);

    // Only published experiences are read, for this city, paginated.
    expect(experienceCount).toHaveBeenCalledWith({
      where: { city: { countrySlug: "thailand", slug: "bangkok" }, status: "published" },
    });
    const findManyArgs = experienceFindMany.mock.calls[0][0] as {
      where: unknown;
      skip: number;
      take: number;
    };
    expect(findManyArgs.where).toEqual({
      city: { countrySlug: "thailand", slug: "bangkok" },
      status: "published",
    });
    expect(findManyArgs.skip).toBe(0);
    expect(findManyArgs.take).toBe(12);
  });

  it("paginates: clamps page/pageSize and computes skip + totalPages", async () => {
    const cityFindUnique = jest.fn<(a: unknown) => Promise<unknown>>();
    cityFindUnique.mockResolvedValue({
      name: "Rome",
      slug: "rome",
      country: "Italy",
      countrySlug: "italy",
      heroImageUrl: "h",
      heroImageAlt: "a",
    });
    const experienceCount = jest.fn<(a: unknown) => Promise<number>>();
    experienceCount.mockResolvedValue(30);
    const experienceFindMany = jest.fn<(a: unknown) => Promise<unknown[]>>();
    experienceFindMany.mockResolvedValue([]);

    const service = makeService({
      cityFindUnique,
      experienceCount,
      experienceFindMany,
    });

    const result = await service.getByCountryAndCity("italy", "rome", {
      page: 3,
      pageSize: 10,
    });

    expect(result.pagination).toEqual({
      page: 3,
      pageSize: 10,
      total: 30,
      totalPages: 3,
    });
    const args = experienceFindMany.mock.calls[0][0] as { skip: number; take: number };
    expect(args.skip).toBe(20); // (3 - 1) * 10
    expect(args.take).toBe(10);
  });

  it("throws NotFoundException for an unknown destination", async () => {
    const cityFindUnique = jest.fn<(a: unknown) => Promise<unknown>>();
    cityFindUnique.mockResolvedValue(null);
    const service = makeService({
      cityFindUnique,
      experienceCount: jest.fn<(a: unknown) => Promise<number>>(),
      experienceFindMany: jest.fn<(a: unknown) => Promise<unknown[]>>(),
    });

    await expect(
      service.getByCountryAndCity("france", "atlantis"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getByCountryAndCity("france", "atlantis"),
    ).rejects.toThrow("No destination found for france/atlantis");
  });
});

describe("priceBandFromMinor", () => {
  it("maps minor-unit prices to rough bands, null-safe", () => {
    expect(priceBandFromMinor(null)).toBeNull();
    expect(priceBandFromMinor(3500)).toBe("$"); // $35
    expect(priceBandFromMinor(8000)).toBe("$$"); // $80
    expect(priceBandFromMinor(12000)).toBe("$$"); // $120 (boundary)
    expect(priceBandFromMinor(22000)).toBe("$$$"); // $220
    expect(priceBandFromMinor(40000)).toBe("$$$$"); // $400
  });
});
