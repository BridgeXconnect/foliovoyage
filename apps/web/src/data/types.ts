/**
 * Content model for the placeholder editorial layer.
 *
 * The type definitions now live in the `@folio/shared` workspace package so the
 * web app and the NestJS API share one source of truth (see ST-1 monorepo
 * scaffold). This module re-exports them, so every existing `@/data/types`
 * import across the app keeps working unchanged.
 *
 * The affiliate-swap seam is documented on `Experience` in `@folio/shared`.
 */

export type {
  PriceBand,
  ExperienceCategory,
  Experience,
  Destination,
} from "@folio/shared";
