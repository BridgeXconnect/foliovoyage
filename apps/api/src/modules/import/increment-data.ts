import type { ImportRunCounts } from "./import.pipeline";

/**
 * Increment expressions for one segment's counts, safe to apply repeatedly
 * (BRI-176) -- pulled out of `segment-worker.cli.ts` into its own module so it
 * can be unit-tested without triggering that file's unconditional top-level
 * `void main()` bootstrap.
 *
 * `cursor` is always written, even `null` -- that's how a segment signals
 * "the crawl reached its true end, no more segments needed" (see
 * `ImportPipeline.runSegment`). `lastPage` and `lastCursor` are guarded:
 * omitted entirely when this segment's own counts never set them, so an
 * update that only ran a segment with no progress on that front (e.g. its
 * only page was already the crawl's terminal page) doesn't clobber a value
 * an earlier segment already persisted on the row.
 */
export function incrementData(counts: ImportRunCounts) {
  return {
    fetched: { increment: counts.fetched },
    normalized: { increment: counts.normalized },
    quarantined: { increment: counts.quarantined },
    upserted: { increment: counts.upserted },
    cursor: counts.cursor,
    ...(counts.lastPage !== null ? { lastPage: counts.lastPage } : {}),
    ...(counts.lastCursor !== null ? { lastCursor: counts.lastCursor } : {}),
  };
}
