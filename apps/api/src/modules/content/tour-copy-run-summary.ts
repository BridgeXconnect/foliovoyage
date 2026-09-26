import { VOICE_COUNTER_NAMES, type VoiceCounterName } from "./tour-copy-check.constants";
import { DURATION_OPENING_WARN_SHARE } from "./tour-copy-eval.constants";
import { OPENING_PATTERNS, type OpeningPattern } from "./tour-copy-opening";

/**
 * Summary lines for the voice counters and opening patterns of one
 * `tour-copy:run` (BRI-201 / spec 0003, AC-4). Pure: the CLI passes in the
 * published rows this run stored and prints what comes back.
 */

export interface PublishedCopyStats {
  voiceCounts: Partial<Record<VoiceCounterName, number>> | null;
  openingPattern: string | null;
}

export function summarizePublishedCopy(rows: readonly PublishedCopyStats[]): string[] {
  if (rows.length === 0) return [];

  const totals = Object.fromEntries(VOICE_COUNTER_NAMES.map((name) => [name, 0])) as Record<VoiceCounterName, number>;
  for (const row of rows) {
    for (const name of VOICE_COUNTER_NAMES) totals[name] += row.voiceCounts?.[name] ?? 0;
  }

  const lines = [`  voice counters: ${VOICE_COUNTER_NAMES.map((name) => `${name} ${totals[name]}`).join(", ")}`];

  const withPattern = rows.filter((row) => row.openingPattern !== null);
  if (withPattern.length === 0) return lines;

  const shares = OPENING_PATTERNS.map((pattern) => {
    const count = withPattern.filter((row) => row.openingPattern === pattern).length;
    return { pattern, count, share: count / withPattern.length };
  });
  lines.push(
    `  opening patterns: ${shares.map(({ pattern, count, share }) => `${pattern} ${count} (${percent(share)})`).join(", ")}`,
  );

  const duration = shares.find((entry) => entry.pattern === ("duration" satisfies OpeningPattern));
  if (duration && duration.share > DURATION_OPENING_WARN_SHARE) {
    lines.push(
      `  WARNING: ${percent(duration.share)} of this run's published paragraphs open on the duration, above ${percent(DURATION_OPENING_WARN_SHARE)}. Check the openings before the next run.`,
    );
  }
  return lines;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
