/**
 * Deterministic pass/fail check for AI-generated tour copy (BRI-154 / spec
 * 0002, AC-5). Pure function: candidate text + the same five grounding
 * fields the hash covers in, a reason-coded verdict out. No DB/network/clock
 * access, and no knowledge of retries or the generator — this is the last
 * gate between a generation and a published page, so it is tested standalone
 * before anything wires a retry loop around it (build plan task 7).
 *
 * Evaluates every rule and collects every failing reason, the same
 * "don't short-circuit" shape as `tour-copy-eligibility.ts`, so a caller
 * logging a failed generation sees everything wrong with it at once.
 */

import {
  CANCELLATION_PHRASES,
  CHECK_MAX_SENTENCES,
  CHECK_MAX_WORDS,
  CHECK_MIN_OVERLAP_WORDS,
  CHECK_MIN_SENTENCES,
  CHECK_MIN_WORDS,
  CLICHE_TERMS,
  MONTH_NAMES,
  OVERLAP_MIN_WORD_LENGTH,
  PRICE_CODES,
  PRICE_SYMBOLS,
  PRICE_WORDS,
  SENTENCE_ABBREVIATIONS,
  STACKED_INTENSIFIER_TERMS,
  STOPWORDS,
  TOUR_COPY_CHECK_REASON_CODES,
  type TourCopyCheckReasonCode,
  type VoiceCounterName,
} from "./tour-copy-check.constants";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import { checklistText } from "./tour-copy-source-text";

export interface TourCopyCheckInput {
  candidate: string;
  source: TourCopyGroundingInput;
}

export interface TourCopyCheckResult {
  passed: boolean;
  reasons: TourCopyCheckReasonCode[];
  voiceCounts: Record<VoiceCounterName, number>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAnyPhrase(textLower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => new RegExp(`\\b${escapeRegExp(phrase.toLowerCase())}\\b`, "i").test(textLower));
}

function countOccurrences(textLower: string, phrase: string): number {
  const matches = textLower.match(new RegExp(`\\b${escapeRegExp(phrase.toLowerCase())}\\b`, "gi"));
  return matches?.length ?? 0;
}

function hasPriceLanguage(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  if (containsAnyPhrase(lower, PRICE_WORDS)) return true;
  if (containsAnyPhrase(lower, PRICE_CODES)) return true;
  return PRICE_SYMBOLS.some((symbol) => candidate.includes(symbol));
}

function hasCancellationLanguage(candidate: string): boolean {
  return containsAnyPhrase(candidate.toLowerCase(), CANCELLATION_PHRASES);
}

function extractDigitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * Digit runs a candidate may use without being "unsourced": anything that
 * appears verbatim in the source text, plus every unit-equivalent rendering
 * of `durationMin` (e.g. 90 -> "90", "1" hour, "30" minutes, and the "5" in
 * "1.5" hours when the remainder is a half hour) — never a raw substring
 * match against the stored integer, which would reject the happy path.
 */
function allowedDigitRuns(source: TourCopyGroundingInput, sourceText: string): Set<string> {
  const allowed = new Set(extractDigitRuns(sourceText));
  if (source.durationMin != null) {
    const total = source.durationMin;
    allowed.add(String(total));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours > 0) allowed.add(String(hours));
    if (minutes !== 0) allowed.add(String(minutes));
    if (minutes === 30) allowed.add("5");
  }
  return allowed;
}

function hasUnsourcedDigitRun(candidate: string, allowed: Set<string>): boolean {
  return extractDigitRuns(candidate).some((run) => !allowed.has(run));
}

/** A month name is allowed only when the same month name is in the source (AC-5c). */
function hasUnsourcedMonth(candidateLower: string, sourceTextLower: string): boolean {
  return MONTH_NAMES.some((month) => {
    const re = new RegExp(`\\b${month}\\b`, "i");
    return re.test(candidateLower) && !re.test(sourceTextLower);
  });
}

/**
 * A sentence boundary is a letter run followed by `.`/`!`/`?`, whitespace,
 * then a capital letter. A decimal like "2.5" never matches: there is no
 * whitespace between the digits and the period. An abbreviation like "St."
 * does match the shape, so it is excluded by checking the word immediately
 * before the punctuation against {@link SENTENCE_ABBREVIATIONS}.
 */
function countSentences(text: string): number {
  const boundaryPattern = /\b([A-Za-z]+)[.!?]\s+(?=[A-Z])/g;
  let boundaries = 0;
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    if (!(SENTENCE_ABBREVIATIONS as readonly string[]).includes(word)) {
      boundaries++;
    }
  }
  return boundaries + 1;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Distinct, non-stopword tokens of at least {@link OVERLAP_MIN_WORD_LENGTH} letters. */
function contentWords(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const words = new Set<string>();
  for (const token of tokens) {
    if (token.length >= OVERLAP_MIN_WORD_LENGTH && !(STOPWORDS as readonly string[]).includes(token)) {
      words.add(token);
    }
  }
  return words;
}

function overlapCount(candidate: string, sourceText: string): number {
  const candidateWords = contentWords(candidate);
  const sourceWords = contentWords(sourceText);
  let count = 0;
  for (const word of candidateWords) {
    if (sourceWords.has(word)) count++;
  }
  return count;
}

function countEmDash(text: string): number {
  return (text.match(/—/g) ?? []).length;
}

/**
 * docs/08's contrastive-reveal shapes: "isn't just X, it's Y" (line 14) and
 * "come for X, stay for Y" (line 20). Counted, never blocking (AC-15).
 */
function countContrastiveReveal(textLower: string): number {
  let count = 0;
  if (/\bisn't just\b[\s\S]*?\bit's\b/.test(textLower)) count++;
  if (/\bcome for\b[\s\S]*?\bstay for\b/.test(textLower)) count++;
  return count;
}

function countClicheOrIntensifier(textLower: string): number {
  let count = 0;
  for (const term of [...STACKED_INTENSIFIER_TERMS, ...CLICHE_TERMS]) {
    count += countOccurrences(textLower, term);
  }
  return count;
}

export function checkTourCopy(input: TourCopyCheckInput): TourCopyCheckResult {
  const { candidate, source } = input;
  const sourceText = [source.title, source.description ?? "", checklistText(source.inclusions), checklistText(source.exclusions)].join(
    " ",
  );
  const sourceTextLower = sourceText.toLowerCase();
  const candidateLower = candidate.toLowerCase();

  const reasons: TourCopyCheckReasonCode[] = [];

  if (hasPriceLanguage(candidate)) reasons.push("price_language");
  if (hasCancellationLanguage(candidate)) reasons.push("cancellation_language");

  const allowedDigits = allowedDigitRuns(source, sourceText);
  if (hasUnsourcedDigitRun(candidate, allowedDigits) || hasUnsourcedMonth(candidateLower, sourceTextLower)) {
    reasons.push("unsourced_number");
  }

  const sentences = countSentences(candidate);
  if (sentences < CHECK_MIN_SENTENCES || sentences > CHECK_MAX_SENTENCES) {
    reasons.push("sentence_count");
  }

  const words = countWords(candidate);
  if (words < CHECK_MIN_WORDS || words > CHECK_MAX_WORDS) {
    reasons.push("word_count");
  }

  if (overlapCount(candidate, sourceText) < CHECK_MIN_OVERLAP_WORDS) {
    reasons.push("low_overlap");
  }

  const voiceCounts: Record<VoiceCounterName, number> = {
    emDash: countEmDash(candidate),
    contrastiveReveal: countContrastiveReveal(candidateLower),
    clicheOrIntensifier: countClicheOrIntensifier(candidateLower),
  };

  // Preserve the closed set's declared order regardless of evaluation order above.
  const orderedReasons = TOUR_COPY_CHECK_REASON_CODES.filter((code) => reasons.includes(code));

  return { passed: orderedReasons.length === 0, reasons: orderedReasons, voiceCounts };
}
