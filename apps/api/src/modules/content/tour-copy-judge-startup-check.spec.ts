import { describe, expect, it } from "@jest/globals";

import { TOUR_COPY_JUDGE_MODEL_DEFAULT } from "./tour-copy-eval.constants";
import { TOUR_COPY_MODEL_DEFAULT } from "./tour-copy.constants";
import { TourCopyJudgeStartupError, checkTourCopyJudgeStartup } from "./tour-copy-judge-startup-check";

const VALID_ENV = {
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct123/gw456/anthropic",
  AI_GATEWAY_TOKEN: "token-secret",
  TOUR_COPY_MODEL: undefined,
  TOUR_COPY_JUDGE_MODEL: undefined,
};

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TourCopyJudgeStartupError);
    return (err as Error).message;
  }
  throw new Error("expected checkTourCopyJudgeStartup to throw");
}

describe("checkTourCopyJudgeStartup (spec 0003 AC-5, AC-19)", () => {
  it("resolves the config, defaulting both models, when everything is set", () => {
    expect(checkTourCopyJudgeStartup(VALID_ENV)).toEqual({
      gatewayBaseUrl: VALID_ENV.AI_GATEWAY_BASE_URL,
      gatewayToken: VALID_ENV.AI_GATEWAY_TOKEN,
      generatorModel: TOUR_COPY_MODEL_DEFAULT,
      judgeModel: TOUR_COPY_JUDGE_MODEL_DEFAULT,
    });
  });

  it("names the gateway base URL and token when they are missing", () => {
    const message = messageOf(() =>
      checkTourCopyJudgeStartup({ ...VALID_ENV, AI_GATEWAY_BASE_URL: undefined, AI_GATEWAY_TOKEN: undefined }),
    );
    expect(message).toContain("AI_GATEWAY_BASE_URL is not set");
    expect(message).toContain("AI_GATEWAY_TOKEN is not set");
  });

  it("names the judge model when it is not on the judge allowlist", () => {
    expect(messageOf(() => checkTourCopyJudgeStartup({ ...VALID_ENV, TOUR_COPY_JUDGE_MODEL: "gpt-5" }))).toContain(
      'TOUR_COPY_JUDGE_MODEL "gpt-5" is not on the allowed list',
    );
  });

  it("names the generator model when it is not on the generator allowlist", () => {
    expect(messageOf(() => checkTourCopyJudgeStartup({ ...VALID_ENV, TOUR_COPY_MODEL: "gpt-5" }))).toContain(
      'TOUR_COPY_MODEL "gpt-5" is not on the allowed list',
    );
  });

  it("refuses when the judge and the generator are the same model, naming both ids", () => {
    // Opus is not on 0002's generator allowlist, so the generator problem is reported too.
    const message = messageOf(() =>
      checkTourCopyJudgeStartup({ ...VALID_ENV, TOUR_COPY_MODEL: "claude-opus-5-5", TOUR_COPY_JUDGE_MODEL: "claude-opus-5-5" }),
    );
    expect(message).toContain('The judge model "claude-opus-5-5" is the same as the generator model "claude-opus-5-5"');
  });

  it("reports every problem at once", () => {
    const message = messageOf(() =>
      checkTourCopyJudgeStartup({
        AI_GATEWAY_BASE_URL: undefined,
        AI_GATEWAY_TOKEN: undefined,
        TOUR_COPY_MODEL: "gpt-5",
        TOUR_COPY_JUDGE_MODEL: "gpt-5",
      }),
    );
    expect(message).toContain("AI_GATEWAY_BASE_URL is not set");
    expect(message).toContain("AI_GATEWAY_TOKEN is not set");
    expect(message).toContain('TOUR_COPY_MODEL "gpt-5"');
    expect(message).toContain('TOUR_COPY_JUDGE_MODEL "gpt-5"');
    expect(message).toContain("is the same as the generator model");
  });
});
