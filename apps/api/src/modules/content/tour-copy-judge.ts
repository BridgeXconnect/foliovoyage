import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import type { TourCopyUsage } from "./tour-copy-generator";

/**
 * Port for judging one published tour paragraph against its source fields
 * (BRI-201 / spec 0003, AC-5). `TourCopyEvalService` depends on this
 * interface, never on an SDK client, so tests substitute a fake and the
 * Anthropic adapter (`tour-copy-anthropic-judge.ts`) can be swapped without
 * touching the service. Same DI-token shape as `TOUR_COPY_GENERATOR`.
 */

/** DI token for the injected {@link TourCopyJudge}. */
export const TOUR_COPY_JUDGE = Symbol("TOUR_COPY_JUDGE");

/** The kinds of content the rubric registry knows (AC-17). Only `tour_copy` is filled in. */
export type JudgeContentType = "tour_copy";

export type JudgeClaimVerdict = "supported" | "unsupported" | "contradicted";

/** One claim as stored in `TourCopyEval.claims`. `downgraded` is only ever present as `true`. */
export interface JudgedClaim {
  text: string;
  verdict: JudgeClaimVerdict;
  evidenceQuote: string;
  downgraded?: true;
}

/** Worst claim on the page: `contradicted` beats `unsupported` beats `clean` (AC-6). */
export type PageVerdict = "clean" | "unsupported" | "contradicted";

/** A validated judge result, ready to store. */
export interface JudgeVerdict {
  claims: JudgedClaim[];
  claimVerdict: PageVerdict;
  leadsWithFact: boolean;
  leadFact: string | null;
}

export interface JudgeRequest {
  contentType: JudgeContentType;
  /** The CLI run this call belongs to; sent to the gateway as `run_id` metadata. */
  runId: string;
  /** `Tour.id`; sent as `tour_id` metadata. */
  tourId: string;
  /** The grounding hash of the copy being judged; sent as `grounding_hash` metadata. */
  groundingHash: string;
  /** The tour's five current grounding fields. */
  source: TourCopyGroundingInput;
  /** The published paragraph. */
  paragraph: string;
}

/**
 * A call ends in a stored verdict, a refusal (`stop_reason: "refusal"`,
 * `judge_refusal`), or a result that stayed invalid after the one retry
 * (`judge_invalid`). A transient error or a surviving 429 is a rejected
 * promise, not a result variant, same as the generator port.
 */
export type JudgeResult =
  | { kind: "verdict"; verdict: JudgeVerdict; usage: TourCopyUsage; attempts?: JudgeAttempt[] }
  | { kind: "refusal"; usage: TourCopyUsage; attempts?: JudgeAttempt[] }
  | { kind: "invalid"; usage: TourCopyUsage; attempts?: JudgeAttempt[] };

/**
 * How one model call inside a `judge()` ended. For logging only, nothing
 * decides on it: `max_tokens` is a stop that cut the answer off (the worry is
 * thinking tokens eating the cap), `no_text` is an answer with no text block,
 * `unparseable` is text that is not JSON, `schema_invalid` is JSON that fails
 * the verdict checks.
 */
export type JudgeAttemptOutcome = "ok" | "max_tokens" | "no_text" | "unparseable" | "schema_invalid" | "refusal";

export interface JudgeAttempt {
  outcome: JudgeAttemptOutcome;
  outputTokens: number;
}

export interface TourCopyJudge {
  /** The model id that makes the calls; stored on every verdict as `evaluatorModel`. */
  readonly model: string;
  judge(request: JudgeRequest): Promise<JudgeResult>;
}
