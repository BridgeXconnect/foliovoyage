/**
 * Thin-source rule for AI tour-copy generation (BRI-154 / spec 0002, AC-1).
 *
 * A tour whose title, description, and inclusions/exclusions checklist text
 * add up to under {@link MIN_SOURCE_CHARS} characters is skipped with reason
 * `source_too_thin` rather than handed to the model, which would otherwise
 * have to invent detail to fill a paragraph. Pure, no DB/network/clock, same
 * shape as `tour-copy-eligibility.ts`.
 *
 * Deliberately separate from the grounding hash
 * (`tour-copy-grounding-hash.ts`): the hash treats inclusions/exclusions as
 * opaque JSON (key order doesn't matter, array order does) because it only
 * needs to detect *any* change; this only cares how much readable text they
 * carry, so it flattens each checklist item's descriptive fields into plain
 * text and sums their lengths.
 */

/** A tour's combined source text must be at least this many characters (AC-1). */
export const MIN_SOURCE_CHARS = 300;

/** The fields the thin-source check reads. A Prisma `Tour` row satisfies it. */
export interface TourCopySourceTextInput {
  title: string;
  description: string | null;
  inclusions: unknown;
  exclusions: unknown;
}

/**
 * Combined character count of `title`, `description` (empty when null), and
 * the flattened text of `inclusions` + `exclusions`.
 */
export function combinedSourceTextLength(input: TourCopySourceTextInput): number {
  const parts = [
    input.title,
    input.description ?? "",
    checklistText(input.inclusions),
    checklistText(input.exclusions),
  ];
  return parts.join("").length;
}

/**
 * Flattens a checklist (`inclusions` or `exclusions`, the
 * `TourIncludedItemDTO[]` shape from `normalizer.ts`, read here as opaque
 * JSON) into plain text: each item's `categoryDescription`,
 * `typeDescription`, and `description` fields (skipping nulls and anything
 * not a string), space-joined across every item. Anything that isn't an
 * array — `null`, `[]`, or a malformed value — reads as no text.
 *
 * Exported so the deterministic check (`tour-copy-check.ts`) can build the
 * same "readable source text" this module sums the length of, rather than
 * re-implementing checklist flattening a second way.
 */
export function checklistText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const fields: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["categoryDescription", "typeDescription", "description"]) {
      const fieldValue = record[key];
      if (typeof fieldValue === "string") fields.push(fieldValue);
    }
  }
  return fields.join(" ");
}
