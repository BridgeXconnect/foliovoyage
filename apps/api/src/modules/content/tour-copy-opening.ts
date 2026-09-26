import { firstSentence } from "./tour-copy-check";
import { nextTokenIfAdjacent, readNumbers } from "./tour-copy-numbers";

/**
 * Opening pattern of a paragraph (BRI-201 / spec 0003, AC-4). Pure: computed
 * from the first sentence only. `duration` means the first sentence has a
 * number or number word directly followed by a time unit, so a run of
 * paragraphs that all open "The tour runs 90 minutes" is visible in a count
 * instead of only to a reader.
 */

export const OPENING_PATTERNS = ["duration", "other"] as const;
export type OpeningPattern = (typeof OPENING_PATTERNS)[number];

const DURATION_UNITS: readonly string[] = ["minute", "minutes", "hour", "hours", "day", "days"];

export function openingPattern(paragraph: string): OpeningPattern {
  const sentence = firstSentence(paragraph);
  // `one` counts here (unlike the AC-3 check): "One hour on a longtail boat" is a duration opening.
  const hasDuration = readNumbers(sentence, { includeOne: true }).some((reading) => {
    const next = nextTokenIfAdjacent(sentence, reading);
    return next !== null && DURATION_UNITS.includes(next);
  });
  return hasDuration ? "duration" : "other";
}
