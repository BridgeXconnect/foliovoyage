/**
 * Code constants for AI tour-copy generation (BRI-154 / spec 0002) that more
 * than one module needs (the service, the prompt module, the CLI), collected
 * here so none of them has to import from another for a shared number.
 * Constants that belong to one pure function stay next to it instead:
 * `MIN_REVIEW_COUNT`/`MIN_RATING` in `tour-copy-eligibility.ts`,
 * `MIN_SOURCE_CHARS` in `tour-copy-source-text.ts`.
 */

/**
 * Bumped whenever the system prompt text changes (see the spec's "Key
 * invariants"). A `TourCopy` row's `promptVersion` records which version
 * produced it, so `--regenerate-older-than-version` can find rows worth
 * regenerating without a hash change.
 */
export const TOUR_COPY_PROMPT_VERSION = 1;
