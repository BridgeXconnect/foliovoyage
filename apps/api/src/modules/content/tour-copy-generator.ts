/**
 * Port for calling a language model to produce one tour's AI copy (BRI-154 /
 * spec 0002). `TourCopyService` depends on this interface, never on a
 * concrete SDK client, so tests substitute a fake and the real
 * implementation (an Anthropic adapter through Cloudflare AI Gateway, build
 * plan task 6) can be swapped in without touching the service. Same
 * DI-token-based shape as the ingest pipeline's `VIATOR_HTTP` /
 * `RAW_ARCHIVE_STORE` (see `modules/import/import-core.module.ts`).
 */

/** DI token for the injected {@link TourCopyGenerator}. */
export const TOUR_COPY_GENERATOR = Symbol("TOUR_COPY_GENERATOR");

/** One model call's request, everything the adapter needs to make it. */
export interface TourCopyGenerationRequest {
  /** The CLI run this call belongs to; sent to the gateway as `run_id` metadata. */
  runId: string;
  /** `Tour.id`; sent to the gateway as `tour_id` metadata. */
  tourId: string;
  /** The grounding hash computed for this attempt; sent as `grounding_hash` metadata. */
  groundingHash: string;
  /** 1 (first attempt) or 2 (the one corrective retry, AC-6); sent as `attempt` metadata. */
  attempt: number;
  /** The fixed system rules (prompt module, build plan task 4). */
  systemPrompt: string;
  /**
   * The user turn: the tour's five grounding fields wrapped in delimited
   * data blocks (task 4), or, on a retry, the fixed corrective sentence for
   * the reason code that failed (AC-6).
   */
  userMessage: string;
}

/** Token accounting for one model call, carried through to the run summary (AC-15). */
export interface TourCopyUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * A call either produces text or the model refuses (`stop_reason: "refusal"`,
 * AC-13) — there is no third outcome the port needs to represent; a
 * transient error or a surviving 429 is a rejected promise, not a result
 * variant (the adapter's error mapping, task 6, decides what's transient).
 */
export type TourCopyGenerationResult =
  | { kind: "text"; text: string; usage: TourCopyUsage }
  | { kind: "refusal"; usage: TourCopyUsage };

export interface TourCopyGenerator {
  generate(request: TourCopyGenerationRequest): Promise<TourCopyGenerationResult>;
}
