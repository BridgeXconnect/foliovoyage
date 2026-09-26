import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { checkTourCopy } from "./tour-copy-check";
import { TOUR_COPY_JUDGE_MODEL_DEFAULT } from "./tour-copy-eval.constants";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import { RECORD_VERDICT_TOOL } from "./tour-copy-judge-result";
import { getJudgeRubric } from "./tour-copy-judge-rubric";
import { TOUR_COPY_SYSTEM_PROMPT } from "./tour-copy-prompt";
import { TOUR_COPY_MODEL_DEFAULT } from "./tour-copy.constants";

/**
 * The golden set and its stamp (BRI-201 / spec 0003, AC-14, AC-16). Pure apart
 * from the two file readers. The set is committed JSON under `golden/`: 60
 * tours with a reviewed reference paragraph, and 30 seeded paragraphs (20
 * planted defects and 10 clean controls) that the judge is tested against.
 */

export const GOLDEN_DIR = path.join(__dirname, "golden");
export const GOLDEN_TOURS_FILE = path.join(GOLDEN_DIR, "tour-copy-golden-tours.json");
export const GOLDEN_SEEDED_FILE = path.join(GOLDEN_DIR, "tour-copy-golden-seeded.json");
export const GOLDEN_STAMP_FILE = path.join(GOLDEN_DIR, "tour-copy-golden-stamp.json");
export const GOLDEN_REFERENCES_DRAFT_FILE = path.join(GOLDEN_DIR, "tour-copy-golden-references.draft.json");

export const GOLDEN_TOUR_COUNT = 60;
export const GOLDEN_SEEDED_COUNT = 30;
/** Of the 30 seeded paragraphs: 10 plain unsupported, 6 contradicted, 4 subtle, 10 clean controls (AC-14). */
export const GOLDEN_SEEDED_SHAPE = { unsupported: 10, contradicted: 6, subtle: 4, clean: 10, cleanNotLeading: 4 } as const;

/** A golden tour as the snapshot writes it: the five source fields, before Roy adds the reviewed reference paragraph. */
export interface GoldenTourSource extends TourCopyGroundingInput {
  id: string;
  stratum: string;
}

export interface GoldenTour extends GoldenTourSource {
  referenceParagraph: string;
}

export type GoldenClaimVerdict = "clean" | "unsupported" | "contradicted";

export interface GoldenSeeded {
  tourId: string;
  paragraph: string;
  claimVerdict: GoldenClaimVerdict;
  leadsWithFact: boolean;
  /** True for the 4 subtle defects, such as an invented number word or a paraphrase that changes the meaning. */
  subtle: boolean;
  /** One line saying what was planted, or why a clean control is clean. */
  defect: string;
}

export interface GoldenData {
  tours: GoldenTour[];
  seeded: GoldenSeeded[];
}

const TOUR_KEYS = ["id", "stratum", "title", "description", "durationMin", "inclusions", "exclusions", "referenceParagraph"];
const SNAPSHOT_TOUR_KEYS = TOUR_KEYS.filter((key) => key !== "referenceParagraph");
const SEEDED_KEYS = ["tourId", "paragraph", "claimVerdict", "leadsWithFact", "subtle", "defect"];
const FORBIDDEN_TOUR_KEYS = ["price", "priceFrom", "rating", "ratingAvg", "ratingCount", "reviewCount", "cancellation", "cancellationPolicy"];

const sameKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && [...expected].sort().every((key, index) => key === keys[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Problems with the shape of a snapshot (tours without reference paragraphs), for `--freeze-references`. */
export function validateSnapshotShape(tours: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(tours)) return ["The tours file is not a JSON array."];
  if (tours.length !== GOLDEN_TOUR_COUNT) problems.push(`Expected ${GOLDEN_TOUR_COUNT} tours, found ${tours.length}.`);
  const ids = new Set<string>();
  tours.forEach((tour, index) => {
    const at = `Tour ${index + 1}`;
    if (!isRecord(tour)) return void problems.push(`${at} is not an object.`);
    const allowed = "referenceParagraph" in tour ? TOUR_KEYS : SNAPSHOT_TOUR_KEYS;
    if (!sameKeys(tour, allowed)) {
      const forbidden = Object.keys(tour).filter((key) => FORBIDDEN_TOUR_KEYS.includes(key));
      problems.push(
        `${at} must hold exactly ${allowed.join(", ")}, found ${Object.keys(tour).sort().join(", ")}` +
          (forbidden.length > 0 ? ` (${forbidden.join(", ")} must never be in the golden set)` : "") +
          ".",
      );
    }
    if (typeof tour.id !== "string" || tour.id === "") problems.push(`${at} needs a non empty id.`);
    else if (ids.has(tour.id)) problems.push(`${at} repeats the id ${tour.id}.`);
    else ids.add(tour.id);
    if (typeof tour.stratum !== "string" || tour.stratum === "") problems.push(`${at} needs a stratum label.`);
    if (typeof tour.title !== "string") problems.push(`${at} needs a string title.`);
    if (tour.description !== null && typeof tour.description !== "string") problems.push(`${at} needs a string or null description.`);
    if (tour.durationMin !== null && typeof tour.durationMin !== "number") problems.push(`${at} needs a number or null durationMin.`);
  });
  return problems;
}

/** Every reason the golden data does not have the committed shape (AC-14). Empty when it does. */
export function validateGoldenData(tours: unknown, seeded: unknown): string[] {
  const problems = validateSnapshotShape(tours);
  if (!Array.isArray(tours)) return problems;

  (tours as unknown[]).forEach((tour, index) => {
    if (!isRecord(tour)) return;
    if (typeof tour.referenceParagraph !== "string" || tour.referenceParagraph.trim() === "") {
      problems.push(`Tour ${index + 1} needs a reference paragraph.`);
      return;
    }
    const result = checkTourCopy({ candidate: tour.referenceParagraph, source: tour as unknown as TourCopyGroundingInput });
    if (!result.passed) {
      problems.push(`The reference paragraph of tour ${index + 1} (${String(tour.id)}) fails the inline check: ${result.reasons.join(", ")}.`);
    }
  });

  if (!Array.isArray(seeded)) return [...problems, "The seeded file is not a JSON array."];
  if (seeded.length !== GOLDEN_SEEDED_COUNT) problems.push(`Expected ${GOLDEN_SEEDED_COUNT} seeded paragraphs, found ${seeded.length}.`);
  const tourIds = new Set((tours as unknown[]).filter(isRecord).map((tour) => tour.id));
  const counts = { unsupported: 0, contradicted: 0, subtle: 0, clean: 0, cleanNotLeading: 0 };
  seeded.forEach((entry, index) => {
    const at = `Seeded paragraph ${index + 1}`;
    if (!isRecord(entry)) return void problems.push(`${at} is not an object.`);
    if (!sameKeys(entry, SEEDED_KEYS)) problems.push(`${at} must hold exactly ${SEEDED_KEYS.join(", ")}.`);
    if (!tourIds.has(entry.tourId)) problems.push(`${at} names a tour that is not in the tours file.`);
    if (typeof entry.paragraph !== "string" || entry.paragraph.trim() === "") problems.push(`${at} needs a paragraph.`);
    if (typeof entry.defect !== "string" || entry.defect.trim() === "") problems.push(`${at} needs a one line defect description.`);
    if (typeof entry.leadsWithFact !== "boolean") problems.push(`${at} needs a boolean leadsWithFact.`);
    if (typeof entry.subtle !== "boolean") problems.push(`${at} needs a boolean subtle.`);
    if (entry.claimVerdict !== "clean" && entry.claimVerdict !== "unsupported" && entry.claimVerdict !== "contradicted") {
      return void problems.push(`${at} needs a claimVerdict of clean, unsupported or contradicted.`);
    }
    if (entry.claimVerdict === "clean") {
      counts.clean++;
      if (entry.leadsWithFact === false) counts.cleanNotLeading++;
      if (entry.subtle === true) problems.push(`${at} is a clean control and cannot be subtle.`);
    } else if (entry.subtle === true) counts.subtle++;
    else counts[entry.claimVerdict]++;
  });
  for (const key of Object.keys(GOLDEN_SEEDED_SHAPE) as Array<keyof typeof GOLDEN_SEEDED_SHAPE>) {
    if (counts[key] !== GOLDEN_SEEDED_SHAPE[key]) {
      problems.push(`Expected ${GOLDEN_SEEDED_SHAPE[key]} seeded ${key} paragraphs, found ${counts[key]}.`);
    }
  }
  return problems;
}

export class GoldenDataMissingError extends Error {
  constructor(readonly file: string) {
    super(`Golden file not found: ${file}`);
    this.name = "GoldenDataMissingError";
  }
}

export function readGoldenJson(file: string): unknown {
  if (!existsSync(file)) throw new GoldenDataMissingError(file);
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

export function goldenDataFilesPresent(): boolean {
  return existsSync(GOLDEN_TOURS_FILE) && existsSync(GOLDEN_SEEDED_FILE);
}

/** Reads and validates both golden files. Throws {@link GoldenDataMissingError}, or an Error naming every problem. */
export function loadGoldenData(): GoldenData {
  const tours = readGoldenJson(GOLDEN_TOURS_FILE);
  const seeded = readGoldenJson(GOLDEN_SEEDED_FILE);
  const problems = validateGoldenData(tours, seeded);
  if (problems.length > 0) throw new Error(`The golden data is not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return { tours: tours as GoldenTour[], seeded: seeded as GoldenSeeded[] };
}

// ---------------------------------------------------------------------------
// The stamp (AC-16)
// ---------------------------------------------------------------------------

/** JSON with every object's keys sorted, so a formatter or line endings never change a hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The stamp key (AC-16): sha256 of the generator system prompt, the judge
 * system prompt, the `record_verdict` tool schema, the rubric version, both
 * default models, and the hash of each golden file as canonical JSON. Editing
 * any of them changes the key, so CI fails until the golden run is repeated.
 * Each part is length prefixed so no two different inputs join to one string.
 */
export function computeGoldenStampKey(data: { tours: unknown; seeded: unknown }): string {
  const rubric = getJudgeRubric("tour_copy");
  const parts = [
    TOUR_COPY_SYSTEM_PROMPT,
    rubric.systemPrompt,
    canonicalJson(RECORD_VERDICT_TOOL),
    String(rubric.version),
    TOUR_COPY_MODEL_DEFAULT,
    TOUR_COPY_JUDGE_MODEL_DEFAULT,
    sha256(canonicalJson(data.tours)),
    sha256(canonicalJson(data.seeded)),
  ];
  return sha256(parts.map((part) => `${part.length}:${part}`).join("\n"));
}

export interface GoldenStamp {
  key: string;
  passed: true;
  runId: string;
  date: string;
  generatorModel: string;
  judgeModel: string;
  rubricVersion: number;
  promptVersion: number;
  partA: Record<string, unknown>;
  partB: Record<string, unknown>;
}

export function readGoldenStamp(): GoldenStamp | null {
  return existsSync(GOLDEN_STAMP_FILE) ? (JSON.parse(readFileSync(GOLDEN_STAMP_FILE, "utf8")) as GoldenStamp) : null;
}
