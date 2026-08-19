import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type {
  DestinationResponse,
  ExperienceResponse,
  PriceBand,
} from "./destination.types";

/** Default and max experiences per page. */
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

/** Options for a paginated destination read. */
export interface DestinationQuery {
  /** 1-based page number; clamped to ≥ 1. */
  page?: number;
  /** Items per page; clamped to [1, {@link MAX_PAGE_SIZE}]. */
  pageSize?: number;
}

/**
 * Reads a single destination from Postgres via Prisma (ST-5 / BRI-100, extended
 * for ST-11 / BRI-164).
 *
 * Returns the city's **published** Experiences (draft ones are hidden), ordered
 * and paginated, each enriched with the provider fields its card renders —
 * cover image and price band come from the Experience's linked Tour; editor
 * rating and tags are Atlas-owned and stay null/empty until curation. Throws
 * {@link NotFoundException} for an unknown country/city so the controller's
 * problem-details filter can render an RFC 9457 404.
 */
@Injectable()
export class DestinationService {
  constructor(private readonly prisma: PrismaService) {}

  async getByCountryAndCity(
    countrySlug: string,
    citySlug: string,
    query: DestinationQuery = {},
  ): Promise<DestinationResponse> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = clamp(
      Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE),
      1,
      MAX_PAGE_SIZE,
    );

    const city = await this.prisma.city.findUnique({
      where: { countrySlug_slug: { countrySlug, slug: citySlug } },
      select: {
        name: true,
        slug: true,
        country: true,
        countrySlug: true,
        heroImageUrl: true,
        heroImageAlt: true,
      },
    });

    if (!city) {
      throw new NotFoundException(
        `No destination found for ${countrySlug}/${citySlug}`,
      );
    }

    // Published experiences only; draft (auto-created, un-reviewed) stay hidden.
    const where = {
      city: { countrySlug, slug: citySlug },
      status: "published",
    } as const;

    const total = await this.prisma.experience.count({ where });
    const experiences = await this.prisma.experience.findMany({
      where,
      orderBy: [{ position: "asc" }, { title: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        editorRating: true,
        // The linked provider tour carries the card's image + price. 1:1 in
        // practice; take the first (and only) linked tour.
        tours: {
          where: { deletedAt: null },
          take: 1,
          select: { imageUrl: true, imageAlt: true, priceMinor: true },
        },
      },
    });

    return {
      city: city.name,
      citySlug: city.slug,
      country: city.country,
      countrySlug: city.countrySlug,
      heroImageUrl: city.heroImageUrl,
      heroImageAlt: city.heroImageAlt,
      experiences: experiences.map((e): ExperienceResponse => {
        const tour = e.tours[0];
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          imageUrl: tour?.imageUrl ?? null,
          imageAlt: tour?.imageAlt ?? null,
          editorRating: e.editorRating,
          priceBand: priceBandFromMinor(tour?.priceMinor ?? null),
          // Curated tags are Atlas-owned and not set on auto-created imports yet.
          tags: [],
          // affiliateUrl intentionally omitted → card shows a "coming soon"
          // placeholder until review attaches a live link.
        };
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
}

/** Clamp `n` into `[min, max]`. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Map a price in minor units to a rough band. Deliberately currency-naive — a
 * band is a rough signal, not an exact price (matching `@folio/shared`'s
 * `PriceBand` intent). Null in, null out.
 */
export function priceBandFromMinor(priceMinor: number | bigint | null): PriceBand | null {
  if (priceMinor === null) return null;
  const numericMinor = typeof priceMinor === "bigint" ? Number(priceMinor) : priceMinor;
  if (!Number.isFinite(numericMinor)) return null;
  const major = numericMinor / 100;
  if (major <= 40) return "$";
  if (major <= 120) return "$$";
  if (major <= 300) return "$$$";
  return "$$$$";
}
