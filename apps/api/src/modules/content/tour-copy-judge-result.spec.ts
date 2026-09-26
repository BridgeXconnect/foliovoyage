import { describe, expect, it } from "@jest/globals";

import { derivePageVerdict, normalizeForQuoteMatch, RECORD_VERDICT_TOOL, validateJudgeToolInput } from "./tour-copy-judge-result";

const SOURCE = `<tour_data>
Title: Floating Market Boat Tour
Description: Glide along peaceful canals in a traditional longtail boat. Lunch is included.
Duration: 240 minutes
Excludes: hotel pickup
</tour_data>`;

function input(claims: unknown[], extra: Record<string, unknown> = {}) {
  return { claims, leads_with_fact: true, lead_fact: "longtail boat", ...extra };
}

describe("validateJudgeToolInput (spec 0003 AC-6)", () => {
  it("keeps a supported claim whose quote is in the source", () => {
    const result = validateJudgeToolInput(
      input([{ text: "a longtail boat", verdict: "supported", evidence_quote: "traditional longtail boat" }]),
      SOURCE,
    );
    expect(result).toEqual({
      ok: true,
      verdict: {
        claims: [{ text: "a longtail boat", verdict: "supported", evidenceQuote: "traditional longtail boat" }],
        claimVerdict: "clean",
        leadsWithFact: true,
        leadFact: "longtail boat",
      },
    });
  });

  it("matches quotes ignoring case, extra whitespace and unicode form", () => {
    const result = validateJudgeToolInput(
      input([{ text: "lunch", verdict: "supported", evidence_quote: "LUNCH   is\nincluded" }]),
      SOURCE,
    );
    expect(result).toMatchObject({ ok: true, verdict: { claimVerdict: "clean" } });
  });

  it("downgrades a supported claim whose quote is not in the source, and marks it downgraded", () => {
    const result = validateJudgeToolInput(
      input([{ text: "a guide", verdict: "supported", evidence_quote: "an expert English speaking guide" }]),
      SOURCE,
    );
    expect(result).toMatchObject({
      ok: true,
      verdict: {
        claims: [{ verdict: "unsupported", downgraded: true }],
        claimVerdict: "unsupported",
      },
    });
  });

  it("downgrades a contradicted claim with a made up quote to unsupported", () => {
    const result = validateJudgeToolInput(
      input([{ text: "five hours", verdict: "contradicted", evidence_quote: "Duration: 300 minutes" }]),
      SOURCE,
    );
    expect(result).toMatchObject({ ok: true, verdict: { claims: [{ verdict: "unsupported", downgraded: true }] } });
  });

  it("downgrades a supported claim with an empty quote", () => {
    const result = validateJudgeToolInput(input([{ text: "x", verdict: "supported", evidence_quote: "  " }]), SOURCE);
    expect(result).toMatchObject({ ok: true, verdict: { claims: [{ verdict: "unsupported", downgraded: true }] } });
  });

  it("leaves an unsupported claim alone, with or without a quote, and does not mark it downgraded", () => {
    const result = validateJudgeToolInput(
      input([
        { text: "a", verdict: "unsupported", evidence_quote: "" },
        { text: "b", verdict: "unsupported", evidence_quote: "not in the source at all" },
      ]),
      SOURCE,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.verdict.claims.every((claim) => claim.downgraded === undefined)).toBe(true);
      expect(result.verdict.claimVerdict).toBe("unsupported");
    }
  });

  it("derives contradicted over unsupported over clean", () => {
    const result = validateJudgeToolInput(
      input([
        { text: "a", verdict: "unsupported", evidence_quote: "" },
        { text: "b", verdict: "contradicted", evidence_quote: "hotel pickup" },
        { text: "c", verdict: "supported", evidence_quote: "Lunch is included" },
      ]),
      SOURCE,
    );
    expect(result).toMatchObject({ ok: true, verdict: { claimVerdict: "contradicted" } });
  });

  it("accepts a null lead_fact", () => {
    const result = validateJudgeToolInput(
      input([{ text: "a", verdict: "supported", evidence_quote: "lunch is included" }], {
        leads_with_fact: false,
        lead_fact: null,
      }),
      SOURCE,
    );
    expect(result).toMatchObject({ ok: true, verdict: { leadsWithFact: false, leadFact: null } });
  });

  it.each([
    ["a non object", "nope"],
    ["null", null],
    ["an array", []],
    ["no claims", input([])],
    ["claims that is not a list", { claims: "x", leads_with_fact: true, lead_fact: null }],
    ["a non boolean leads_with_fact", input([{ text: "a", verdict: "supported", evidence_quote: "x" }], { leads_with_fact: "yes" })],
    ["a numeric lead_fact", input([{ text: "a", verdict: "supported", evidence_quote: "x" }], { lead_fact: 3 })],
    ["a claim that is not an object", input(["oops"])],
    ["a claim with no text", input([{ verdict: "supported", evidence_quote: "x" }])],
    ["an unknown verdict", input([{ text: "a", verdict: "maybe", evidence_quote: "x" }])],
    ["a claim with no evidence_quote", input([{ text: "a", verdict: "unsupported" }])],
  ])("rejects %s", (_label, raw) => {
    expect(validateJudgeToolInput(raw, SOURCE)).toMatchObject({ ok: false });
  });
});

describe("derivePageVerdict", () => {
  it("is clean for no bad claims", () => {
    expect(derivePageVerdict([{ verdict: "supported" }])).toBe("clean");
  });
  it("is unsupported when one claim is", () => {
    expect(derivePageVerdict([{ verdict: "supported" }, { verdict: "unsupported" }])).toBe("unsupported");
  });
  it("is contradicted when any claim is", () => {
    expect(derivePageVerdict([{ verdict: "unsupported" }, { verdict: "contradicted" }])).toBe("contradicted");
  });
});

describe("normalizeForQuoteMatch", () => {
  it("lowercases, collapses whitespace and normalises to NFC", () => {
    expect(normalizeForQuoteMatch("  Café   Stop\n")).toBe("café stop");
  });
});

describe("RECORD_VERDICT_TOOL", () => {
  it("requires the three fields and offers only the three claim verdicts", () => {
    expect(RECORD_VERDICT_TOOL.name).toBe("record_verdict");
    expect(RECORD_VERDICT_TOOL.input_schema.required).toEqual(["claims", "leads_with_fact", "lead_fact"]);
    expect(RECORD_VERDICT_TOOL.input_schema.properties.claims.items.properties.verdict.enum).toEqual([
      "supported",
      "unsupported",
      "contradicted",
    ]);
  });
});
