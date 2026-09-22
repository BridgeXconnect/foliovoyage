import { describe, expect, it } from "@jest/globals";

import { TOUR_COPY_MODEL_DEFAULT } from "./tour-copy.constants";
import { TourCopyStartupError, checkTourCopyStartup } from "./tour-copy-startup-check";

const VALID_ENV = {
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct123/gw456/anthropic",
  AI_GATEWAY_TOKEN: "token-secret",
  TOUR_COPY_MODEL: undefined,
};

describe("checkTourCopyStartup", () => {
  it("resolves the config, defaulting the model, when everything is set", () => {
    expect(checkTourCopyStartup(VALID_ENV)).toEqual({
      gatewayBaseUrl: VALID_ENV.AI_GATEWAY_BASE_URL,
      gatewayToken: VALID_ENV.AI_GATEWAY_TOKEN,
      model: TOUR_COPY_MODEL_DEFAULT,
    });
  });

  it("passes through an explicit allowed model", () => {
    const result = checkTourCopyStartup({ ...VALID_ENV, TOUR_COPY_MODEL: "claude-haiku-4-5-20251001" });
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });

  it("throws naming the gateway base URL when it is missing", () => {
    expect(() => checkTourCopyStartup({ ...VALID_ENV, AI_GATEWAY_BASE_URL: undefined })).toThrow(
      /AI_GATEWAY_BASE_URL is not set/,
    );
  });

  it("throws naming the gateway token when it is missing", () => {
    expect(() => checkTourCopyStartup({ ...VALID_ENV, AI_GATEWAY_TOKEN: undefined })).toThrow(
      /AI_GATEWAY_TOKEN is not set/,
    );
  });

  it("throws naming the model when it is not on the allowlist", () => {
    expect(() => checkTourCopyStartup({ ...VALID_ENV, TOUR_COPY_MODEL: "gpt-5" })).toThrow(
      /TOUR_COPY_MODEL "gpt-5" is not on the allowed list/,
    );
  });

  it("reports every problem at once, not just the first", () => {
    try {
      checkTourCopyStartup({ AI_GATEWAY_BASE_URL: undefined, AI_GATEWAY_TOKEN: undefined, TOUR_COPY_MODEL: "gpt-5" });
      throw new Error("expected checkTourCopyStartup to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TourCopyStartupError);
      const message = (err as Error).message;
      expect(message).toContain("AI_GATEWAY_BASE_URL is not set");
      expect(message).toContain("AI_GATEWAY_TOKEN is not set");
      expect(message).toContain('TOUR_COPY_MODEL "gpt-5" is not on the allowed list');
    }
  });

  it("exits non zero before any database connection or model call (pure, throws synchronously)", () => {
    expect(() => checkTourCopyStartup({ AI_GATEWAY_BASE_URL: undefined, AI_GATEWAY_TOKEN: undefined, TOUR_COPY_MODEL: undefined })).toThrow(
      TourCopyStartupError,
    );
  });
});
