import { describe, expect, it } from "@jest/globals";

import { combinedSourceTextLength, MIN_SOURCE_CHARS } from "./tour-copy-source-text";

describe("combinedSourceTextLength", () => {
  it("sums title, description, and checklist text", () => {
    const length = combinedSourceTextLength({
      title: "Bangkok Floating Market Tour", // 28
      description: "Cruise the canals by longtail boat.", // 35
      inclusions: [
        {
          category: "transport",
          categoryDescription: "Transport", // 9
          type: "included",
          typeDescription: "Included", // 8
          description: "Hotel pickup and drop-off", // 25
        },
      ],
      exclusions: [],
    });
    // +2 for the two spaces joining the one item's three fields.
    expect(length).toBe(28 + 35 + 9 + 8 + 25 + 2);
  });

  it("treats a null description as empty, not as text", () => {
    const length = combinedSourceTextLength({
      title: "Short Title",
      description: null,
      inclusions: [],
      exclusions: [],
    });
    expect(length).toBe("Short Title".length);
  });

  it("treats non-array inclusions/exclusions (null, malformed) as no text", () => {
    expect(
      combinedSourceTextLength({
        title: "T",
        description: "D",
        inclusions: null,
        exclusions: "not an array",
      }),
    ).toBe(2);
  });

  it("skips non-string and missing fields inside a checklist item", () => {
    const length = combinedSourceTextLength({
      title: "",
      description: null,
      inclusions: [{ category: "x", categoryDescription: 42, description: null }],
      exclusions: [],
    });
    expect(length).toBe(0);
  });

  it("is below MIN_SOURCE_CHARS for a title-only tour, and at or above it for a fuller one", () => {
    const thin = combinedSourceTextLength({
      title: "A Short Tour",
      description: null,
      inclusions: [],
      exclusions: [],
    });
    expect(thin).toBeLessThan(MIN_SOURCE_CHARS);

    const full = combinedSourceTextLength({
      title: "A Short Tour",
      description: "x".repeat(MIN_SOURCE_CHARS),
      inclusions: [],
      exclusions: [],
    });
    expect(full).toBeGreaterThanOrEqual(MIN_SOURCE_CHARS);
  });
});
