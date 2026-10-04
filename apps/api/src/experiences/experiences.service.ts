import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ExperiencePage, ExperienceRating } from "@folio/shared";

import { pickLargestImage } from "../canvas/canvas-image";
import { resolveAiSummary } from "../destinations/destination.service";
import { PrismaService } from "../prisma/prisma.service";
import { stripProviderHtml } from "./strip-provider-html";

/**
 * The data behind a tour's own page (spec 0005, AC-1 to AC-3, AC-5).
 *
 * An Experience can in principle hold several Tours. The page shows the live one
 * (`deletedAt` null) with the lowest `id`, the same rule `DestinationService`
 * uses when it reads an Experience's Tour, so the AI copy always matches the Tour
 * shown. The canvas feed picks differently (best score, ties on id); the two
 * agree today because no Experience has more than one Tour.
 *
 * Every field comes from the one chosen Tour except `city`. Nothing is rewritten:
 * the price is the supplier's own amount and currency, the cancellation text is
 * exactly as stored, and the image url is one of the stored variants.
 */

/** The three ways an Experience can have no page. Each has its own `detail` (AC-3). */
export const NOT_FOUND_DETAIL = {
  unknown: "No experience found with this id",
  unpublished: "This experience is not published",
  noLiveTour: "This experience has no live tour",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `cancellationPolicy.description` as stored, or null when the policy, the key or
 * a non empty string is missing. Never built from `refundTiers`.
 */
export function cancellationDescriptionOf(policy: unknown): string | null {
  if (!isRecord(policy)) return null;
  const { description } = policy;
  return typeof description === "string" && description.trim() !== "" ? description : null;
}

/** A BigInt price as the JSON integer it must be, or null if it would not survive as an exact number. */
function toJsonInteger(value: bigint): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

@Injectable()
export class ExperiencesService {
  private readonly logger = new Logger(ExperiencesService.name);
  /** Experiences already warned about, so a busy page does not repeat the line. */
  private readonly warnedMultiTour = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async getPage(id: string): Promise<ExperiencePage> {
    const experience = await this.prisma.experience.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        city: { select: { slug: true, countrySlug: true, name: true } },
        tours: {
          where: { deletedAt: null },
          orderBy: { id: "asc" },
          // Two is enough to know there is more than one.
          take: 2,
          select: {
            id: true,
            title: true,
            description: true,
            durationMin: true,
            ratingAvg: true,
            ratingCount: true,
            priceMinor: true,
            currency: true,
            affiliateUrl: true,
            imageUrl: true,
            imageAlt: true,
            images: true,
            inclusions: true,
            exclusions: true,
            cancellationPolicy: true,
            tourCopy: { select: { status: true, aiSummary: true, groundingHash: true } },
          },
        },
      },
    });
    const { tour, city } = this.liveTour(id, experience);

    const image = pickLargestImage(tour.images, tour.imageUrl);
    const aiSummary = resolveAiSummary(tour);
    const providerSummary = aiSummary ? null : stripProviderHtml(tour.description);
    const priceMinor = tour.priceMinor === null ? null : toJsonInteger(tour.priceMinor);

    return {
      experienceId: id,
      tourId: tour.id,
      title: tour.title,
      image: image && { ...image, alt: tour.imageAlt?.trim() ? tour.imageAlt : tour.title },
      durationMin: tour.durationMin,
      price:
        priceMinor !== null && tour.currency ? { amountMinor: priceMinor, currency: tour.currency } : null,
      cancellationDescription: cancellationDescriptionOf(tour.cancellationPolicy),
      summary: aiSummary
        ? { kind: "ai", text: aiSummary }
        : providerSummary
          ? { kind: "provider", text: providerSummary }
          : null,
      affiliateUrl: tour.affiliateUrl || null,
      city: { slug: city.slug, countrySlug: city.countrySlug, name: city.name },
    };
  }

  async getRating(id: string): Promise<ExperienceRating> {
    const experience = await this.prisma.experience.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tours: {
          where: { deletedAt: null },
          orderBy: { id: "asc" },
          take: 2,
          select: { id: true, ratingAvg: true, ratingCount: true },
        },
      },
    });
    const { tour } = this.liveTour(id, experience);
    return { ratingAvg: tour.ratingAvg, ratingCount: tour.ratingCount };
  }

  /**
   * The three 404 cases, in order, then the chosen Tour. `tours` arrives already
   * filtered to live and sorted by id, so the first one is the lowest.
   */
  private liveTour<E extends { status: string; tours: unknown[] }>(
    id: string,
    experience: E | null,
  ): E & { tour: E["tours"][number] } {
    if (!experience) throw new NotFoundException(NOT_FOUND_DETAIL.unknown);
    if (experience.status !== "published") throw new NotFoundException(NOT_FOUND_DETAIL.unpublished);
    const [tour] = experience.tours;
    if (!tour) throw new NotFoundException(NOT_FOUND_DETAIL.noLiveTour);

    if (experience.tours.length > 1 && !this.warnedMultiTour.has(id)) {
      this.warnedMultiTour.add(id);
      this.logger.warn(`Experience ${id} has more than one live Tour; showing the lowest id`);
    }
    return { ...experience, tour };
  }
}
