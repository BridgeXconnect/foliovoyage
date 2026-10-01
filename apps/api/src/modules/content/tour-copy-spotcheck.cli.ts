import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import { SPOTCHECK_SIZE } from "./tour-copy-eval.constants";
import { shuffle } from "./tour-copy-eval-sample";
import type { PromptModelPair } from "./tour-copy-eval-stats";
import type { PageVerdict } from "./tour-copy-judge";
import { getJudgeRubric } from "./tour-copy-judge-rubric";
import { isServedCopy } from "./tour-copy-served";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import { buildTourCopyUserMessage } from "./tour-copy-prompt";

/**
 * `tour-copy-spotcheck:run --prompt-version N --model M [--count N]` (BRI-201 /
 * spec 0003, AC-13). An interactive human check of published paragraphs. Every
 * answer is stored at once as a `TourCopyEval` row with `evaluator = human`
 * and the current rubric version, so an interrupted session resumes. It makes
 * no model call and needs only the database (AC-19). Exit codes: 0 ok, 1 not a
 * terminal or bad arguments.
 *
 * `--count` is the total number of answered human rows the pair should have,
 * so a resumed session asks only for the rest. A skipped row stores nothing.
 */

export interface SpotcheckIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** True when input comes from a terminal. */
  isTty: boolean;
  /** Reads one answer; null when input has ended. */
  ask: (question: string) => Promise<string | null>;
}

export interface SpotcheckRow {
  tourCopyId: string;
  tourId: string;
  copyGeneratedAt: Date;
  paragraph: string;
  source: TourCopyGroundingInput;
}

export interface HumanAnswer {
  claimVerdict: PageVerdict;
  /** The note of a `b` answer, stored as its one claim entry. */
  note: string | null;
  leadsWithFact: boolean;
}

export interface ReportRow {
  tourId: string;
  text: string;
  human: { claimVerdict: PageVerdict; note: string | null };
  /** The judge's verdict on the same copy at the same rubric version, when there is one. */
  judge: PageVerdict | null;
}

export interface SpotcheckStore {
  /**
   * Ids of the pair's published rows without a human verdict for their current
   * copy, judged ones and unjudged ones apart, and how many human rows the pair
   * already has at this rubric version.
   */
  pool(pair: PromptModelPair, rubricVersion: number): Promise<{ judged: string[]; unjudged: string[]; answered: number }>;
  /** One row to show, or null when it is no longer currently served. */
  loadRow(tourCopyId: string): Promise<SpotcheckRow | null>;
  /** "duplicate" when a human row for this copy already exists (a concurrent session). */
  saveHuman(
    row: SpotcheckRow,
    pair: PromptModelPair,
    answer: HumanAnswer,
    rubricVersion: number,
    runId: string,
  ): Promise<"saved" | "duplicate">;
  reportRows(pair: PromptModelPair, rubricVersion: number): Promise<ReportRow[]>;
}

export interface SpotcheckCliDeps {
  store?: SpotcheckStore;
  random?: () => number;
  runId?: () => string;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  promptVersion: number;
  model: string;
  count: number;
}

const USAGE = "Usage: tour-copy-spotcheck:run --prompt-version N --model M [--count N]";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  let promptVersion: number | undefined;
  let model: string | undefined;
  let count = SPOTCHECK_SIZE;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prompt-version" || arg === "--count") {
      const raw = argv[++i];
      const value = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        return { error: `${arg} needs a positive integer, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      if (arg === "--count") count = value;
      else promptVersion = value;
    } else if (arg === "--model") {
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith("--")) return { error: `--model needs a model id.\n${USAGE}` };
      model = raw;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  if (promptVersion === undefined || model === undefined) {
    return { error: `Both --prompt-version and --model are required.\n${USAGE}` };
  }
  return { promptVersion, model, count };
}

// ---------------------------------------------------------------------------
// The report (pure)
// ---------------------------------------------------------------------------

export interface AgreementReport {
  humanChecked: number;
  humanBad: number;
  /** Rows that have both a human and a judge verdict. */
  both: number;
  /** Both say clean, or both say bad. */
  agreed: number;
  /** The same verdict word on both sides. */
  exactAgreed: number;
  /** The judge said clean and the human said bad. */
  missed: ReportRow[];
}

export function buildAgreementReport(rows: readonly ReportRow[]): AgreementReport {
  const withJudge = rows.filter((row) => row.judge !== null);
  const bad = (verdict: PageVerdict): boolean => verdict !== "clean";
  return {
    humanChecked: rows.length,
    humanBad: rows.filter((row) => bad(row.human.claimVerdict)).length,
    both: withJudge.length,
    agreed: withJudge.filter((row) => bad(row.judge!) === bad(row.human.claimVerdict)).length,
    exactAgreed: withJudge.filter((row) => row.judge === row.human.claimVerdict).length,
    missed: rows
      .filter((row) => row.judge === "clean" && bad(row.human.claimVerdict))
      .sort((a, b) => a.tourId.localeCompare(b.tourId)),
  };
}

const percent = (part: number, whole: number): string => (whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`);

function printReport(report: AgreementReport, io: SpotcheckIo): void {
  io.out("");
  io.out("Spot check report");
  io.out(`  Human checked: ${report.humanChecked}, bad: ${report.humanBad} (${percent(report.humanBad, report.humanChecked)})`);
  io.out(
    `  Judge agreement on ${report.both} rows with both: ${report.agreed} (${percent(report.agreed, report.both)}) agree on clean or bad, ` +
      `${report.exactAgreed} (${percent(report.exactAgreed, report.both)}) agree on the exact verdict`,
  );
  if (report.missed.length === 0) {
    io.out("  No row where the judge said clean and you said bad.");
    return;
  }
  io.out(`  The judge said clean and you said bad, ${report.missed.length} row${report.missed.length === 1 ? "" : "s"}:`);
  for (const row of report.missed) {
    io.out(`    Tour ${row.tourId} (you said ${row.human.claimVerdict}${row.human.note ? `: ${row.human.note}` : ""})`);
    io.out(`      ${row.text}`);
  }
}

// ---------------------------------------------------------------------------
// The prompt loop
// ---------------------------------------------------------------------------

type RowOutcome = "good" | "bad" | "skipped" | "quit" | "duplicate";

async function askChoice(io: SpotcheckIo, question: string, allowed: readonly string[]): Promise<string | null> {
  for (;;) {
    const raw = await io.ask(question);
    if (raw === null) return null;
    const answer = raw.trim().toLowerCase();
    if (allowed.includes(answer)) return answer;
    io.out(`  Please answer one of: ${allowed.join(", ")}.`);
  }
}

async function checkOne(
  row: SpotcheckRow,
  position: string,
  ctx: { store: SpotcheckStore; pair: PromptModelPair; rubricVersion: number; runId: string },
  io: SpotcheckIo,
): Promise<RowOutcome> {
  io.out("");
  io.out(`${position} Tour ${row.tourId}`);
  io.out(buildTourCopyUserMessage(row.source));
  io.out("");
  io.out("Paragraph:");
  io.out(row.paragraph);
  io.out("");

  const choice = await askChoice(io, "Good, bad or skip? [g/b/s, q to quit] ", ["g", "b", "s", "q"]);
  if (choice === null || choice === "q") return "quit";
  if (choice === "s") return "skipped";

  let claimVerdict: PageVerdict = "clean";
  let note: string | null = null;
  if (choice === "b") {
    const kind = await askChoice(io, "Unsupported or contradicted? [u/c] ", ["u", "c"]);
    if (kind === null) return "quit";
    claimVerdict = kind === "u" ? "unsupported" : "contradicted";
    const rawNote = await io.ask("Note (optional, Enter to skip): ");
    if (rawNote === null) return "quit";
    note = rawNote.trim() === "" ? null : rawNote.trim();
  }

  const leads = await askChoice(io, "Does it lead with one specific, checkable fact? [y/n] ", ["y", "n"]);
  if (leads === null) return "quit";

  const saved = await ctx.store.saveHuman(
    row,
    ctx.pair,
    { claimVerdict, note, leadsWithFact: leads === "y" },
    ctx.rubricVersion,
    ctx.runId,
  );
  if (saved === "duplicate") {
    io.out("  Already answered in another session, not stored again.");
    return "duplicate";
  }
  return choice === "g" ? "good" : "bad";
}

export async function main(
  argv: readonly string[],
  _env: NodeJS.ProcessEnv,
  io: SpotcheckIo,
  deps: SpotcheckCliDeps = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    io.err(parsed.error);
    return 1;
  }
  if (!io.isTty) {
    io.err("tour-copy-spotcheck:run needs an interactive terminal, so it cannot run with piped input.");
    return 1;
  }

  const prisma = deps.store === undefined ? new PrismaService() : undefined;
  const store = deps.store ?? createPrismaSpotcheckStore(prisma!);
  const disconnect = deps.disconnect ?? (prisma !== undefined ? () => prisma.$disconnect() : undefined);
  const pair: PromptModelPair = { promptVersion: parsed.promptVersion, model: parsed.model };
  const rubricVersion = getJudgeRubric("tour_copy").version;
  const runId = (deps.runId ?? (() => randomUUID()))();
  const random = deps.random ?? Math.random;

  try {
    const pool = await store.pool(pair, rubricVersion);
    const remaining = Math.max(0, parsed.count - pool.answered);
    io.out(`tour-copy spot check ${runId}: prompt version ${pair.promptVersion}, model ${pair.model}`);
    io.out(
      `  ${pool.answered} answered already, target ${parsed.count}, ${remaining} to draw ` +
        `(${pool.judged.length} judged and ${pool.unjudged.length} unjudged rows to draw from)`,
    );

    // Judged rows first, so the agreement report has rows to compare; unjudged rows only fill the rest.
    const order = [...shuffle(pool.judged, random), ...shuffle(pool.unjudged, random)];
    const counts = { good: 0, bad: 0, skipped: 0 };
    let shown = 0;
    let quit = false;
    for (const tourCopyId of order) {
      if (shown >= remaining) break;
      const row = await store.loadRow(tourCopyId);
      if (row === null) continue;
      shown++;
      const outcome = await checkOne(
        row,
        `[${shown} of ${remaining}]`,
        { store, pair, rubricVersion, runId },
        io,
      );
      if (outcome === "quit") {
        quit = true;
        break;
      }
      if (outcome === "good" || outcome === "bad" || outcome === "skipped") counts[outcome]++;
    }

    io.out("");
    io.out(
      quit
        ? `Stopped early. This session: ${counts.good} good, ${counts.bad} bad, ${counts.skipped} skipped. Run it again to carry on.`
        : `This session: ${counts.good} good, ${counts.bad} bad, ${counts.skipped} skipped.`,
    );
    if (!quit && shown < remaining) {
      io.out(`  Only ${shown} of the ${remaining} rows asked for were available to draw.`);
    }

    printReport(buildAgreementReport(await store.reportRows(pair, rubricVersion)), io);
    return 0;
  } finally {
    await disconnect?.();
  }
}

// ---------------------------------------------------------------------------
// The Prisma store
// ---------------------------------------------------------------------------

export function createPrismaSpotcheckStore(prisma: PrismaService): SpotcheckStore {
  return {
    async pool(pair, rubricVersion) {
      const [published, evals, answered] = await Promise.all([
        prisma.tourCopy.findMany({
          where: { status: "published", aiSummary: { not: null }, ...pair },
          select: { id: true, generatedAt: true },
        }),
        prisma.tourCopyEval.findMany({
          where: { rubricVersion, promptVersion: pair.promptVersion, model: pair.model },
          select: { tourCopyId: true, copyGeneratedAt: true, evaluator: true },
        }),
        prisma.tourCopyEval.count({ where: { evaluator: "human", rubricVersion, ...pair } }),
      ]);
      const key = (id: string, at: Date): string => `${id}@${at.getTime()}`;
      const human = new Set(evals.filter((e) => e.evaluator === "human").map((e) => key(e.tourCopyId, e.copyGeneratedAt)));
      const judge = new Set(evals.filter((e) => e.evaluator === "judge").map((e) => key(e.tourCopyId, e.copyGeneratedAt)));
      const open = published.filter((copy) => !human.has(key(copy.id, copy.generatedAt)));
      return {
        judged: open.filter((copy) => judge.has(key(copy.id, copy.generatedAt))).map((copy) => copy.id),
        unjudged: open.filter((copy) => !judge.has(key(copy.id, copy.generatedAt))).map((copy) => copy.id),
        answered,
      };
    },

    async loadRow(tourCopyId) {
      const copy = await prisma.tourCopy.findUnique({
        where: { id: tourCopyId },
        select: {
          id: true,
          status: true,
          aiSummary: true,
          groundingHash: true,
          generatedAt: true,
          tour: {
            select: {
              id: true,
              title: true,
              description: true,
              durationMin: true,
              inclusions: true,
              exclusions: true,
              ratingAvg: true,
              ratingCount: true,
              deletedAt: true,
              experience: { select: { status: true } },
            },
          },
        },
      });
      if (!copy || !isServedCopy(copy.tour, copy)) return null;
      return {
        tourCopyId: copy.id,
        tourId: copy.tour.id,
        copyGeneratedAt: copy.generatedAt,
        paragraph: copy.aiSummary as string,
        source: copy.tour,
      };
    },

    async saveHuman(row, pair, answer, rubricVersion, runId) {
      const claims =
        answer.claimVerdict === "clean"
          ? []
          : [{ text: answer.note ?? "(no note)", verdict: answer.claimVerdict, evidenceQuote: "" }];
      const copy = await prisma.tourCopy.findUnique({ where: { id: row.tourCopyId }, select: { groundingHash: true } });
      try {
        await prisma.tourCopyEval.create({
          data: {
            tourCopyId: row.tourCopyId,
            copyGeneratedAt: row.copyGeneratedAt,
            judgedText: row.paragraph,
            promptVersion: pair.promptVersion,
            model: pair.model,
            groundingHash: copy?.groundingHash ?? "",
            evaluator: "human",
            evaluatorModel: null,
            rubricVersion,
            claims: claims as unknown as Prisma.InputJsonValue,
            claimVerdict: answer.claimVerdict,
            leadsWithFact: answer.leadsWithFact,
            evalRunId: runId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
        throw error;
      }
      return "saved";
    },

    async reportRows(pair, rubricVersion) {
      const evals = await prisma.tourCopyEval.findMany({
        where: {
          rubricVersion,
          promptVersion: pair.promptVersion,
          model: pair.model,
          tourCopy: { status: { in: ["published", "withdrawn"] } },
        },
        select: {
          evaluator: true,
          copyGeneratedAt: true,
          claimVerdict: true,
          claims: true,
          tourCopy: { select: { id: true, tourId: true, generatedAt: true, aiSummary: true } },
        },
      });
      const current = evals.filter((e) => e.copyGeneratedAt.getTime() === e.tourCopy.generatedAt.getTime());
      const judgeByCopy = new Map(current.filter((e) => e.evaluator === "judge").map((e) => [e.tourCopy.id, e.claimVerdict]));
      return current
        .filter((e) => e.evaluator === "human")
        .map((e) => {
          const claims = e.claims as unknown as Array<{ text: string }>;
          const note = claims[0]?.text;
          return {
            tourId: e.tourCopy.tourId,
            text: e.tourCopy.aiSummary ?? "",
            human: { claimVerdict: e.claimVerdict, note: note && note !== "(no note)" ? note : null },
            judge: judgeByCopy.get(e.tourCopy.id) ?? null,
          };
        });
    },
  };
}

if (require.main === module) {
  // BRI-210: long-running batch job (paid model calls), so ride out transient DB drops.
  setDbRetryProfile("import");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let ended = false;
  rl.on("close", () => {
    ended = true;
  });
  const io: SpotcheckIo = {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    isTty: Boolean(process.stdin.isTTY),
    ask: (question) =>
      ended
        ? Promise.resolve(null)
        : new Promise<string | null>((resolve) => {
            const onClose = (): void => resolve(null);
            rl.once("close", onClose);
            rl.question(question, (answer) => {
              rl.off("close", onClose);
              resolve(answer);
            });
          }),
  };
  main(process.argv.slice(2), process.env, io).then(
    (code) => {
      rl.close();
      process.exitCode = code;
    },
    (error: unknown) => {
      rl.close();
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
