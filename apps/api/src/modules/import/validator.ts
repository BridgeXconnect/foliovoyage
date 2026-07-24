import { Logger } from "@nestjs/common";

import type { TourDTO } from "./normalizer";

/**
 * Validator (ST-8 / BRI-105).
 *
 * The last gate before a normalized, location-resolved tour is eligible for the
 * public site. It decides, per tour, **pass-through** vs **quarantine**, and for
 * a quarantine it retains the full payload plus the reason(s) so the row can be
 * reviewed later (Admin surfacing is a future story) rather than silently
 * dropped. A per-run counter is incremented on each quarantine to feed ST-10's
 * `import_run` stats.
 *
 * Failure classes — **missing** and **invalid** are deliberately different (this
 * is the correction BRI-163 forced, and it must not be collapsed back):
 *
 * - **`title`** — missing/empty quarantines. Title backs a `NOT NULL` column and
 *   a titleless tour is unusable, so absence itself is fatal. (The ST-7
 *   normalizer already throws on a missing title, so reaching here is
 *   defence-in-depth.)
 * - **`price`** — a *non-positive* price (`≤ 0`) quarantines: that is corrupt
 *   data. A *missing* price (`null`) is a gap, not corruption, and passes
 *   through — a tour can still deep-link to the provider without a "from" price.
 * - **coordinates** — coordinates that are *present but out of range* quarantine:
 *   real corruption. Coordinates that are *entirely absent* (`null` lat/lng) pass
 *   through with null geo. This is the BRI-163 finding: ~1 in 15 tours resolve to
 *   a Google-provider location with no coordinates at all — a structural gap in
 *   the data source, not bad data, so it must **not** be quarantined for that
 *   reason alone.
 */

/** Valid WGS-84 coordinate bounds. */
export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/** Machine-readable class of a quarantine trigger. */
export type QuarantineReasonCode =
  | "MISSING_TITLE"
  | "NON_POSITIVE_PRICE"
  | "COORDINATES_OUT_OF_RANGE";

/** One reason a tour was quarantined: a stable code plus a human message. */
export interface QuarantineReason {
  code: QuarantineReasonCode;
  message: string;
}

/**
 * Outcome of validating one tour. A discriminated union so callers must handle
 * both arms: `ok: true` passes through, `ok: false` carries every reason it
 * failed (a row can fail more than one rule at once).
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; reasons: QuarantineReason[] };

/**
 * Validate one tour against the quarantine rules. **Pure** — no DB, no clock, no
 * network — so it is deterministic and unit-testable in isolation; persistence
 * and counting are the {@link TourValidator} service's job. Returns every failed
 * rule, not just the first.
 */
export function validateTour(tour: TourDTO): ValidationResult {
  const reasons: QuarantineReason[] = [];

  // Title: absence is fatal (NOT NULL, unusable without it).
  if (tour.title.trim().length === 0) {
    reasons.push({
      code: "MISSING_TITLE",
      message: "Tour has no title.",
    });
  }

  // Price: a present-but-non-positive price is corrupt. A null price is a gap,
  // not corruption — it passes (see the class notes above).
  if (tour.price_minor !== null && tour.price_minor <= 0) {
    reasons.push({
      code: "NON_POSITIVE_PRICE",
      message: `Price must be positive; got ${tour.price_minor}.`,
    });
  }

  // Coordinates: only check a pair that is actually present. Both-null is the
  // legitimate "no coordinates" case (BRI-163) and passes untouched.
  const coordReason = validateCoordinates(tour.latitude, tour.longitude);
  if (coordReason) reasons.push(coordReason);

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * Coordinate rule. Returns a reason only for *corruption*, never for a clean
 * absence:
 * - both `null` → `null` (valid: no coordinates, the BRI-163 pass-through case).
 * - both present, either out of WGS-84 range → out-of-range.
 * - exactly one present → out-of-range: a half-resolved pair is not a valid
 *   coordinate (the resolver always sets both or neither, so this is defensive).
 */
function validateCoordinates(
  latitude: number | null,
  longitude: number | null,
): QuarantineReason | null {
  const bothAbsent = latitude === null && longitude === null;
  if (bothAbsent) return null;

  const bothPresent = latitude !== null && longitude !== null;
  if (!bothPresent) {
    return {
      code: "COORDINATES_OUT_OF_RANGE",
      message: `Incomplete coordinate pair (lat=${latitude}, lng=${longitude}).`,
    };
  }

  const latOk = latitude >= LATITUDE_MIN && latitude <= LATITUDE_MAX;
  const lngOk = longitude >= LONGITUDE_MIN && longitude <= LONGITUDE_MAX;
  if (!latOk || !lngOk) {
    return {
      code: "COORDINATES_OUT_OF_RANGE",
      message:
        `Coordinates out of range (lat=${latitude}, lng=${longitude}); ` +
        `expected lat ∈ [${LATITUDE_MIN}, ${LATITUDE_MAX}], ` +
        `lng ∈ [${LONGITUDE_MIN}, ${LONGITUDE_MAX}].`,
    };
  }

  return null;
}

/** A quarantined row: the full retained payload plus why it was quarantined. */
export interface QuarantineRecord {
  /** The complete tour payload — retained verbatim, never discarded. */
  tour: TourDTO;
  /** Every rule the tour failed. */
  reasons: QuarantineReason[];
}

/**
 * Persistence seam for quarantined rows. The validator depends on this
 * interface, not a concrete backend, so tests inject an in-memory fake and never
 * touch the DB while production wires a Prisma-backed store. A quarantined
 * payload must be **retained** for later review, not dropped.
 */
export interface QuarantineStore {
  save(record: QuarantineRecord): Promise<void>;
}

/**
 * Per-run import counters. ST-10 owns the full `import_run` record; ST-8 only
 * needs to increment these correctly as it processes each tour. Kept as a small
 * mutable tally so a run can thread one instance through the whole batch.
 */
export class ImportRunStats {
  /** Tours quarantined this run. */
  quarantined = 0;
  /** Tours seen this run (passed + quarantined) — the denominator for the above. */
  processed = 0;

  recordPass(): void {
    this.processed += 1;
  }

  recordQuarantine(): void {
    this.processed += 1;
    this.quarantined += 1;
  }
}

/**
 * The validation service: runs {@link validateTour}, and on a quarantine both
 * persists the retained payload+reasons through the {@link QuarantineStore} and
 * increments the per-run counter. Passing tours are counted and returned for the
 * caller (the import orchestrator, ST-10) to proceed with upsert.
 */
export class TourValidator {
  private readonly logger = new Logger(TourValidator.name);

  constructor(private readonly store: QuarantineStore) {}

  /**
   * Validate one tour, recording the outcome into `stats`. On quarantine the
   * payload is persisted before the counter is incremented, so a retained record
   * always exists for anything the counter reflects.
   */
  async process(
    tour: TourDTO,
    stats: ImportRunStats,
  ): Promise<ValidationResult> {
    const result = validateTour(tour);

    if (result.ok) {
      stats.recordPass();
      return result;
    }

    await this.store.save({ tour, reasons: result.reasons });
    stats.recordQuarantine();
    this.logger.warn(
      `Quarantined ${tour.provider}:${tour.provider_tour_id} — ` +
        result.reasons.map((r) => r.code).join(", "),
    );
    return result;
  }
}
