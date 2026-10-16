/**
 * The SEO slice manifest, validated in apps/api (spec 0006 prod snapshot,
 * AC-S2). Mirrors the shared `SeoSliceManifest` type and the value rules in
 * index.md (Manifest), which apps/web's `src/lib/seo-slice/validate.ts`
 * checks the same way before `seo:index` writes anything. An invalid manifest
 * stops `seo:snapshot` before it writes a file.
 */

import { z } from "zod";
import type { SeoSliceManifest } from "@folio/shared";
import { findLeakTerms, phrasesMatcher } from "./seo-slice-text";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const pattern = z.string().refine(
  (p) => {
    if (!p) return false;
    try {
      new RegExp(p, "i");
      return true;
    } catch {
      return false;
    }
  },
  { message: "is not a valid pattern" },
);
const text = z.string().refine((s) => s.trim().length > 0, { message: "is blank" });

const sourceFact = z.object({
  fact: text.refine((s) => findLeakTerms(s).length === 0, { message: "holds a leak term" }),
  url: z.string().startsWith("https://", { message: "is not https" }),
  checked: z.string().regex(DATE, { message: "is not a YYYY-MM-DD date" }),
});

const page = z.object({
  slug: text,
  kind: z.enum(["hub", "category", "stats"]),
  targetQuery: z.string().nullable(),
  h1: text,
  held: z.boolean().optional(),
  rule: z.object({ tagIds: z.array(z.number().int()), titlePattern: pattern, plainWords: text }).optional(),
  groups: z.array(z.object({ id: text, label: text, titlePattern: pattern })).optional(),
  otherLabel: z.string().optional(),
  keywordGroupIds: z.array(z.string()).optional(),
  excludePlaces: z.array(z.string()).optional(),
  ogImageExperienceId: z.string().optional(),
  sourceFacts: z.array(sourceFact).max(5).optional(),
});

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    city: z.object({ slug: text, countrySlug: text, name: text, destinationRef: text }),
    exclusions: z.object({
      offCityTitlePattern: pattern,
      excludeTagIds: z.array(z.number().int()),
      maxDurationMin: z.number().int().positive(),
      plainWords: text,
    }),
    forbiddenNames: z.array(text).min(1, { message: "is empty (Roy fills it before the slice can run)" }),
    tagNames: z.record(z.string(), z.string()),
    keywordGroups: z.record(z.string(), z.object({ label: text, phrases: z.array(z.string()) })),
    defaultKeywordGroupIds: z.array(z.string()),
    places: z.array(text),
    excludedExperiences: z.array(z.object({ experienceId: text, reason: text })),
    pages: z.array(page),
  })
  .superRefine((m, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: "custom", message });

    const slugs = m.pages.map((p) => p.slug);
    const dupes = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
    if (dupes.length) problem(`repeated slugs ${dupes.join(", ")}`);
    for (const kind of ["hub", "stats"] as const) {
      const n = m.pages.filter((p) => p.kind === kind).length;
      if (n !== 1) problem(`needs exactly one ${kind} page, found ${n}`);
    }

    for (const name of m.forbiddenNames) {
      const matches = phrasesMatcher([name]);
      for (const place of m.places) {
        if (matches(place)) problem(`forbidden name "${name}" matches the place "${place}"`);
      }
    }

    const usedTagIds = new Set(m.exclusions.excludeTagIds);
    for (const p of m.pages) for (const id of p.rule?.tagIds ?? []) usedTagIds.add(id);
    for (const id of usedTagIds) if (!m.tagNames[String(id)]?.trim()) problem(`tag ${id} has no entry in tagNames`);

    const groupIds = new Set(Object.keys(m.keywordGroups));
    for (const id of m.defaultKeywordGroupIds) if (!groupIds.has(id)) problem(`defaultKeywordGroupIds names unknown group ${id}`);

    // No digits in anything the rule line or a method note prints (index.md, Manifest).
    const printed: [string, string][] = [["exclusions.plainWords", m.exclusions.plainWords]];
    for (const [id, g] of Object.entries(m.keywordGroups)) printed.push([`keywordGroups.${id}.label`, g.label]);
    m.places.forEach((p, i) => printed.push([`places[${i}]`, p]));

    for (const p of m.pages) {
      const at = `page ${p.slug}`;
      if (p.kind !== "category") {
        if (p.rule) problem(`${at}: a ${p.kind} page has no rule`);
        if (p.kind === "stats" && p.targetQuery !== null) problem(`${at}: the stats page has targetQuery null`);
        continue;
      }
      if (!p.rule) {
        problem(`${at}: a category page needs a rule`);
        continue;
      }
      printed.push([`${p.slug} rule.plainWords`, p.rule.plainWords]);
      for (const id of p.rule.tagIds) printed.push([`tagNames.${id}`, m.tagNames[String(id)] ?? ""]);
      if (p.otherLabel !== undefined) printed.push([`${p.slug} otherLabel`, p.otherLabel]);
      const seen = new Set<string>();
      for (const g of p.groups ?? []) {
        if (seen.has(g.id)) problem(`${at}: group id ${g.id} repeats`);
        seen.add(g.id);
        printed.push([`${p.slug} group ${g.id} label`, g.label]);
      }
      for (const id of p.keywordGroupIds ?? m.defaultKeywordGroupIds) {
        if (!groupIds.has(id)) problem(`${at}: keywordGroupIds names unknown group ${id}`);
      }
    }

    for (const [where, value] of printed) {
      if (/\d/.test(value)) problem(`${where} holds a digit ("${value}"); the rule line and method notes print no numbers`);
    }
  });

export type SeoSliceManifestResult = { ok: true; manifest: SeoSliceManifest } | { ok: false; problems: string[] };

/** Parses and checks a manifest; `problems` names each failure with its path. */
export function parseSeoSliceManifest(raw: unknown): SeoSliceManifestResult {
  const result = manifestSchema.safeParse(raw);
  if (result.success) return { ok: true, manifest: result.data as SeoSliceManifest };
  return {
    ok: false,
    problems: result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")} ${i.message}` : i.message)),
  };
}
