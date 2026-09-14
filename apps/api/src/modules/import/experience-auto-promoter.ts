import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

/**
 * Automatic experience promoter (category/currency promotion plan, Task 7 —
 * Decision 3).
 *
 * An auto-created Experience (see `experience-linker.ts`) starts life in
 * `status: "draft"` and today only ever leaves that state via the manual,
 * single-id `ExperiencePromoter` (`promote-experience.service.ts`) — a
 * conscious editorial act. This class is the evidence-based alternative for
 * Experiences that already carry everything the public site needs to show
 * them well: a non-empty title/description and a linked Tour with an image,
 * an affiliate link, and a positive USD reference price. It never assesses
 * *quality* beyond "is this presentable" — that's still Admin review's job
 * (M7) — only *completeness*.
 */

/** The minimal shape `isPromotable` needs to decide an Experience's fate. */
export interface PromotionCandidate {
  title: string;
  description: string;
  status: string;
  tour: {
    imageUrl: string | null;
    affiliateUrl: string | null;
    priceReferenceMinor: bigint | number | null;
  } | null;
}

/**
 * Pure predicate: does this Experience have everything required to publish
 * itself, with no editorial judgment involved? Never mutates, never reads the
 * DB — a draft-status check plus completeness checks on the Experience and
 * its linked Tour.
 */
export function isPromotable(c: PromotionCandidate): boolean {
  if (c.status !== "draft") return false;
  if (c.title.trim().length === 0) return false;
  if (c.description.trim().length === 0) return false;
  const t = c.tour;
  if (!t) return false;
  if (!t.imageUrl) return false;
  if (!t.affiliateUrl) return false;
  const ref = t.priceReferenceMinor === null ? null : Number(t.priceReferenceMinor);
  if (ref === null || !Number.isFinite(ref) || ref <= 0) return false;
  return true;
  // Stage B (deferred): also require a resolved category here.
}

/** The Prisma surface the auto-promoter needs; a `PrismaClient` satisfies it. */
export type ExperienceAutoPromoterPrisma = Pick<PrismaClient, "experience">;

/** Outcome of one promotion pass, for the run log. */
export interface PromoteEligibleResult {
  /** Draft Experiences linked to a live Tour of this provider that were examined. */
  readonly scanned: number;
  /** Of those, how many were flipped from `draft` to `published`. */
  readonly promoted: number;
}

/** Rows fetched per page of the keyset-paginated scan. */
const PAGE_SIZE = 1000;

export class ExperienceAutoPromoter {
  private readonly logger = new Logger(ExperienceAutoPromoter.name);

  constructor(private readonly prisma: ExperienceAutoPromoterPrisma) {}

  /**
   * Scan every draft Experience linked to a non-deleted Tour of `provider`,
   * and publish the ones {@link isPromotable} accepts.
   *
   * Keyset-paginates the scan on `id` (same shape as
   * `backfill-reference-price.cli.ts`) rather than loading the whole backlog
   * into memory at once, and issues one bulk `updateMany` per page for that
   * page's eligible ids rather than one write per row — a large backlog's
   * sequential per-row writes previously ran long enough to outlive Neon's
   * connection lifetime and drop mid-run. The `status: "draft"` guard stays
   * on every write — the same idempotent, race-safe shape `ExperienceLinker`'s
   * back-link uses — so a concurrent run (or a re-run) can never
   * double-publish or clobber a status an editor already changed by hand.
   */
  async promoteEligible(provider: string, dryRun = false): Promise<PromoteEligibleResult> {
    let scanned = 0;
    let promoted = 0;
    let cursor: string | undefined;

    for (;;) {
      const candidates = await this.prisma.experience.findMany({
        where: {
          status: "draft",
          tours: { some: { provider, deletedAt: null } },
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          tours: {
            where: { provider, deletedAt: null },
            take: 1,
            select: { imageUrl: true, affiliateUrl: true, priceReferenceMinor: true },
          },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (candidates.length === 0) break;
      scanned += candidates.length;

      const eligibleIds: string[] = [];
      for (const candidate of candidates) {
        const eligible = isPromotable({
          title: candidate.title,
          description: candidate.description,
          status: candidate.status,
          tour: candidate.tours[0] ?? null,
        });
        if (eligible) eligibleIds.push(candidate.id);
      }

      if (eligibleIds.length > 0) {
        if (dryRun) {
          promoted += eligibleIds.length;
        } else {
          const updated = await this.prisma.experience.updateMany({
            where: { id: { in: eligibleIds }, status: "draft" },
            data: { status: "published" },
          });
          promoted += updated.count;
        }
      }

      cursor = candidates[candidates.length - 1]!.id;
      if (candidates.length < PAGE_SIZE) break;
    }

    this.logger.log(
      `${dryRun ? "[dry-run] " : ""}Auto-promotion for provider "${provider}": ` +
        `scanned ${scanned}, promoted ${promoted}.`,
    );
    return { scanned, promoted };
  }
}
