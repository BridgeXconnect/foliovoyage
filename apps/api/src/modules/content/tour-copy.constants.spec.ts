import { describe, expect, it } from "@jest/globals";

import { TOUR_COPY_ALLOWED_MODELS, TOUR_COPY_MODEL_DEFAULT } from "./tour-copy.constants";

describe("tour-copy.constants", () => {
  it("pins the allowed model ids (AC-11)", () => {
    expect(TOUR_COPY_ALLOWED_MODELS).toEqual(["claude-sonnet-5", "claude-haiku-4-5-20251001"]);
  });

  it("defaults to claude-sonnet-5, and the default is itself on the allowlist", () => {
    expect(TOUR_COPY_MODEL_DEFAULT).toBe("claude-sonnet-5");
    expect(TOUR_COPY_ALLOWED_MODELS).toContain(TOUR_COPY_MODEL_DEFAULT);
  });
});
