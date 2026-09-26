import type { TourCopyUsage } from "./tour-copy-generator";
import type { JudgeRequest, JudgeResult, JudgeVerdict, TourCopyJudge } from "./tour-copy-judge";
import { TOUR_COPY_JUDGE_MODEL_DEFAULT } from "./tour-copy-eval.constants";

/**
 * In-memory {@link TourCopyJudge} for tests (BRI-201 / spec 0003). Unit and
 * integration specs never make a real model call: they inject this behind the
 * port and script its answer per request.
 */

export const ZERO_USAGE: TourCopyUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function cleanVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    claims: [{ text: "a supported claim", verdict: "supported", evidenceQuote: "quote" }],
    claimVerdict: "clean",
    leadsWithFact: true,
    leadFact: "an opening fact",
    ...overrides,
  };
}

export function unsupportedVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return cleanVerdict({
    claims: [{ text: "an invented claim", verdict: "unsupported", evidenceQuote: "" }],
    claimVerdict: "unsupported",
    ...overrides,
  });
}

export type FakeJudgeResponder = (request: JudgeRequest) => JudgeResult | Promise<JudgeResult>;

export class FakeJudge implements TourCopyJudge {
  readonly calls: JudgeRequest[] = [];

  constructor(
    private readonly responder: FakeJudgeResponder = () => ({ kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE }),
    readonly model: string = TOUR_COPY_JUDGE_MODEL_DEFAULT,
  ) {}

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    this.calls.push(request);
    return this.responder(request);
  }
}
