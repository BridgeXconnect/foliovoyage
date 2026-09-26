import type { JudgedClaim, JudgeClaimVerdict, JudgeVerdict, PageVerdict } from "./tour-copy-judge";

/**
 * Pure validation of the judge's `record_verdict` tool input (BRI-201 / spec
 * 0003, AC-6). No model, DB or clock access. The judge's own words are never
 * trusted as evidence: a quote that is not found in the source fields is
 * checked here, in code, and the claim is downgraded when it is not.
 */

const CLAIM_VERDICTS: readonly JudgeClaimVerdict[] = ["supported", "unsupported", "contradicted"];

/**
 * The single tool the judge is forced to call (AC-5). Part of the golden
 * stamp key (AC-16), so editing it fails CI until the golden run is repeated.
 * `evidence_quote` is required but may be empty for an `unsupported` claim.
 */
export const RECORD_VERDICT_TOOL = {
  name: "record_verdict",
  description:
    "Record your verdict on the paragraph: every factual claim it makes with a verdict and a quote from the tour data, and whether it opens on one specific, checkable fact.",
  input_schema: {
    type: "object" as const,
    properties: {
      claims: {
        type: "array",
        minItems: 1,
        description: "Every factual claim the paragraph makes, in order.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The claim, in a few words, as the paragraph states it." },
            verdict: {
              type: "string",
              enum: ["supported", "unsupported", "contradicted"],
              description:
                "supported: the tour data states it. unsupported: the tour data does not say it. contradicted: the tour data says something different.",
            },
            evidence_quote: {
              type: "string",
              description:
                "For supported and contradicted: an exact, word for word quote from the tour data. Empty string allowed only for unsupported.",
            },
          },
          required: ["text", "verdict", "evidence_quote"],
        },
      },
      leads_with_fact: {
        type: "boolean",
        description: "True when the first sentence opens on one specific fact from the tour data a reader could verify.",
      },
      lead_fact: {
        type: ["string", "null"],
        description: "That opening fact in a few words, or null when leads_with_fact is false.",
      },
    },
    required: ["claims", "leads_with_fact", "lead_fact"],
  },
};

/** NFC, lowercase, and collapsed whitespace: how quotes are compared to the source (AC-6). */
export function normalizeForQuoteMatch(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export type JudgeValidation = { ok: true; verdict: JudgeVerdict } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the tool input, downgrade unfounded quotes, and derive the page
 * verdict. `sourceText` is the source fields exactly as the judge was shown
 * them. Returns `{ok: false}` for any shape problem, which the adapter turns
 * into the one retry and then `judge_invalid`.
 */
export function validateJudgeToolInput(raw: unknown, sourceText: string): JudgeValidation {
  if (!isRecord(raw)) return { ok: false, reason: "tool input is not an object" };

  const { claims: rawClaims, leads_with_fact: leadsWithFact, lead_fact: leadFact } = raw;

  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    return { ok: false, reason: "claims must be a non empty list" };
  }
  if (typeof leadsWithFact !== "boolean") return { ok: false, reason: "leads_with_fact must be a boolean" };
  if (leadFact !== null && typeof leadFact !== "string") {
    return { ok: false, reason: "lead_fact must be a string or null" };
  }

  const normalizedSource = normalizeForQuoteMatch(sourceText);
  const claims: JudgedClaim[] = [];

  for (const [index, rawClaim] of rawClaims.entries()) {
    if (!isRecord(rawClaim)) return { ok: false, reason: `claim ${index} is not an object` };
    const { text, verdict, evidence_quote: evidenceQuote } = rawClaim;
    if (typeof text !== "string") return { ok: false, reason: `claim ${index} has no text` };
    if (typeof verdict !== "string" || !CLAIM_VERDICTS.includes(verdict as JudgeClaimVerdict)) {
      return { ok: false, reason: `claim ${index} has an invalid verdict` };
    }
    if (typeof evidenceQuote !== "string") {
      return { ok: false, reason: `claim ${index} has no evidence_quote` };
    }

    let finalVerdict = verdict as JudgeClaimVerdict;
    let downgraded = false;
    if (finalVerdict !== "unsupported") {
      const quote = normalizeForQuoteMatch(evidenceQuote);
      if (quote.length === 0 || !normalizedSource.includes(quote)) {
        finalVerdict = "unsupported";
        downgraded = true;
      }
    }
    claims.push({
      text,
      verdict: finalVerdict,
      evidenceQuote,
      ...(downgraded ? { downgraded: true as const } : {}),
    });
  }

  return {
    ok: true,
    verdict: {
      claims,
      claimVerdict: derivePageVerdict(claims),
      leadsWithFact,
      leadFact,
    },
  };
}

/** `contradicted` if any claim is, else `unsupported` if any claim is, else `clean` (AC-6). */
export function derivePageVerdict(claims: readonly { verdict: JudgeClaimVerdict }[]): PageVerdict {
  if (claims.some((claim) => claim.verdict === "contradicted")) return "contradicted";
  if (claims.some((claim) => claim.verdict === "unsupported")) return "unsupported";
  return "clean";
}
