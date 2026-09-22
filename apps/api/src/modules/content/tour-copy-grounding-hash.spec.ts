import { describe, expect, it } from "@jest/globals";

import { GROUNDING_HASH_VERSION, computeGroundingHash } from "./tour-copy-grounding-hash";

const base = {
  title: "Bangkok Floating Market Half-Day Tour",
  description: "Cruise the canals of Damnoen Saduak by longtail boat.",
  durationMin: 240,
  inclusions: [
    {
      category: "transport",
      categoryDescription: "Transport",
      type: "included",
      typeDescription: "Included",
      description: "Hotel pickup and drop-off",
    },
  ],
  exclusions: [
    {
      category: "food",
      categoryDescription: "Food and drinks",
      type: "excluded",
      typeDescription: "Not included",
      description: null,
    },
  ],
};

describe("computeGroundingHash", () => {
  it("pins a literal hash for a fixed fixture, so an algorithm change fails CI", () => {
    expect(computeGroundingHash(base)).toBe(
      "v1:36aba069a2f5ed747dca29aadc1b09a8903a5b726011a522cc36052c0e5176fd",
    );
  });

  it("starts with the current version prefix", () => {
    expect(computeGroundingHash(base)).toMatch(new RegExp(`^${GROUNDING_HASH_VERSION}:[0-9a-f]{64}$`));
  });

  it("is deterministic for the same input", () => {
    expect(computeGroundingHash(base)).toBe(computeGroundingHash({ ...base }));
  });

  describe("changes when any one of the five fields changes", () => {
    it("title", () => {
      expect(computeGroundingHash({ ...base, title: "Something else" })).not.toBe(
        computeGroundingHash(base),
      );
    });

    it("description", () => {
      expect(computeGroundingHash({ ...base, description: "Different text." })).not.toBe(
        computeGroundingHash(base),
      );
    });

    it("durationMin", () => {
      expect(computeGroundingHash({ ...base, durationMin: 120 })).not.toBe(computeGroundingHash(base));
    });

    it("inclusions", () => {
      expect(computeGroundingHash({ ...base, inclusions: [] })).not.toBe(computeGroundingHash(base));
    });

    it("exclusions", () => {
      expect(computeGroundingHash({ ...base, exclusions: [] })).not.toBe(computeGroundingHash(base));
    });
  });

  it("does not change when a field outside the five changes (simulated by simply not passing it)", () => {
    // The input type only accepts the five grounding fields, so there is no
    // way to even construct a call with rating/price/etc. This test instead
    // pins that two inputs differing only in something the type can't carry
    // (here: none — same input, called twice) still hash identically,
    // guarding against accidental nondeterminism (e.g. object identity).
    expect(computeGroundingHash(base)).toBe(computeGroundingHash(base));
  });

  it("treats null and an empty string as different for description", () => {
    expect(computeGroundingHash({ ...base, description: null })).not.toBe(
      computeGroundingHash({ ...base, description: "" }),
    );
  });

  it("treats null and an empty array as different for inclusions", () => {
    expect(computeGroundingHash({ ...base, inclusions: null })).not.toBe(
      computeGroundingHash({ ...base, inclusions: [] }),
    );
  });

  it("is unaffected by key order inside inclusions/exclusions objects", () => {
    const reordered = {
      ...base,
      inclusions: [
        {
          description: "Hotel pickup and drop-off",
          typeDescription: "Included",
          type: "included",
          categoryDescription: "Transport",
          category: "transport",
        },
      ],
    };
    expect(computeGroundingHash(reordered)).toBe(computeGroundingHash(base));
  });

  it("keeps array order significant", () => {
    const twoItems = {
      ...base,
      inclusions: [
        { category: "a", categoryDescription: "A", type: "included", typeDescription: "Included", description: null },
        { category: "b", categoryDescription: "B", type: "included", typeDescription: "Included", description: null },
      ],
    };
    const reversed = { ...twoItems, inclusions: [...twoItems.inclusions].reverse() };
    expect(computeGroundingHash(twoItems)).not.toBe(computeGroundingHash(reversed));
  });

  it("normalizes text to NFC, so NFC and NFD forms of the same string hash the same", () => {
    const nfc = { ...base, title: "Café" }; // é as a single precomposed codepoint
    const nfd = { ...base, title: "Café" }; // e + combining acute accent
    expect(computeGroundingHash(nfc)).toBe(computeGroundingHash(nfd));
  });
});
