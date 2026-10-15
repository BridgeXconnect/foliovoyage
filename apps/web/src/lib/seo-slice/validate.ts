/**
 * Validation `seo:index` runs before it writes anything (spec 0006 index.md:
 * Manifest schema, Notes file schema, Live set). Each function returns a list
 * of problems; an empty list means valid. Any problem fails `seo:index` with
 * nothing written.
 */

import type { SeoSliceManifest, SeoSliceManifestPage, SeoSliceSourceFact } from "@folio/shared";
import { containsPhrase, findFirstPerson, findLeakTerms } from "./text-checks";
import type { SliceContent } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_KINDS = new Set(["timing", "how-to", "opinion", "warning"]);

function isValidRegExp(pattern: unknown): boolean {
  if (typeof pattern !== "string" || !pattern) return false;
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

const hasDigit = (s: string) => /\d/.test(s);

/** The keyword group ids a page uses: its own set, else the manifest default. */
export function keywordGroupIdsFor(manifest: SeoSliceManifest, page: SeoSliceManifestPage): string[] {
  return page.keywordGroupIds ?? manifest.defaultKeywordGroupIds;
}

export function validateSourceFacts(slug: string, facts: SeoSliceSourceFact[] | undefined): string[] {
  const problems: string[] = [];
  const list = facts ?? [];
  if (list.length > 5) problems.push(`${slug}: sourceFacts holds ${list.length} entries, at most 5`);
  list.forEach((f, i) => {
    const where = `${slug}: sourceFacts[${i}]`;
    if (!f.fact?.trim()) problems.push(`${where} has no fact`);
    const leaks = findLeakTerms(f.fact ?? "");
    if (leaks.length) problems.push(`${where} holds leak terms: ${leaks.join(", ")}`);
    if (typeof f.url !== "string" || !f.url.startsWith("https://")) problems.push(`${where} url is not https`);
    if (typeof f.checked !== "string" || !DATE.test(f.checked)) problems.push(`${where} checked is not a YYYY-MM-DD date`);
  });
  return problems;
}

export function validateManifest(manifest: SeoSliceManifest): string[] {
  const problems: string[] = [];
  if (manifest.schemaVersion !== 1) problems.push(`manifest: schemaVersion must be 1`);

  const pages = manifest.pages ?? [];
  const slugs = pages.map((p) => p.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupes.length) problems.push(`manifest: repeated slugs ${[...new Set(dupes)].join(", ")}`);
  for (const kind of ["hub", "stats"] as const) {
    const n = pages.filter((p) => p.kind === kind).length;
    if (n !== 1) problems.push(`manifest: needs exactly one ${kind} page, found ${n}`);
  }

  // Personal names (AC-7): Roy fills the list; empty or blank entries fail.
  const names = manifest.forbiddenNames ?? [];
  if (names.length === 0) problems.push("manifest: forbiddenNames is empty (Roy fills it before the slice can run)");
  names.forEach((n, i) => {
    if (typeof n !== "string" || !n.trim()) problems.push(`manifest: forbiddenNames[${i}] is blank`);
  });
  for (const name of names.filter((n) => typeof n === "string" && n.trim())) {
    for (const place of manifest.places ?? []) {
      if (containsPhrase(place, name)) {
        problems.push(`manifest: forbidden name "${name}" matches the place "${place}"; forbid the name or list the place, not both`);
      }
    }
  }

  if (!isValidRegExp(manifest.exclusions?.offCityTitlePattern)) problems.push("manifest: exclusions.offCityTitlePattern is not a valid pattern");
  if (!manifest.exclusions?.plainWords?.trim()) problems.push("manifest: exclusions.plainWords is missing");

  // Every tag id the manifest uses needs a name.
  const usedTagIds = new Set<number>(manifest.exclusions?.excludeTagIds ?? []);
  for (const p of pages) for (const id of p.rule?.tagIds ?? []) usedTagIds.add(id);
  for (const id of usedTagIds) {
    if (!manifest.tagNames?.[String(id)]) problems.push(`manifest: tag ${id} has no entry in tagNames`);
  }

  const groupIds = new Set(Object.keys(manifest.keywordGroups ?? {}));
  for (const id of manifest.defaultKeywordGroupIds ?? []) {
    if (!groupIds.has(id)) problems.push(`manifest: defaultKeywordGroupIds names unknown group ${id}`);
  }

  // No digits in anything the rule line or a method note prints (index.md).
  const printed: [string, string][] = [["exclusions.plainWords", manifest.exclusions?.plainWords ?? ""]];
  for (const [id, g] of Object.entries(manifest.keywordGroups ?? {})) printed.push([`keywordGroups.${id}.label`, g.label ?? ""]);
  (manifest.places ?? []).forEach((p, i) => printed.push([`places[${i}]`, p]));

  for (const page of pages) {
    const at = `manifest page ${page.slug}`;
    if (!page.h1?.trim()) problems.push(`${at}: no h1`);
    problems.push(...validateSourceFacts(page.slug, page.sourceFacts));
    if (page.kind !== "category") {
      if (page.rule) problems.push(`${at}: a ${page.kind} page has no rule`);
      if (page.kind === "stats" && page.targetQuery !== null) problems.push(`${at}: the stats page has targetQuery null`);
      continue;
    }
    if (!page.rule) {
      problems.push(`${at}: a category page needs a rule`);
      continue;
    }
    if (!isValidRegExp(page.rule.titlePattern)) problems.push(`${at}: rule.titlePattern is not a valid pattern`);
    if (!page.rule.plainWords?.trim()) problems.push(`${at}: rule.plainWords is missing`);
    printed.push([`${page.slug} rule.plainWords`, page.rule.plainWords ?? ""]);
    for (const id of page.rule.tagIds ?? []) printed.push([`tagNames.${id}`, manifest.tagNames?.[String(id)] ?? ""]);
    if (page.otherLabel !== undefined) printed.push([`${page.slug} otherLabel`, page.otherLabel]);
    const seen = new Set<string>();
    for (const g of page.groups ?? []) {
      if (seen.has(g.id)) problems.push(`${at}: group id ${g.id} repeats`);
      seen.add(g.id);
      if (!g.label?.trim()) problems.push(`${at}: group ${g.id} has no label`);
      else printed.push([`${page.slug} group ${g.id} label`, g.label]);
      if (!isValidRegExp(g.titlePattern)) problems.push(`${at}: group ${g.id} titlePattern is not a valid pattern`);
    }
    for (const id of keywordGroupIdsFor(manifest, page)) {
      if (!groupIds.has(id)) problems.push(`${at}: keywordGroupIds names unknown group ${id}`);
    }
  }

  for (const [where, text] of printed) {
    if (hasDigit(text)) problems.push(`manifest: ${where} holds a digit ("${text}"); the rule line and method notes print no numbers`);
  }
  return problems;
}

/**
 * Notes files (index.md, Notes file schema): only for a category page that is
 * not held; schema; leak list; first person; and the name check against every
 * pick in every snapshot.
 */
export function validateNotes(content: SliceContent): string[] {
  const problems: string[] = [];
  const manifest = content.manifest;
  const picks = Object.values(content.snapshots).flatMap((s) => s.picks ?? []);

  for (const [slug, file] of Object.entries(content.notes)) {
    const at = `${slug}.notes.json`;
    const page = manifest?.pages.find((p) => p.slug === slug);
    if (!page) {
      problems.push(`${at}: no manifest page has this slug`);
      continue;
    }
    if (page.kind !== "category") problems.push(`${at}: notes belong to category pages only, not the ${page.kind}`);
    if (page.held) problems.push(`${at}: ${slug} is held, so it takes no notes file`);
    if (file.schemaVersion !== 1) problems.push(`${at}: schemaVersion must be 1`);
    if (file.slug !== slug) problems.push(`${at}: slug field says ${file.slug}`);

    const ids = new Set<string>();
    for (const [i, note] of (file.notes ?? []).entries()) {
      const n = `${at} note ${note.id ?? i}`;
      if (!note.id) problems.push(`${n}: no id`);
      else if (ids.has(note.id)) problems.push(`${n}: id repeats`);
      ids.add(note.id);
      if (!NOTE_KINDS.has(note.kind)) problems.push(`${n}: kind must be timing, how-to, opinion or warning`);
      if (note.basis !== "firsthand") problems.push(`${n}: basis must be firsthand`);
      if (typeof note.written !== "string" || !DATE.test(note.written)) problems.push(`${n}: written is not a YYYY-MM-DD date`);
      const text = typeof note.text === "string" ? note.text : "";
      if (text.length < 1 || text.length > 400) problems.push(`${n}: text must be 1 to 400 characters`);
      const leaks = findLeakTerms(text);
      if (leaks.length) problems.push(`${n}: leak terms ${leaks.join(", ")}`);
      const firstPerson = findFirstPerson(text);
      if (firstPerson.length) problems.push(`${n}: first person or team wording ${firstPerson.join(", ")}`);
      const lower = text.toLowerCase();
      for (const pick of picks) {
        if (lower.includes(pick.providerTourId.toLowerCase()) || lower.includes(pick.title.toLowerCase())) {
          problems.push(`${n}: names the tour "${pick.title}" (${pick.providerTourId})`);
        }
      }
    }
  }
  return problems;
}

/** Snapshot and copy files must belong to a manifest page and say their own slug. */
export function validateFiles(content: SliceContent): string[] {
  const problems: string[] = [];
  const known = new Set(content.manifest?.pages.map((p) => p.slug) ?? []);
  for (const [kind, files] of [
    ["snapshot", content.snapshots],
    ["copy", content.copies],
  ] as const) {
    for (const [slug, file] of Object.entries(files)) {
      const at = `${slug}.${kind}.json`;
      if (!known.has(slug)) problems.push(`${at}: no manifest page has this slug`);
      if (file.schemaVersion !== 1) problems.push(`${at}: schemaVersion must be 1`);
      if (file.slug !== slug) problems.push(`${at}: slug field says ${file.slug}`);
    }
  }
  return problems;
}

export function validateContent(content: SliceContent): string[] {
  const fileProblems = validateFiles(content);
  if (!content.manifest) {
    const stray = [...Object.keys(content.snapshots), ...Object.keys(content.copies), ...Object.keys(content.notes)];
    return stray.length ? [`content files exist (${stray.join(", ")}) but manifest.json does not`] : [];
  }
  return [...validateManifest(content.manifest), ...fileProblems, ...validateNotes(content)];
}
