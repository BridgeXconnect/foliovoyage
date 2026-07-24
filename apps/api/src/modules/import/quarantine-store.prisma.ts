import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { PrismaService } from "../../prisma/prisma.service";
import type { QuarantineRecord, QuarantineStore } from "./validator";

/**
 * Prisma-backed {@link QuarantineStore} (ST-8 / BRI-105).
 *
 * Persists each quarantined tour to the `QuarantinedTour` table, retaining the
 * full payload verbatim plus the reason(s) it failed — nothing is discarded, so
 * the row can be reviewed later (Admin surfacing is a future story). This is the
 * production wiring behind the {@link QuarantineStore} seam; unit tests use an
 * in-memory fake instead and never touch the database.
 */
export class PrismaQuarantineStore implements QuarantineStore {
  private readonly logger = new Logger(PrismaQuarantineStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(record: QuarantineRecord): Promise<void> {
    const { tour, reasons } = record;

    await this.prisma.quarantinedTour.create({
      data: {
        provider: tour.provider,
        providerTourId: tour.provider_tour_id,
        sourceHash: tour.source_hash,
        reasonCodes: reasons.map((r) => r.code),
        // Cast through Prisma's JSON input types: these are plain
        // JSON-serializable objects, retained as-is for review.
        reasons: reasons as unknown as Prisma.InputJsonValue,
        payload: tour as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.debug(
      `Persisted quarantined tour ${tour.provider}:${tour.provider_tour_id}`,
    );
  }
}
