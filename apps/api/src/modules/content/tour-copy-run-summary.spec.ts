import { describe, expect, it } from "@jest/globals";

import { summarizePublishedCopy } from "./tour-copy-run-summary";

const row = (openingPattern: string | null, counts = { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 }) => ({
  voiceCounts: counts,
  openingPattern,
});

describe("summarizePublishedCopy (spec 0003 AC-4)", () => {
  it("prints nothing for no rows", () => {
    expect(summarizePublishedCopy([])).toEqual([]);
  });

  it("does not warn at exactly 40% duration", () => {
    const lines = summarizePublishedCopy([row("duration"), row("duration"), row("other"), row("other"), row("other")]);
    expect(lines.join("\n")).toContain("duration 2 (40%), other 3 (60%)");
    expect(lines.join("\n")).not.toContain("WARNING");
  });

  it("warns just above 40% duration", () => {
    const rows = [...Array(5).fill(row("duration")), ...Array(7).fill(row("other"))]; // 41.7%
    expect(summarizePublishedCopy(rows).join("\n")).toContain("WARNING: 42%");
  });

  it("takes the pattern share over rows that have a pattern, and counts null counters as zero", () => {
    const lines = summarizePublishedCopy([
      { voiceCounts: null, openingPattern: null },
      row("other", { emDash: 1, contrastiveReveal: 0, clicheOrIntensifier: 0 }),
    ]);
    expect(lines.join("\n")).toContain("emDash 1, contrastiveReveal 0, clicheOrIntensifier 0");
    expect(lines.join("\n")).toContain("duration 0 (0%), other 1 (100%)");
  });

  it("prints only the counters when no row has a pattern yet", () => {
    const lines = summarizePublishedCopy([{ voiceCounts: null, openingPattern: null }]);
    expect(lines).toHaveLength(1);
  });
});
