import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

/**
 * Spend guard for the hub page research CLI (BRI-206, spec child 0001).
 *
 * Every paid provider call must pass {@link SpendGuard.check} first. The guard
 * enforces two limits before a call is sent:
 *   - a per run cap (default 1 USD, never more than 5), and
 *   - a calendar month ceiling (25 USD) summed from the append only ledger.
 *
 * Money is compared in integer micro dollars so floating point drift
 * (0.1 + 0.2) can never push a total across a limit by accident, or hide a
 * breach.
 *
 * The month total only sees this machine's ledger. The provider dashboard stays
 * the source of truth.
 */

export const DEFAULT_RUN_CAP_USD = 1;
export const RUN_CAP_HARD_MAX_USD = 5;
export const MONTH_CEILING_USD = 25;

const MICROS = 1_000_000;

/** USD to integer micro dollars. */
export const toMicros = (usd: number): number => Math.round(usd * MICROS);

/** Format micro dollars for messages, e.g. `$0.0124`. */
export const formatUsd = (micros: number): string =>
  `$${(micros / MICROS).toFixed(4)}`;

/**
 * Resolve the per run cap: `HUB_RESEARCH_MAX_USD` if set, else 1, and never
 * more than 5. Anything that is not a positive finite number is rejected
 * rather than silently replaced, so a bad value cannot loosen the cap.
 */
export function resolveRunCap(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_RUN_CAP_USD;
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `HUB_RESEARCH_MAX_USD must be a positive number, got "${String(raw)}".`,
    );
  }
  return Math.min(raw, RUN_CAP_HARD_MAX_USD);
}

/** One line of `ledger.jsonl`. Never carries a header or credential. */
export interface LedgerLine {
  /** ISO 8601 UTC timestamp of the call. */
  ts: string;
  stage: string;
  endpoint: string;
  keywords: number;
  /** Cost in USD as reported by the provider response. */
  cost: number;
  cacheKey: string;
}

const ledgerLineSchema = z.object({
  ts: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "ts is not a valid date",
  }),
  stage: z.string(),
  endpoint: z.string(),
  keywords: z.number().int().nonnegative(),
  cost: z.number().finite().nonnegative(),
  cacheKey: z.string(),
});

export class LedgerCorruptError extends Error {
  constructor(file: string, lineNumber: number, detail: string) {
    super(
      `Spend ledger ${file} line ${lineNumber} is unreadable (${detail}). ` +
        `Refusing to continue: the month total cannot be trusted. ` +
        `Fix or remove that line by hand, then rerun.`,
    );
    this.name = "LedgerCorruptError";
  }
}

/** Append only spend ledger backed by a JSON lines file. */
export class Ledger {
  constructor(readonly file: string) {}

  /** Append one line. The file is only ever appended to, never rewritten. */
  append(line: LedgerLine): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(line)}\n`, "utf8");
  }

  /** Every line in the file. A malformed line stops the run (fail closed). */
  read(): LedgerLine[] {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split("\n");
    const out: LedgerLine[] = [];
    lines.forEach((text, i) => {
      if (text.trim() === "") return;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new LedgerCorruptError(this.file, i + 1, "not valid JSON");
      }
      const parsed = ledgerLineSchema.safeParse(json);
      if (!parsed.success) {
        throw new LedgerCorruptError(this.file, i + 1, "unexpected shape");
      }
      out.push(parsed.data);
    });
    return out;
  }

  /** Sum of ledger lines in the UTC calendar month of `now`, in micro dollars. */
  monthTotalMicros(now: Date): number {
    const month = now.toISOString().slice(0, 7);
    return this.read()
      .filter((l) => new Date(l.ts).toISOString().slice(0, 7) === month)
      .reduce((sum, l) => sum + toMicros(l.cost), 0);
  }
}

export type SpendRefusalReason = "run_cap" | "month_ceiling";

/** Thrown before a call is sent, so nothing was spent. */
export class SpendRefusedError extends Error {
  constructor(
    readonly reason: SpendRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "SpendRefusedError";
  }
}

export interface SpendGuardOptions {
  ledger: Ledger;
  /** Per run cap in USD. Resolved through {@link resolveRunCap}. */
  runCapUsd?: number;
  /** Month ceiling in USD. Defaults to {@link MONTH_CEILING_USD}. */
  monthCeilingUsd?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export class SpendGuard {
  readonly runCapUsd: number;
  readonly monthCeilingUsd: number;
  private readonly ledger: Ledger;
  private readonly now: () => Date;

  private runSpentMicros = 0;
  private plannedMicros = 0;
  private plannedCalls = 0;

  constructor(options: SpendGuardOptions) {
    this.ledger = options.ledger;
    this.runCapUsd = resolveRunCap(options.runCapUsd);
    this.monthCeilingUsd = options.monthCeilingUsd ?? MONTH_CEILING_USD;
    this.now = options.now ?? (() => new Date());
  }

  /** Spent so far in this run, from provider reported costs, in USD. */
  get runSpentUsd(): number {
    return this.runSpentMicros / MICROS;
  }

  /** Estimated cost of calls a dry run has counted, in USD. */
  get plannedUsd(): number {
    return this.plannedMicros / MICROS;
  }

  /** How many calls a dry run has counted. */
  get plannedCallCount(): number {
    return this.plannedCalls;
  }

  /** This calendar month's spend from the ledger, in USD. */
  monthSpentUsd(): number {
    return this.ledger.monthTotalMicros(this.now()) / MICROS;
  }

  /**
   * Refuse, by throwing, if sending a call estimated at `estimateUsd` would
   * pass the run cap or the month ceiling. Dry run estimates already counted by
   * {@link plan} are included, so a dry run reports what the real run would do.
   * Call this before every paid request.
   */
  check(estimateUsd: number): void {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error(`Cost estimate must be a non negative number, got ${String(estimateUsd)}.`);
    }
    const estimate = toMicros(estimateUsd);

    const runCap = toMicros(this.runCapUsd);
    const runSoFar = this.runSpentMicros + this.plannedMicros;
    if (runSoFar + estimate > runCap) {
      throw new SpendRefusedError(
        "run_cap",
        `Refused before sending: this run is at ${formatUsd(runSoFar)} and the next call is estimated at ` +
          `${formatUsd(estimate)}, which would pass the run cap of ${formatUsd(runCap)}. Nothing was spent.`,
      );
    }

    const monthCeiling = toMicros(this.monthCeilingUsd);
    const monthSoFar =
      this.ledger.monthTotalMicros(this.now()) + this.plannedMicros;
    if (monthSoFar + estimate > monthCeiling) {
      throw new SpendRefusedError(
        "month_ceiling",
        `Refused before sending: this month is at ${formatUsd(monthSoFar)} and the next call is estimated at ` +
          `${formatUsd(estimate)}, which would pass the month ceiling of ${formatUsd(monthCeiling)}. Nothing was spent.`,
      );
    }
  }

  /** Count a dry run call, so later checks in the same run include it. */
  plan(estimateUsd: number): void {
    this.plannedMicros += toMicros(estimateUsd);
    this.plannedCalls += 1;
  }

  /**
   * Record a sent call: append one ledger line with the provider reported cost
   * and add it to the run total.
   */
  record(line: LedgerLine): void {
    this.ledger.append(line);
    this.runSpentMicros += toMicros(line.cost);
  }
}
