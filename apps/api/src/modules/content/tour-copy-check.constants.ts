/**
 * Constants for the deterministic AI tour-copy check (BRI-154 / spec 0002,
 * AC-5). Word lists, thresholds, and reason codes live here — never as
 * inline literals in `tour-copy-check.ts` — so the check's tuning (build
 * plan task 9, calibration) touches one file, and so `tour-copy-prompt.ts`
 * can import the same numbers into the system prompt instead of restating
 * them, which is what keeps the two from silently drifting apart.
 */

/** A generated paragraph must have at least this many sentences (AC-5d). */
export const CHECK_MIN_SENTENCES = 2;
/** A generated paragraph must have at most this many sentences (AC-5d). */
export const CHECK_MAX_SENTENCES = 4;
/** A generated paragraph must have at least this many words (AC-5d). */
export const CHECK_MIN_WORDS = 30;
/** A generated paragraph must have at most this many words (AC-5d). */
export const CHECK_MAX_WORDS = 100;
/**
 * A generated paragraph must share at least this many distinct content
 * words with the source fields, or it fails as `low_overlap` (AC-5e).
 */
export const CHECK_MIN_OVERLAP_WORDS = 8;
/** A token counts as a "content word" for overlap only at this length or longer. */
export const OVERLAP_MIN_WORD_LENGTH = 4;

/**
 * Whole-word price terms (spec "Check details"). Checked case-insensitively
 * with word boundaries. `free` is deliberately excluded: inclusions such as
 * "free hotel pickup" are grounded, not a price claim.
 */
export const PRICE_WORDS = [
  "price",
  "prices",
  "cost",
  "costs",
  "cheap",
  "affordable",
  "fee",
  "fees",
  "dollars",
  "euros",
  "pounds",
  "baht",
  "discount",
] as const;

/** Currency codes, matched as whole words (case-insensitive). */
export const PRICE_CODES = ["USD", "EUR", "GBP", "THB"] as const;

/** Currency symbols, matched anywhere in the text (they are not word characters). */
export const PRICE_SYMBOLS = ["$", "€", "£", "¥", "฿"] as const;

/**
 * Cancellation, refund, and availability words/phrases (spec "Check
 * details"). Matched case-insensitively with word boundaries; a
 * multi-word phrase (e.g. "book now") is matched as that exact phrase.
 */
export const CANCELLATION_PHRASES = [
  "cancel",
  "cancels",
  "cancelled",
  "cancellation",
  "refund",
  "refunds",
  "refundable",
  "reschedule",
  "available",
  "availability",
  "book now",
  "sold out",
  "spots left",
  "seats left",
] as const;

/** Full month names, matched as whole words (case-insensitive) for the date ban. */
export const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/**
 * Sentence-boundary abbreviations: a `.` immediately after one of these
 * words (case-insensitive) is never counted as a sentence end, even when
 * followed by whitespace and a capital letter (e.g. "St. Paul's" is one
 * sentence, not two). Kept intentionally short — this is a guard against a
 * known false-split shape, not a general abbreviation dictionary.
 */
export const SENTENCE_ABBREVIATIONS = ["st", "mr", "mrs", "ms", "dr", "jr", "sr"] as const;

/**
 * A fixed list of about 100 English stopwords, dropped before the overlap
 * check counts distinct content words (spec "Check details"). Common
 * articles, pronouns, prepositions, conjunctions, and auxiliary/modal verbs —
 * words too generic to count as evidence a paragraph is grounded in the
 * specific tour, regardless of length.
 */
export const STOPWORDS = [
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "but", "by", "can", "cannot", "could",
  "did", "do", "does", "doing", "don't", "down", "during", "each", "few",
  "for", "from", "further", "had", "has", "have", "having", "he", "her",
  "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my",
  "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only",
  "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same",
  "she", "should", "so", "some", "such", "than", "that", "the", "their",
  "theirs", "them", "themselves", "then", "there", "these", "they", "this",
  "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "we", "were", "what", "when", "where", "which", "while", "who", "whom",
  "why", "will", "with", "would", "you", "your", "yours", "yourself",
  "yourselves",
] as const;

/**
 * The blocking reason codes the check itself can produce (AC-5a–e). A
 * strict subset of {@link TOUR_COPY_FAILURE_REASON_CODES}: `refusal` and
 * `source_too_thin` are also closed-set failure reasons, but they are
 * decided elsewhere (the adapter's `stop_reason` handling, and the
 * pre-generation thin-source rule), never by this check.
 */
export const TOUR_COPY_CHECK_REASON_CODES = [
  "price_language",
  "cancellation_language",
  "unsourced_number",
  "sentence_count",
  "word_count",
  "low_overlap",
] as const;

export type TourCopyCheckReasonCode = (typeof TOUR_COPY_CHECK_REASON_CODES)[number];

/**
 * The full closed set of reason codes a `TourCopy.failureReasons` entry can
 * hold (AC-5): the six check reasons above, plus `refusal` (a model refusal,
 * AC-13) and `source_too_thin` (the pre-generation skip rule, AC-1). Kept
 * here, next to the check reasons it extends, as the one place that
 * enumerates the whole closed set.
 */
export const TOUR_COPY_FAILURE_REASON_CODES = [
  ...TOUR_COPY_CHECK_REASON_CODES,
  "refusal",
  "source_too_thin",
] as const;

export type TourCopyFailureReason = (typeof TOUR_COPY_FAILURE_REASON_CODES)[number];

/**
 * One fixed corrective sentence per checkable reason code (spec "Check
 * details"), sent as the second user turn on the one corrective retry
 * (AC-6, wired in build plan task 7). Not defined for `refusal` or
 * `source_too_thin`: a refusal is never retried (AC-13), and a
 * `source_too_thin` tour never reaches generation at all.
 */
export const CORRECTIVE_SENTENCES: Record<TourCopyCheckReasonCode, string> = {
  price_language:
    "Your last answer mentioned a price, cost, or currency. Rewrite it with no price, cost, or currency language of any kind.",
  cancellation_language:
    "Your last answer mentioned cancellation, refund, or availability. Rewrite it with no cancellation, refund, or availability language of any kind.",
  unsourced_number:
    "Your last answer contained a number that is not in the tour data. Rewrite it using only facts from the tour data.",
  sentence_count: `Your last answer was not ${CHECK_MIN_SENTENCES} to ${CHECK_MAX_SENTENCES} sentences. Rewrite it as ${CHECK_MIN_SENTENCES} to ${CHECK_MAX_SENTENCES} sentences.`,
  word_count: `Your last answer was not ${CHECK_MIN_WORDS} to ${CHECK_MAX_WORDS} words. Rewrite it to be ${CHECK_MIN_WORDS} to ${CHECK_MAX_WORDS} words.`,
  low_overlap:
    "Your last answer did not describe this specific tour closely enough. Rewrite it using specific details from the tour data provided.",
};

/**
 * Non-blocking voice patterns from `docs/08-brand-voice-style-guide.md`,
 * counted and logged (AC-15) but never a check failure — style is judged in
 * aggregate by BRI-201, not per paragraph.
 */
export const VOICE_COUNTER_NAMES = ["emDash", "contrastiveReveal", "clicheOrIntensifier"] as const;
export type VoiceCounterName = (typeof VOICE_COUNTER_NAMES)[number];

/** docs/08 line 16: stacked intensifiers, cut on sight. */
export const STACKED_INTENSIFIER_TERMS = [
  "truly",
  "genuinely",
  "incredibly",
  "utterly",
  "the perfect blend of",
] as const;

/** docs/08 line 17: generic travel-blog clichés. */
export const CLICHE_TERMS = [
  "hidden gem",
  "off the beaten path",
  "bustling",
  "nestled",
  "hustle and bustle",
  "a stone's throw",
  "breathtaking",
  "must-see",
  "bucket list",
] as const;
