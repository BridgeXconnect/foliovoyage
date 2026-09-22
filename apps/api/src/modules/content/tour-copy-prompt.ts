/**
 * Fixed system prompt and user-message builder for AI tour copy (BRI-154 /
 * spec 0002, AC-2). Pure string builders — no model or gateway call here
 * (that's the adapter, build plan task 6). The numeric limits below are
 * interpolated from `tour-copy-check.constants.ts` rather than restated, so
 * the prompt and the check that grades its output can never quietly drift
 * apart (`tour-copy-prompt.spec.ts` asserts this directly).
 *
 * Deliberately excludes `docs/08-brand-voice-style-guide.md` line 24 (a price
 * example) and line 27 (Roy's firsthand Bangkok knowledge) and its
 * calibration example (Bangkok Airport Rail Link / Suvarnabhumi / Phaya
 * Thai) — none of the three describes something tour fields can support
 * (index.md's Follow-up list; rationale.md context note 5).
 */

import {
  CANCELLATION_PHRASES,
  CHECK_MAX_SENTENCES,
  CHECK_MAX_WORDS,
  CHECK_MIN_SENTENCES,
  CHECK_MIN_WORDS,
  CLICHE_TERMS,
  PRICE_WORDS,
  STACKED_INTENSIFIER_TERMS,
} from "./tour-copy-check.constants";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import { checklistText } from "./tour-copy-source-text";

const DATA_BLOCK_START = "<tour_data>";
const DATA_BLOCK_END = "</tour_data>";

function serializeChecklist(value: unknown): string {
  const text = checklistText(value);
  return text.length > 0 ? text : "(none)";
}

/** The tour's five grounding fields wrapped in delimited data blocks (AC-2, AC-13). */
export function buildTourCopyUserMessage(source: TourCopyGroundingInput): string {
  return [
    DATA_BLOCK_START,
    `Title: ${source.title}`,
    `Description: ${source.description ?? "(none)"}`,
    `Duration (minutes): ${source.durationMin ?? "(unknown)"}`,
    `Inclusions: ${serializeChecklist(source.inclusions)}`,
    `Exclusions: ${serializeChecklist(source.exclusions)}`,
    DATA_BLOCK_END,
  ].join("\n");
}

/**
 * A fixed few-shot example built from mock, in-schema field values — never
 * real tour data, and never the `docs/08` Bangkok/BTS calibration example.
 */
export const TOUR_COPY_EXAMPLE_SOURCE: TourCopyGroundingInput = {
  title: "Hoi An Lantern-Making Workshop",
  description:
    "Learn traditional Vietnamese lantern craft from a local artisan family, shaping bamboo frames and stretching silk panels before lighting your finished piece to take home.",
  durationMin: 75,
  inclusions: [{ categoryDescription: "Materials", typeDescription: "Included", description: "Bamboo frame, silk, and glue" }],
  exclusions: [{ categoryDescription: "Food and drinks", typeDescription: "Not included", description: null }],
};

export const TOUR_COPY_EXAMPLE_OUTPUT =
  "The workshop runs about 75 minutes, most of it spent shaping a bamboo frame before stretching silk panels across it under an artisan's guidance. " +
  "You cut, glue, and stretch the silk yourself, then watch the frame take its shape as the family explains each fold. " +
  "Materials are provided, so you leave with a finished lantern built entirely by hand.";

export const TOUR_COPY_SYSTEM_PROMPT = `You write one short paragraph of destination-guide copy for a single bookable tour, in English, for Folio Voyage.

Use only the tour data given to you between ${DATA_BLOCK_START} and ${DATA_BLOCK_END} tags. Do not use any other knowledge about the destination, the operator, or the world. If the tour data does not say something, do not say it either.

Hard limits, checked mechanically after you answer:
- ${CHECK_MIN_SENTENCES} to ${CHECK_MAX_SENTENCES} sentences, ${CHECK_MIN_WORDS} to ${CHECK_MAX_WORDS} words total.
- No number, month name, or year that is not written in the tour data. Do not invent or infer a number, even a plausible one.
- No price, cost, currency, discount, or affordability language of any kind (words like ${PRICE_WORDS.slice(0, 4).join(", ")}, or a currency symbol or code).
- No cancellation, refund, reschedule, or availability language of any kind (words like ${CANCELLATION_PHRASES.slice(0, 4).join(", ")}).
- Plain prose only: no headings, no bullet points, no markdown, no quotation marks around the whole thing.

Open the paragraph on one specific, checkable fact from the tour data — a duration, a material, a place named in the description, something a reader could verify — never an adjective and never a scene-setting generalization like "nestled" or "a sensory experience."

Cut these patterns on sight, they read as AI-generated:
- Em dashes: at most one in the whole paragraph. Prefer a comma or a full stop.
- The contrastive-reveal construction: "It's not just X — it's Y" / "This isn't about X, it's about Y." Never use this construction.
- "Whether you're X or Y" framings.
- Stacked intensifiers: ${STACKED_INTENSIFIER_TERMS.join(", ")}.
- Generic travel-blog clichés: ${CLICHE_TERMS.join(", ")}.
- "Come for X, stay for Y" — never use this formula.
- Rule-of-three overuse, and five sentences in a row with the same length and structure. Vary the rhythm; a short blunt sentence is allowed.

Example:
${buildTourCopyUserMessage(TOUR_COPY_EXAMPLE_SOURCE)}
Example output: ${TOUR_COPY_EXAMPLE_OUTPUT}

Respond with the paragraph only, nothing else.`;
