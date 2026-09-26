/**
 * Code constants for the sampled evaluation, kill switch, spot check and
 * golden set of AI tour copy (BRI-201 / spec 0003). All are starting values,
 * tuned during calibration (build plan task 13). The numbers that belong to
 * one pure function stay next to it instead.
 */

/** The kill switch decides only with at least this many judged rows in a pair (AC-9). */
export const EVAL_MIN_JUDGED = 30;

/** The kill switch withdraws when more than this share of the judged rows is bad (AC-9). */
export const EVAL_MAX_BAD_RATE = 0.05;

/** Stage 1 of a pair's sample: the lowest `Tour.id` served rows, judged in full (AC-7). */
export const EVAL_FIRST_ROWS_FULL = 50;

/** Stage 2: every city gets at least `min(this, served rows in the city)` judged rows (AC-7). */
export const EVAL_CITY_FLOOR = 60;

/** Default size of one human spot check, and the answered rows that count as "a spot check exists" (AC-11, AC-13). */
export const SPOTCHECK_SIZE = 30;

/** Part A of the golden run: the judge must flag at least this share of the planted defects (AC-15). */
export const GOLDEN_RECALL_MIN = 0.9;

/** Part A of the golden run: the judge may flag at most this share of the clean pages (AC-15). */
export const GOLDEN_CLEAN_FLAG_MAX = 0.02;

/** A run warns when more than this share of published rows open on a duration (AC-4, AC-11). */
export const DURATION_OPENING_WARN_SHARE = 0.4;

/** A run warns when fewer than this share of judged pages lead with a fact (AC-11). */
export const LEADS_WITH_FACT_WARN_FLOOR = 0.8;

/** The judge call's output ceiling and timeout (AC-5). */
export const JUDGE_MAX_TOKENS = 1500;
export const JUDGE_REQUEST_TIMEOUT_MS = 90_000;

/**
 * Allowed judge model ids (AC-5). A code constant, like the generator's list,
 * so widening it is a reviewed change and not a config typo. Opus only to
 * start: independence from the Sonnet generator is the point.
 */
export const TOUR_COPY_JUDGE_ALLOWED_MODELS = ["claude-opus-5-5"] as const;

export type TourCopyJudgeModel = (typeof TOUR_COPY_JUDGE_ALLOWED_MODELS)[number];

/** Used when `TOUR_COPY_JUDGE_MODEL` is unset. Also one of the inputs of the golden stamp key (AC-16). */
export const TOUR_COPY_JUDGE_MODEL_DEFAULT: TourCopyJudgeModel = "claude-opus-5-5";

/** Default ceiling on judgments in one eval run, and default concurrency (AC-7, AC-12). */
export const TOUR_COPY_EVAL_MAX_JUDGMENTS_DEFAULT = 500;
export const TOUR_COPY_EVAL_CONCURRENCY_DEFAULT = 4;

/** An eval run stops after this many API errors in a row (AC-12). */
export const EVAL_CIRCUIT_BREAKER_THRESHOLD = 5;
