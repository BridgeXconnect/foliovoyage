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
export const TOUR_COPY_PROMPT_VERSION = 2;

/**
 * Allowed Anthropic model ids for tour-copy generation (AC-11). A code
 * constant, not an env var, so the set of models the feature will ever call
 * stays an explicit, reviewed decision rather than something a config typo
 * could widen. `TOUR_COPY_MODEL` (env, `env.validation.ts`) picks which one
 * of these to use; the CLI's startup check (`tour-copy-startup-check.ts`,
 * AC-19) rejects anything not on this list before any model call.
 */
export const TOUR_COPY_ALLOWED_MODELS = [
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
] as const;

export type TourCopyModel = (typeof TOUR_COPY_ALLOWED_MODELS)[number];

/** Used when `TOUR_COPY_MODEL` is unset. */
export const TOUR_COPY_MODEL_DEFAULT: TourCopyModel = "claude-sonnet-5";

/**
 * Rough characters-per-token divisor for the CLI's dry-run token estimate
 * (AC-8). Not a pricing mechanism — the ledger and its per-model price table
 * are gone, so a dry run reports this rough estimate only, never a dollar
 * figure.
 */
export const CHARS_PER_TOKEN = 3.1;
