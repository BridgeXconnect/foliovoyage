import type { PrismaClient } from "@prisma/client";

import type { TagRow, TourRow } from "./candidates";

/**
 * Read only access to the Tour rows the candidate stage ranks (BRI-206, spec
 * child 0003). Only `SELECT` is ever run. A tour counts for a city when it is
 * not soft deleted and its `destinationRefs` overlap the city's Viator refs.
 */
export interface CatalogReader {
  tagRows(refs: readonly string[]): Promise<TagRow[]>;
  tourRows(refs: readonly string[]): Promise<TourRow[]>;
}

export class PrismaCatalogReader implements CatalogReader {
  constructor(private readonly prisma: PrismaClient) {}

  async tagRows(refs: readonly string[]): Promise<TagRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tagId: number; productCount: number; ratingAvg: number | null }>
    >`
      SELECT tag AS "tagId",
             count(*)::int AS "productCount",
             avg("ratingAvg") FILTER (WHERE "ratingCount" >= 5) AS "ratingAvg"
      FROM "Tour", unnest("tags") AS tag
      WHERE "deletedAt" IS NULL AND "destinationRefs" && ${[...refs]}::text[]
      GROUP BY tag`;
    return rows.map((r) => ({
      tagId: Number(r.tagId),
      productCount: Number(r.productCount),
      ratingAvg: r.ratingAvg === null ? null : Number(r.ratingAvg),
    }));
  }

  async tourRows(refs: readonly string[]): Promise<TourRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ title: string; ratingAvg: number | null; ratingCount: number | null }>
    >`
      SELECT "title", "ratingAvg", "ratingCount"
      FROM "Tour"
      WHERE "deletedAt" IS NULL AND "destinationRefs" && ${[...refs]}::text[]`;
    return rows.map((r) => ({
      title: r.title,
      ratingAvg: r.ratingAvg === null ? null : Number(r.ratingAvg),
      ratingCount: r.ratingCount === null ? null : Number(r.ratingCount),
    }));
  }
}
