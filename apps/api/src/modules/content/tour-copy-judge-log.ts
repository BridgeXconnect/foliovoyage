import type { JudgeAttempt, JudgedClaim } from "./tour-copy-judge";

/**
 * Log lines for one judge call (BRI-201 / spec 0003). Logging only: nothing in
 * here decides a pass, a stop or a withdrawal. Shared by the golden run and the
 * eval run so both print a flagged claim and a retry the same way.
 */

/** Judge calls that needed a second model call, and how many of the first calls stopped at `max_tokens`. */
export interface JudgeRetryStats {
  calls: number;
  retried: number;
  maxTokensStops: number;
}

export const emptyRetryStats = (): JudgeRetryStats => ({ calls: 0, retried: 0, maxTokensStops: 0 });

/** Adds one judge call to the running totals. A call without attempt info (a test fake) still counts as a call. */
export function countAttempts(stats: JudgeRetryStats, attempts: readonly JudgeAttempt[] | undefined): void {
  stats.calls++;
  if (attempts === undefined) return;
  if (attempts.length > 1) stats.retried++;
  stats.maxTokensStops += attempts.filter((attempt) => attempt.outcome === "max_tokens").length;
}

export function formatRetryStats(stats: JudgeRetryStats): string {
  return `judge calls retried: ${stats.retried} of ${stats.calls}, max_tokens stops: ${stats.maxTokensStops}`;
}

/** "attempt 1 ended max_tokens (1500 output tokens), attempt 2 ended ok (312 output tokens)". */
export function formatAttempts(attempts: readonly JudgeAttempt[]): string {
  return attempts
    .map((attempt, index) => `attempt ${index + 1} ended ${attempt.outcome} (${attempt.outputTokens} output tokens)`)
    .join(", ");
}

/** A retry line, or nothing when the call needed only one attempt (or the judge gave no attempt info). */
export function retryLines(attempts: readonly JudgeAttempt[] | undefined, indent = "    "): string[] {
  return attempts !== undefined && attempts.length > 1 ? [`${indent}judge retry: ${formatAttempts(attempts)}`] : [];
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The claims the judge did not call supported, each with the source quote it gave. Nothing for a clean page. */
export function flaggedClaimLines(claims: readonly JudgedClaim[], indent = "    "): string[] {
  const lines: string[] = [];
  for (const claim of claims) {
    if (claim.verdict === "supported") continue;
    lines.push(`${indent}${claim.verdict}: ${oneLine(claim.text)}`);
    lines.push(`${indent}  evidence: ${claim.evidenceQuote.trim() === "" ? "(none, the source does not say it)" : `"${oneLine(claim.evidenceQuote)}"`}`);
  }
  return lines;
}
