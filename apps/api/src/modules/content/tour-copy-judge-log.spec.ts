import { describe, expect, it } from "@jest/globals";

import type { JudgeAttempt, JudgedClaim } from "./tour-copy-judge";
import {
  countAttempts,
  emptyRetryStats,
  flaggedClaimLines,
  formatAttempts,
  formatRetryStats,
  retryLines,
} from "./tour-copy-judge-log";

const claim = (verdict: JudgedClaim["verdict"], text: string, evidenceQuote: string): JudgedClaim => ({ text, verdict, evidenceQuote });

describe("flaggedClaimLines", () => {
  it("prints nothing for a page whose claims are all supported", () => {
    expect(flaggedClaimLines([claim("supported", "a boat tour", "boat tour")])).toEqual([]);
  });

  it("prints each unsupported or contradicted claim with its quote, and skips the supported ones", () => {
    expect(
      flaggedClaimLines([
        claim("supported", "a boat tour", "boat tour"),
        claim("contradicted", "linger as long as you like", "60 minutes"),
        claim("unsupported", "not a rushed pace", ""),
      ]),
    ).toEqual([
      "    contradicted: linger as long as you like",
      '      evidence: "60 minutes"',
      "    unsupported: not a rushed pace",
      "      evidence: (none, the source does not say it)",
    ]);
  });

  it("puts a claim and a quote that span lines on one line each", () => {
    expect(flaggedClaimLines([claim("unsupported", "two\n  lines", "a\nquote")])).toEqual([
      "    unsupported: two lines",
      '      evidence: "a quote"',
    ]);
  });
});

describe("retry logging", () => {
  const truncated: JudgeAttempt[] = [
    { outcome: "max_tokens", outputTokens: 1500 },
    { outcome: "ok", outputTokens: 300 },
  ];

  it("names each attempt and its output tokens", () => {
    expect(formatAttempts(truncated)).toBe("attempt 1 ended max_tokens (1500 output tokens), attempt 2 ended ok (300 output tokens)");
  });

  it("prints a retry line only when there was a second attempt", () => {
    expect(retryLines(truncated)).toEqual(["    judge retry: attempt 1 ended max_tokens (1500 output tokens), attempt 2 ended ok (300 output tokens)"]);
    expect(retryLines([{ outcome: "ok", outputTokens: 10 }])).toEqual([]);
    expect(retryLines(undefined)).toEqual([]);
  });

  it("counts calls, retried calls and max_tokens stops, and a call with no attempt info still counts as a call", () => {
    const stats = emptyRetryStats();
    countAttempts(stats, [{ outcome: "ok", outputTokens: 10 }]);
    countAttempts(stats, truncated);
    countAttempts(stats, [
      { outcome: "max_tokens", outputTokens: 1500 },
      { outcome: "max_tokens", outputTokens: 1500 },
    ]);
    countAttempts(stats, undefined);
    expect(stats).toEqual({ calls: 4, retried: 2, maxTokensStops: 3 });
    expect(formatRetryStats(stats)).toBe("judge calls retried: 2 of 4, max_tokens stops: 3");
  });
});
