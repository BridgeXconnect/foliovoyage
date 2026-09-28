import { Logger } from "@nestjs/common";

import { derivePrimaryCategory, unresolvedTagIds } from "./category-rule";
import type { TourDTO } from "./normalizer";
import type { TagVocabulary } from "./tag-resolver";

/**
 * Attaches {@link TourDTO.primary_category_tag_id} to a batch of normalized
 * tours (BRI-224) — the "attach after normalize" step for tag categories,
 * mirroring {@link PriceResolver}/{@link LocationResolver}'s shape. Unlike
 * those, this step makes no network call of its own: the vocabulary is
 * already resolved by {@link TagVocabularySource.getVocabulary}
 * ({@link TagResolver} in production), and deriving a category from it is a
 * synchronous, pure lookup (`category-rule.ts`).
 *
 * The vocabulary is fetched once and memoized for this instance's lifetime —
 * one `getVocabulary()` call per import segment (segments run as short-lived
 * processes, so this is effectively "once per segment"), not once per page.
 */

/** The seam {@link CategoryResolver} needs from {@link TagResolver}; kept narrow for tests. */
export interface TagVocabularySource {
  getVocabulary(): Promise<TagVocabulary>;
}

/** Minimal logger seam so tests can assert on the unresolved-tag warning without a real Nest Logger. */
export interface CategoryResolverLogger {
  warn(message: string): void;
}

export class CategoryResolver {
  private readonly logger: CategoryResolverLogger;
  private vocabularyPromise: Promise<TagVocabulary> | null = null;

  constructor(
    private readonly source: TagVocabularySource,
    logger: CategoryResolverLogger = new Logger(CategoryResolver.name),
  ) {
    this.logger = logger;
  }

  /**
   * Returns new DTOs with `primary_category_tag_id` set (never mutates
   * `tours`). Every unresolved tag id across the whole batch is reported in a
   * single warning — an AC: a tag id missing from the vocabulary must never
   * be silently dropped.
   */
  async attachCategories(tours: TourDTO[]): Promise<TourDTO[]> {
    if (tours.length === 0) return tours;

    if (!this.vocabularyPromise) {
      this.vocabularyPromise = this.source.getVocabulary();
    }
    const vocabulary = await this.vocabularyPromise;

    const unresolved = new Set<number>();
    const out = tours.map((tour) => {
      for (const id of unresolvedTagIds(tour.tags, vocabulary.graph)) {
        unresolved.add(id);
      }
      return {
        ...tour,
        primary_category_tag_id: derivePrimaryCategory(
          tour.tags,
          vocabulary.graph,
        ),
      };
    });

    if (unresolved.size > 0) {
      const ids = [...unresolved].sort((a, b) => a - b);
      this.logger.warn(
        `${ids.length} tag id(s) not in the Viator vocabulary (never silently dropped): ${ids.join(", ")}`,
      );
    }

    return out;
  }
}
