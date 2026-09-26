import { describe, expect, it, jest } from "@jest/globals";

import { CORRECTIVE_SENTENCES } from "./tour-copy-check.constants";
import { generateChecked } from "./tour-copy-generate-checked";
import type { TourCopyGenerationRequest, TourCopyGenerationResult, TourCopyGenerator } from "./tour-copy-generator";
import { TOUR_COPY_SYSTEM_PROMPT } from "./tour-copy-prompt";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

const SOURCE = {
  title: "Bangkok Floating Market Half-Day Tour",
  description:
    "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. Your guide points out colorful stalls selling tropical fruit, fragrant spices, and handmade crafts along the water. Afterward, wander through a quiet riverside temple before returning to your hotel in the city center. This small-group tour captures everyday local life away from the busy streets of Bangkok.",
  durationMin: 240,
  inclusions: [] as unknown[],
  exclusions: [] as unknown[],
};

const REQUEST = { runId: "run_1", tourId: "tour_1", groundingHash: "v1:abc" };

const PASSING =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. A local guide points out colorful stalls selling tropical fruit and fragrant spices along the water, then leads you through a quiet riverside temple. This small-group tour captures everyday local life away from the busy streets.";
const DURATION_OPENING =
  "The trip runs 240 minutes on a longtail boat through the historic floating markets of Bangkok. A local guide points out colorful stalls selling tropical fruit and fragrant spices along the water, then leads you through a quiet riverside temple. This small-group tour captures everyday local life away from the busy streets.";
const SPELLED_NUMBER =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. A local guide points out colorful stalls selling tropical fruit and fragrant spices along the water, then leads you through a quiet riverside temple with twenty five other visitors. This small-group tour captures everyday local life away from the busy streets.";

function generatorOf(...results: TourCopyGenerationResult[]) {
  const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();
  for (const result of results) generate.mockResolvedValueOnce(result);
  const generator: TourCopyGenerator = { generate };
  return { generator, generate };
}

describe("generateChecked", () => {
  it("publishes a passing first attempt with counters and the opening pattern", async () => {
    const { generator, generate } = generatorOf({ kind: "text", text: PASSING, usage: USAGE });

    const result = await generateChecked(generator, SOURCE, REQUEST);

    expect(result).toEqual({
      status: "published",
      text: PASSING,
      attempts: 1,
      failureReasons: [],
      voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 },
      openingPattern: "other",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ ...REQUEST, attempt: 1, systemPrompt: TOUR_COPY_SYSTEM_PROMPT }),
    );
  });

  it("reads a duration opening", async () => {
    const { generator } = generatorOf({ kind: "text", text: DURATION_OPENING, usage: USAGE });
    expect(await generateChecked(generator, SOURCE, REQUEST)).toMatchObject({ openingPattern: "duration" });
  });

  it("retries once with the corrective sentence when a spelled out number is unsourced, and keeps the first reasons", async () => {
    const { generator, generate } = generatorOf(
      { kind: "text", text: SPELLED_NUMBER, usage: USAGE },
      { kind: "text", text: PASSING, usage: USAGE },
    );

    const result = await generateChecked(generator, SOURCE, REQUEST);

    expect(result).toMatchObject({ status: "published", attempts: 2, failureReasons: ["unsourced_number"] });
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attempt: 2, userMessage: CORRECTIVE_SENTENCES.unsourced_number }),
    );
  });

  it("fails after one retry when the retry also fails, recording the retry's reasons", async () => {
    const { generator, generate } = generatorOf(
      { kind: "text", text: SPELLED_NUMBER, usage: USAGE },
      { kind: "text", text: "Too short.", usage: USAGE },
    );

    const result = await generateChecked(generator, SOURCE, REQUEST);

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ attempts: 2 });
    expect((result as { failureReasons: string[] }).failureReasons).toEqual(
      expect.arrayContaining(["sentence_count", "word_count"]),
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("fails on a refusal at attempt 1 without a retry", async () => {
    const { generator, generate } = generatorOf({ kind: "refusal", usage: USAGE });
    expect(await generateChecked(generator, SOURCE, REQUEST)).toEqual({
      status: "failed",
      attempts: 1,
      failureReasons: ["refusal"],
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("fails on a refusal at the retry, recording refusal only", async () => {
    const { generator } = generatorOf({ kind: "text", text: SPELLED_NUMBER, usage: USAGE }, { kind: "refusal", usage: USAGE });
    expect(await generateChecked(generator, SOURCE, REQUEST)).toEqual({
      status: "failed",
      attempts: 2,
      failureReasons: ["refusal"],
    });
  });
});
