import { Injectable, NotFoundException } from "@nestjs/common";

import { evaluateTourCopyEligibility } from "../modules/content/tour-copy-eligibility";
import { computeGroundingHash } from "../modules/content/tour-copy-grounding-hash";
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

/** The fields `resolveAiSummary` needs off the Experience's first linked Tour. */
export interface TourAiSummaryInput {
  title: string;
  description: string | null;
  durationMin: number | null;
  inclusions: unknown;
  exclusions: unknown;
  ratingAvg: number | null;
  ratingCount: number | null;
  tourCopy: { status: string; aiSummary: string | null; groundingHash: string } | null;
}

/**
 * AC-12's read rule for `aiSummary` (BRI-154 / spec 0002): serve the stored
 * copy only when its row is `published`, its stored hash still matches the
 * tour's current grounding fields (so an edited tour doesn't keep serving
 * stale copy until the next generation run), and the tour is still eligible.
 * Null in every other case, including "no row yet" and "no linked tour".
 */
export function resolveAiSummary(tour: TourAiSummaryInput | undefined): string | null {
  if (!tour?.tourCopy || tour.tourCopy.status !== "published") return null;
  const currentHash = computeGroundingHash({
    title: tour.title,
    description: tour.description,
    durationMin: tour.durationMin,
    inclusions: tour.inclusions,
    exclusions: tour.exclusions,
  });
  if (tour.tourCopy.groundingHash !== currentHash) return null;
  if (!evaluateTourCopyEligibility({ ratingAvg: tour.ratingAvg, ratingCount: tour.ratingCount }).eligible) {
    return null;
  }
  return tour.tourCopy.aiSummary;
}

/**
 * Reads a single destination from Postgres via Prisma (ST-5 / BRI-100, extended
 * for ST-11 / BRI-164 and for AI tour copy, BRI-154 / spec 0002).
 *
 * Returns the city's **published** Experiences (draft ones are hidden), ordered
 * and paginated, each enriched with the provider fields its card renders —
 * cover image, price band, and `aiSummary` come from the Experience's linked
 * Tour (the lowest-id one, when more than one is linked); editor rating and
 * tags are Atlas-owned and stay null/empty until curation. Throws
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
          orderBy: { id: "asc" },
          take: 1,
          select: {
            imageUrl: true,
            imageAlt: true,
            priceMinor: true,
            priceReferenceMinor: true,
            title: true,
            description: true,
            durationMin: true,
            inclusions: true,
            exclusions: true,
            ratingAvg: true,
            ratingCount: true,
            tourCopy: { select: { status: true, aiSummary: true, groundingHash: true } },
          },
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
          priceBand: priceBandFromMinor(tour?.priceReferenceMinor ?? null),
          // Curated tags are Atlas-owned and not set on auto-created imports yet.
          tags: [],
          aiSummary: resolveAiSummary(tour),
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
 * Major-currency-unit upper bounds for the `$`/`$$`/`$$$` bands; anything above
 * `high` is `$$$$`. Exported so callers that need the *inverse* mapping (a band
 * -> a price range, e.g. the search filter, ST-16 / BRI-128) derive it from this
 * single source rather than hand-copying the boundaries a second time.
 */
export const PRICE_BAND_MAJOR_THRESHOLDS = { low: 40, mid: 120, high: 300 } as const;

/**
 * Map a price in minor units to a rough band. `priceMinor` here must already
 * be a **reference-currency (USD) minor value** (`Tour.priceReferenceMinor`)
 * — the thresholds below are USD amounts, so a raw supplier-currency
 * `priceMinor` would mis-band anything not already in USD. A band is a rough
 * signal, not an exact price (matching `@folio/shared`'s `PriceBand` intent).
 * Null in, null out.
 */
export function priceBandFromMinor(priceMinor: number | bigint | null): PriceBand | null {
  if (priceMinor === null) return null;
  const numericMinor = typeof priceMinor === "bigint" ? Number(priceMinor) : priceMinor;
  if (!Number.isFinite(numericMinor)) return null;
  const major = numericMinor / 100;
  if (major <= PRICE_BAND_MAJOR_THRESHOLDS.low) return "$";
  if (major <= PRICE_BAND_MAJOR_THRESHOLDS.mid) return "$$";
  if (major <= PRICE_BAND_MAJOR_THRESHOLDS.high) return "$$$";
  return "$$$$";
}
