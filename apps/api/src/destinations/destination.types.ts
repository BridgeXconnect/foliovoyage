/**
 * Response shape for `GET /v1/destinations/:country/:city` (ST-5 / BRI-100,
 * extended for ST-11 / BRI-164 and for AI tour copy, BRI-154 / spec 0002).
 *
 * The contract itself (types and their Zod schemas) lives in `@folio/shared`
 * so `apps/web` parses against the same definition instead of a hand-kept copy
 * (BRI-214). Re-exported here so the rest of the API imports it from its
 * existing path. Import is type-only: the compiled API never loads the
 * shared package at runtime.
 */
export type {
  DestinationResponse,
  ExperienceResponse,
  PaginationMeta,
} from "@folio/shared";

/** Rough price signal, the shared `PriceBand`. */
export type { PriceBand } from "@folio/shared";
