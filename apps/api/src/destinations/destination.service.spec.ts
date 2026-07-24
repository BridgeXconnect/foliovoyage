import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";

import type { PrismaService } from "../prisma/prisma.service";
import { DestinationService } from "./destination.service";

/** Signature of the single Prisma call the service makes. */
type FindUnique = (args: unknown) => Promise<unknown>;

function makeService(findUnique: jest.Mock<FindUnique>): DestinationService {
  const prisma = { city: { findUnique } } as unknown as PrismaService;
  return new DestinationService(prisma);
}

describe("DestinationService", () => {
  it("maps a found city to the destination response shape", async () => {
    const findUnique = jest.fn<FindUnique>();
    findUnique.mockResolvedValue({
      id: "city_1",
      slug: "paris",
      countrySlug: "france",
      name: "Paris",
      country: "France",
      heroImageUrl: "https://example.test/paris.jpg",
      heroImageAlt: "Paris hero",
      experiences: [
        { id: "exp_1", title: "Louvre", description: "Art.", position: 0 },
        { id: "exp_2", title: "Eiffel", description: "View.", position: 1 },
      ],
    });
    const service = makeService(findUnique);

    const result = await service.getByCountryAndCity("france", "paris");

    expect(result).toEqual({
      city: "Paris",
      citySlug: "paris",
      country: "France",
      countrySlug: "france",
      heroImageUrl: "https://example.test/paris.jpg",
      heroImageAlt: "Paris hero",
      experiences: [
        { id: "exp_1", title: "Louvre", description: "Art." },
        { id: "exp_2", title: "Eiffel", description: "View." },
      ],
    });
    // Looks up by the composite country+city unique key, ordered list.
    expect(findUnique).toHaveBeenCalledWith({
      where: { countrySlug_slug: { countrySlug: "france", slug: "paris" } },
      include: { experiences: { orderBy: { position: "asc" } } },
    });
  });

  it("throws NotFoundException for an unknown destination", async () => {
    const findUnique = jest.fn<FindUnique>();
    findUnique.mockResolvedValue(null);
    const service = makeService(findUnique);

    await expect(
      service.getByCountryAndCity("france", "atlantis"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getByCountryAndCity("france", "atlantis"),
    ).rejects.toThrow("No destination found for france/atlantis");
  });
});
