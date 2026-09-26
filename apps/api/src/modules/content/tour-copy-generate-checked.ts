import { checkTourCopy } from "./tour-copy-check";
import { CORRECTIVE_SENTENCES, type TourCopyFailureReason, type VoiceCounterName } from "./tour-copy-check.constants";
import type { TourCopyGenerator } from "./tour-copy-generator";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import { openingPattern, type OpeningPattern } from "./tour-copy-opening";
import { buildTourCopyUserMessage, TOUR_COPY_SYSTEM_PROMPT } from "./tour-copy-prompt";

/**
 * One tour's generate, check and one corrective retry, with no database access
 * (spec 0002 AC-6, extracted from `TourCopyService.generateOne` by spec 0003 so
 * the golden run can grade the current prompt with exactly the loop that
 * publishes real rows, AC-15). The caller decides what to do with the outcome:
 * the service stores it, the golden run only counts it.
 */

export type CheckedGeneration =
  | {
      status: "published";
      text: string;
      /** 1, or 2 when the corrective retry produced the passing text. */
      attempts: number;
      /** The first attempt's check reasons when attempt 2 passed, else empty (AC-6). */
      failureReasons: TourCopyFailureReason[];
      voiceCounts: Record<VoiceCounterName, number>;
      openingPattern: OpeningPattern;
    }
  | { status: "failed"; attempts: number; failureReasons: TourCopyFailureReason[] };

export interface GenerateCheckedRequest {
  runId: string;
  tourId: string;
  groundingHash: string;
}

export async function generateChecked(
  generator: TourCopyGenerator,
  source: TourCopyGroundingInput,
  request: GenerateCheckedRequest,
): Promise<CheckedGeneration> {
  const firstAttempt = await generator.generate({
    ...request,
    attempt: 1,
    systemPrompt: TOUR_COPY_SYSTEM_PROMPT,
    userMessage: buildTourCopyUserMessage(source),
  });

  if (firstAttempt.kind === "refusal") {
    return { status: "failed", attempts: 1, failureReasons: ["refusal"] };
  }

  const firstCheck = checkTourCopy({ candidate: firstAttempt.text, source });
  if (firstCheck.passed) {
    return published(firstAttempt.text, 1, [], firstCheck.voiceCounts);
  }

  // AC-6: exactly one corrective retry, holding one fixed sentence per
  // failed reason code (in the check's closed-set order).
  const secondAttempt = await generator.generate({
    ...request,
    attempt: 2,
    systemPrompt: TOUR_COPY_SYSTEM_PROMPT,
    userMessage: firstCheck.reasons.map((reason) => CORRECTIVE_SENTENCES[reason]).join(" "),
  });

  if (secondAttempt.kind === "refusal") {
    // No check ran on a refusal, same as attempt 1 (AC-13): the reason the
    // row failed is the refusal itself, not whatever the first attempt's
    // check found.
    return { status: "failed", attempts: 2, failureReasons: ["refusal"] };
  }

  const secondCheck = checkTourCopy({ candidate: secondAttempt.text, source });
  if (secondCheck.passed) {
    // AC-6: failureReasons keeps the first attempt's codes even though
    // this paragraph ends up published.
    return published(secondAttempt.text, 2, firstCheck.reasons, secondCheck.voiceCounts);
  }

  // No further retry regardless of outcome (AC-6): the retry's own check
  // result is what a failed row records, it's what's currently wrong.
  return { status: "failed", attempts: 2, failureReasons: secondCheck.reasons };
}

function published(
  text: string,
  attempts: number,
  failureReasons: TourCopyFailureReason[],
  voiceCounts: Record<VoiceCounterName, number>,
): CheckedGeneration {
  return { status: "published", text, attempts, failureReasons, voiceCounts, openingPattern: openingPattern(text) };
}
