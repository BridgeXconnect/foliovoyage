import { Logger } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  CURATED_REFS,
  curatedCityForRefs,
  type CuratedCity,
} from "./curated-cities";

/**
 * Experience linker (BRI-164 / ST-11).
 *
 * Runs after the ST-9 upsert commits. For every imported {@link Tour} that maps
 * to a curated city and is not yet linked, it creates exactly one Atlas
 * {@link Experience} (1:1) in `status: "draft"` and points the tour at it via
 * `experienceId`. This stands in for real editorial dedup/curation (M7): the
 * auto-created Experience mirrors the provider tour and is invisible on the
 * public site until an explicit CLI promotes it to `published`.
 *
 * Three properties matter, and all three are load-bearing under a bad or
 * concurrent run:
 *
 * 1. **Curated, not comprehensive.** Only tours whose `destinationRefs` land in
 *    a {@link CuratedCity} are linked (exact ref match — see `curated-cities`);
 *    everything else is left unlinked and never reaches the site. Curation holds
 *    at the import layer, not just in copy.
 * 2. **Geo is never null.** `Experience.latitude/longitude` are NOT NULL. The
 *    linker uses the tour's own resolved coordinates, falling back to the parent
 *    City's centroid (BRI-163) when the tour has none. If **neither** is
 *    available it throws {@link ExperienceGeoUnavailableError} — a loud, specific
 *    failure rather than a silent null or an opaque DB constraint violation.
 * 3. **Idempotent and race-safe.** Creation is keyed on the source tour's
 *    `(provider, providerTourId)` via a unique constraint on Experience, and the
 *    back-link is written with a `experienceId IS NULL` guard. Re-running an
 *    import no-ops; two runs racing the same tour converge on one Experience and
 *    one link, never a duplicate.
 */

/** Thrown when an Experience would be created with no available coordinates. */
export class ExperienceGeoUnavailableError extends Error {
  constructor(
    /** The tour whose Experience could not be geolocated. */
    readonly providerTourId: string,
    /** The city it mapped to (which itself had no centroid). */
    readonly citySlug: string,
  ) {
    super(
      `Cannot create an Experience for tour "${providerTourId}": it has no ` +
        `resolved coordinates and its city "${citySlug}" has no centroid to ` +
        `fall back to. Refusing to write a null location. Seed the city's ` +
        `centroid (centroidLat/centroidLng) or resolve the tour's geo, then ` +
        `re-run.`,
    );
    this.name = "ExperienceGeoUnavailableError";
  }
}

/** Outcome of one linking pass, for the run log. */
export interface ExperienceLinkResult {
  /** Tours for which a new draft Experience was created. */
  readonly created: number;
  /** Tours linked to an Experience (created + already-existing-by-source-key). */
  readonly linked: number;
  /**
   * Tours that matched a curated ref but whose city row is missing from the DB
   * (registry/seed drift) — skipped with a warning rather than crashing the run.
   */
  readonly skippedMissingCity: number;
}

/** The Prisma surface the linker needs; a `PrismaClient` satisfies it. */
export type ExperienceLinkerPrisma = Pick<
  PrismaClient,
  "tour" | "experience" | "city"
>;

/** A curated City row as loaded from the DB (only the fields the linker uses). */
interface CityRow {
  id: string;
  slug: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

export class ExperienceLinker {
  private readonly logger = new Logger(ExperienceLinker.name);

  constructor(private readonly prisma: ExperienceLinkerPrisma) {}

  /**
   * Link every active, unlinked, curated-city tour for `provider` to a draft
   * Experience. Returns the counts for the run log.
   *
   * @throws {ExperienceGeoUnavailableError} if a tour has no geo and its city
   *   has no centroid — the run fails loudly rather than writing a null location.
   */
  async linkRun(provider: string): Promise<ExperienceLinkResult> {
    // Load the curated city rows once, keyed by their Viator ref, so each tour's
    // matched CuratedCity resolves to a DB row (id + centroid) without a query.
    const cityRows = await this.prisma.city.findMany({
      where: { viatorDestRef: { not: null } },
      select: { id: true, slug: true, viatorDestRef: true, centroidLat: true, centroidLng: true },
    });
    const cityByRef = new Map<string, CityRow>();
    for (const row of cityRows) {
      if (row.viatorDestRef) {
        cityByRef.set(row.viatorDestRef, {
          id: row.id,
          slug: row.slug,
          centroidLat: row.centroidLat,
          centroidLng: row.centroidLng,
        });
      }
    }

    // Only active tours that map to a curated ref and are not yet linked. This
    // keeps re-runs cheap and makes the pass idempotent by construction.
    const tours = await this.prisma.tour.findMany({
      where: {
        provider,
        deletedAt: null,
        experienceId: null,
        destinationRefs: { hasSome: [...CURATED_REFS] },
      },
      select: {
        id: true,
        provider: true,
        providerTourId: true,
        title: true,
        description: true,
        latitude: true,
        longitude: true,
        destinationRefs: true,
      },
    });

    let created = 0;
    let linked = 0;
    let skippedMissingCity = 0;

    for (const tour of tours) {
      const curated: CuratedCity | null = curatedCityForRefs(
        tour.destinationRefs,
      );
      // The `hasSome` filter guarantees a match, but re-check defensively.
      if (!curated) continue;

      const city = cityByRef.get(curated.primaryRef);
      if (!city) {
        // Registry lists this city but it isn't seeded — recoverable by seeding.
        // Skip rather than crash the whole run for one unseeded city.
        this.logger.warn(
          `Tour ${tour.providerTourId} maps to curated city ` +
            `"${curated.slug}" (ref ${curated.primaryRef}) but no City row ` +
            `exists for it; skipping. Seed curated cities to link it.`,
        );
        skippedMissingCity += 1;
        continue;
      }

      // Geo: the tour's own coordinates, else the city centroid (BRI-163).
      // Each source is an atomic *pair* — never mix a tour coordinate with a city
      // one. A half-geo tour (lat but no lng, or vice versa) is malformed; taking
      // its present half and coalescing the other from the centroid would
      // fabricate a point that is neither the tour's nor the city's location
      // (silent corruption). Use the tour pair only when both coords are present;
      // otherwise fall back to the city centroid pair.
      const hasTourGeo = tour.latitude !== null && tour.longitude !== null;
      const latitude = hasTourGeo ? tour.latitude : city.centroidLat;
      const longitude = hasTourGeo ? tour.longitude : city.centroidLng;
      if (latitude === null || longitude === null) {
        // Fail loudly — never write a null/spliced location or trip an opaque
        // NOT NULL. Reached when the tour has no complete pair and the city has
        // no complete centroid to fall back to.
        throw new ExperienceGeoUnavailableError(tour.providerTourId, city.slug);
      }

      const { experienceId, wasCreated } = await this.findOrCreateExperience({
        provider: tour.provider,
        providerTourId: tour.providerTourId,
        title: tour.title,
        description: tour.description ?? "",
        latitude,
        longitude,
        cityId: city.id,
      });
      if (wasCreated) created += 1;

      // Back-link only while still unlinked, so a concurrent run that already
      // linked this tour is a no-op rather than a clobber.
      const updated = await this.prisma.tour.updateMany({
        where: { id: tour.id, experienceId: null },
        data: { experienceId },
      });
      if (updated.count > 0) linked += 1;
    }

    this.logger.log(
      `Experience linking for provider "${provider}": created ${created}, ` +
        `linked ${linked}${skippedMissingCity > 0 ? `, skipped ${skippedMissingCity} (missing city)` : ""}.`,
    );
    return { created, linked, skippedMissingCity };
  }

  /**
   * Idempotently find or create the draft Experience for a source tour, keyed on
   * `(sourceProvider, sourceProviderTourId)`. Race-safe: a concurrent create for
   * the same key collides on the unique constraint (P2002) and is resolved by
   * reading the winner back, so callers always converge on one row.
   */
  private async findOrCreateExperience(input: {
    provider: string;
    providerTourId: string;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    cityId: string;
  }): Promise<{ experienceId: string; wasCreated: boolean }> {
    try {
      const created = await this.prisma.experience.create({
        data: {
          title: input.title,
          description: input.description,
          status: "draft",
          latitude: input.latitude,
          longitude: input.longitude,
          cityId: input.cityId,
          sourceProvider: input.provider,
          sourceProviderTourId: input.providerTourId,
        },
        select: { id: true },
      });
      return { experienceId: created.id, wasCreated: true };
    } catch (error) {
      // Unique-constraint violation → another run created it first. Read it back.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.experience.findUnique({
          where: {
            sourceProvider_sourceProviderTourId: {
              sourceProvider: input.provider,
              sourceProviderTourId: input.providerTourId,
            },
          },
          select: { id: true },
        });
        if (existing) return { experienceId: existing.id, wasCreated: false };
      }
      throw error;
    }
  }
}
