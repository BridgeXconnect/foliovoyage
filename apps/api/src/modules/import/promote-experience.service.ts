import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

/**
 * Experience promoter (BRI-164 / ST-11).
 *
 * Flips a single Experience from `draft` to `published` — the explicit,
 * scriptable stand-in for Admin review (M7), which does not exist yet. It is
 * deliberately the *only* way an auto-created Experience becomes visible on the
 * public site, so publishing is always a conscious act, never a side effect of
 * import. When real Admin review lands, this becomes an internal detail of that
 * flow rather than the front door.
 *
 * The transition is idempotent and one-directional here: promoting an
 * already-published Experience is a reported no-op, and this service never
 * un-publishes.
 */

/** The Prisma surface the promoter needs; a `PrismaClient` satisfies it. */
export type ExperiencePromoterPrisma = Pick<PrismaClient, "experience">;

/** Thrown when the id doesn't match any Experience. */
export class ExperienceNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No Experience found with id "${id}".`);
    this.name = "ExperienceNotFoundError";
  }
}

/** Outcome of a promote call, for the CLI to report. */
export interface PromoteResult {
  readonly id: string;
  readonly title: string;
  /** Status before the call. */
  readonly previousStatus: string;
  /** Status after the call (always `"published"` on success). */
  readonly status: string;
  /** False when the Experience was already published (a no-op). */
  readonly changed: boolean;
}

export class ExperiencePromoter {
  private readonly logger = new Logger(ExperiencePromoter.name);

  constructor(private readonly prisma: ExperiencePromoterPrisma) {}

  /**
   * Promote the Experience `id` to `published`.
   *
   * @throws {ExperienceNotFoundError} if no such Experience exists.
   */
  async promote(id: string): Promise<PromoteResult> {
    const existing = await this.prisma.experience.findUnique({
      where: { id },
      select: { id: true, title: true, status: true },
    });
    if (!existing) throw new ExperienceNotFoundError(id);

    if (existing.status === "published") {
      this.logger.log(`Experience ${id} is already published; no change.`);
      return {
        id: existing.id,
        title: existing.title,
        previousStatus: existing.status,
        status: existing.status,
        changed: false,
      };
    }

    const updated = await this.prisma.experience.update({
      where: { id },
      data: { status: "published" },
      select: { id: true, title: true, status: true },
    });
    this.logger.log(
      `Promoted Experience ${id} ("${updated.title}") ` +
        `from "${existing.status}" to "published".`,
    );
    return {
      id: updated.id,
      title: updated.title,
      previousStatus: existing.status,
      status: updated.status,
      changed: true,
    };
  }
}
