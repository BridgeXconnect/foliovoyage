import { describe, expect, it } from "@jest/globals";

import {
  CHECK_MAX_SENTENCES,
  CHECK_MAX_WORDS,
  CHECK_MIN_SENTENCES,
  CHECK_MIN_WORDS,
} from "./tour-copy-check.constants";
import { checkTourCopy } from "./tour-copy-check";
import {
  TOUR_COPY_EXAMPLE_OUTPUT,
  TOUR_COPY_EXAMPLE_SOURCE,
  TOUR_COPY_SYSTEM_PROMPT,
  buildTourCopyUserMessage,
} from "./tour-copy-prompt";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";

describe("TOUR_COPY_SYSTEM_PROMPT", () => {
  it("states the check's sentence and word limits, derived from the check's own constants (drift guard)", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain(`${CHECK_MIN_SENTENCES} to ${CHECK_MAX_SENTENCES} sentences`);
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain(`${CHECK_MIN_WORDS} to ${CHECK_MAX_WORDS} words`);
  });

  it("states the ban on unsourced numbers, price/cost, and cancellation/availability language", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("no number");
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("no price, cost, currency");
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("no cancellation, refund, reschedule, or availability");
  });

  it("tells the model to write in English", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("in English");
  });

  it("tells the model to use only the delimited tour data", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("<tour_data>");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("</tour_data>");
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("do not use any other knowledge");
  });

  it("instructs opening on one specific, checkable fact", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("one specific, checkable fact");
  });

  it("tells the model to vary its opening, and its own example doesn't lead on duration", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("Vary which fact leads");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain('"The tour runs N minutes"');
    const exampleFirstSentence = TOUR_COPY_EXAMPLE_OUTPUT.split(/(?<=\.)\s/)[0];
    expect(exampleFirstSentence).not.toMatch(/\b(minutes?|hours?|runs|lasts)\b/i);
    expect(exampleFirstSentence).not.toContain(String(TOUR_COPY_EXAMPLE_SOURCE.durationMin));
  });

  it("names the docs/08 negative patterns verbatim: contrastive-reveal, come-for-stay-for, stacked intensifiers, clichés", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("It's not just X");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("Come for X, stay for Y");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("truly");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("hidden gem");
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("em dash");
  });

  it("never carries docs/08 line 24's price example, line 27's firsthand-knowledge line, or the Bangkok BTS calibration example", () => {
    const lower = TOUR_COPY_SYSTEM_PROMPT.toLowerCase();
    expect(lower).not.toContain("roy");
    expect(lower).not.toContain("firsthand");
    expect(lower).not.toContain("suvarnabhumi");
    expect(lower).not.toContain("phaya thai");
    expect(lower).not.toContain("airport rail link");
    expect(lower).not.toContain("bts");
  });

  it("embeds a fixed few-shot example built from mock data, not the Bangkok calibration example", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain(TOUR_COPY_EXAMPLE_SOURCE.title);
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain(TOUR_COPY_EXAMPLE_OUTPUT);
    expect(TOUR_COPY_EXAMPLE_SOURCE.title.toLowerCase()).not.toContain("bangkok");
  });

  it("ships an example output that itself passes the deterministic check", () => {
    const result = checkTourCopy({ candidate: TOUR_COPY_EXAMPLE_OUTPUT, source: TOUR_COPY_EXAMPLE_SOURCE });
    expect(result).toEqual({
      passed: true,
      reasons: [],
      voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 },
    });
  });

  it("instructs plain-prose output with nothing else", () => {
    expect(TOUR_COPY_SYSTEM_PROMPT.toLowerCase()).toContain("no headings, no bullet points, no markdown");
    expect(TOUR_COPY_SYSTEM_PROMPT).toContain("Respond with the paragraph only, nothing else.");
  });
});

describe("buildTourCopyUserMessage", () => {
  const source: TourCopyGroundingInput = {
    title: "Kyoto Bamboo Grove Bicycle Tour",
    description: "Ride quiet backroads through the Arashiyama bamboo grove with a local guide before stopping at a riverside teahouse.",
    durationMin: 120,
    inclusions: [{ categoryDescription: "Equipment", typeDescription: "Included", description: "Bicycle and helmet" }],
    exclusions: [{ categoryDescription: "Food and drinks", typeDescription: "Not included", description: "Lunch" }],
  };

  it("wraps the message in delimited tour_data blocks", () => {
    const message = buildTourCopyUserMessage(source);
    expect(message.startsWith("<tour_data>")).toBe(true);
    expect(message.endsWith("</tour_data>")).toBe(true);
  });

  it("includes exactly the five grounding fields' values", () => {
    const message = buildTourCopyUserMessage(source);
    expect(message).toContain(source.title);
    expect(message).toContain(source.description as string);
    expect(message).toContain("120");
    expect(message).toContain("Bicycle and helmet");
    expect(message).toContain("Lunch");
  });

  it("never mentions rating, review count, price, currency, cancellation policy, tags, coordinates, or city name", () => {
    const message = buildTourCopyUserMessage(source).toLowerCase();
    for (const forbidden of ["rating", "review", "price", "currency", "cancellation", "tag", "latitude", "longitude", "city"]) {
      expect(message).not.toContain(forbidden);
    }
  });

  it("renders null description as (none) and null durationMin as (unknown)", () => {
    const message = buildTourCopyUserMessage({ title: "Untitled Tour", description: null, durationMin: null, inclusions: [], exclusions: [] });
    expect(message).toContain("Description: (none)");
    expect(message).toContain("Duration (minutes): (unknown)");
    expect(message).toContain("Inclusions: (none)");
    expect(message).toContain("Exclusions: (none)");
  });
});
