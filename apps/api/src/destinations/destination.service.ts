import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { DestinationResponse } from "./destination.types";

/**
 * Reads a single seeded destination from Postgres via Prisma (ST-5 / BRI-100).
 * Throws {@link NotFoundException} for an unknown country/city so the
 * controller's problem-details filter can render an RFC 9457 404.
 */
@Injectable()
export class DestinationService {
  constructor(private readonly prisma: PrismaService) {}

  async getByCountryAndCity(
    countrySlug: string,
    citySlug: string,
  ): Promise<DestinationResponse> {
    const city = await this.prisma.city.findUnique({
      where: { countrySlug_slug: { countrySlug, slug: citySlug } },
      include: { experiences: { orderBy: { position: "asc" } } },
    });

    if (!city) {
      throw new NotFoundException(
        `No destination found for ${countrySlug}/${citySlug}`,
      );
    }

    return {
      city: city.name,
      citySlug: city.slug,
      country: city.country,
      countrySlug: city.countrySlug,
      heroImageUrl: city.heroImageUrl,
      heroImageAlt: city.heroImageAlt,
      experiences: city.experiences.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
      })),
    };
  }
}
