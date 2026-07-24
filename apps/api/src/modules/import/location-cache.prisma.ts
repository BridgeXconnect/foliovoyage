import { Logger } from "@nestjs/common";

import type { PrismaService } from "../../prisma/prisma.service";
import type { LocationCache, ResolvedLocation } from "./location-resolver";

/**
 * Prisma-backed {@link LocationCache} (ST-7b / BRI-163).
 *
 * Persists resolved Viator locations in the `ProviderLocation` table so a
 * reference resolved on any previous import run is served from Postgres instead
 * of re-hitting `/locations/bulk`. This is the production wiring behind the
 * {@link LocationCache} seam; unit tests use an in-memory fake instead and never
 * touch the database.
 *
 * Rows have no short-lived invalidation — Viator's guidance is that location
 * data changes infrequently — so a hit is returned regardless of age. A
 * re-resolve simply upserts and bumps `resolvedAt`.
 */
export class PrismaLocationCache implements LocationCache {
  private readonly logger = new Logger(PrismaLocationCache.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMany(
    references: string[],
  ): Promise<Map<string, ResolvedLocation>> {
    if (references.length === 0) return new Map();

    const rows = await this.prisma.providerLocation.findMany({
      where: { reference: { in: references } },
      select: { reference: true, latitude: true, longitude: true, name: true },
    });

    return new Map(
      rows.map((row) => [
        row.reference,
        {
          reference: row.reference,
          latitude: row.latitude,
          longitude: row.longitude,
          name: row.name,
        },
      ]),
    );
  }

  async putMany(locations: ResolvedLocation[]): Promise<void> {
    if (locations.length === 0) return;

    // Upsert per reference: first resolve inserts, a later re-resolve refreshes
    // coordinates and `resolvedAt`. Run in one transaction so a partial failure
    // doesn't leave the cache half-written.
    await this.prisma.$transaction(
      locations.map((loc) =>
        this.prisma.providerLocation.upsert({
          where: { reference: loc.reference },
          create: {
            reference: loc.reference,
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.name,
          },
          update: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.name,
          },
        }),
      ),
    );

    this.logger.debug(`Cached ${locations.length} resolved location(s)`);
  }
}
