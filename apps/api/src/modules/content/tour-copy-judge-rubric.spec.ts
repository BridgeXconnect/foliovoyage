import { describe, expect, it } from "@jest/globals";

import { buildJudgeUserMessage, getJudgeRubric, judgeSourceText } from "./tour-copy-judge-rubric";

const SOURCE = {
  title: "Floating Market Boat Tour",
  description: "Glide along peaceful canals.",
  durationMin: 240,
  inclusions: ["Lunch"],
  exclusions: ["Hotel pickup"],
};

describe("getJudgeRubric (spec 0003 AC-17)", () => {
  it("returns a versioned rubric for tour_copy", () => {
    const rubric = getJudgeRubric("tour_copy");
    expect(rubric.version).toBeGreaterThanOrEqual(1);
    expect(rubric.systemPrompt).toContain("JSON");
  });

  it.each(["guide", "collection", "nonsense"])("throws for the unregistered content type %s", (contentType) => {
    expect(() => getJudgeRubric(contentType)).toThrow(`No judge rubric is registered for content type "${contentType}"`);
  });
});

describe("buildJudgeUserMessage (spec 0003 AC-5)", () => {
  it("puts the source data and the paragraph in separate delimited blocks", () => {
    const message = buildJudgeUserMessage(SOURCE, "A paragraph to judge.");
    expect(message).toContain(judgeSourceText(SOURCE));
    expect(message).toMatch(/<paragraph>\nA paragraph to judge\.\n<\/paragraph>$/);
    expect(message.indexOf("<tour_data>")).toBeLessThan(message.indexOf("<paragraph>"));
  });
});
