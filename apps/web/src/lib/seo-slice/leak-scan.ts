/**
 * The leak, name and team scan and the link audit over a built slice page
 * (spec 0006 page template, AC-T6, AC-T9). `seo:leak-scan` runs it on
 * `.next/server/app/destinations/bangkok/*.html` after `next build`.
 *
 * Three surfaces per page: the visible text, the attribute values that show or
 * get shared (meta `content`, `alt`, `aria-label`, `title`) and the JSON-LD.
 * Other scripts are skipped on purpose: the framework's page data holds tokens
 * like `$1a` that would trip the currency rule.
 */

import { SEO_SLICE_TEAM_TERMS } from "@folio/shared";
import { SEO_SLICE_PREVIEW_TERMS } from "./preview";
import { containsPhrase, findLeakTerms } from "./text-checks";

export interface LeakScanContext {
  /** The manifest's `forbiddenNames`. */
  forbiddenNames: string[];
  /** Every `factCheck.by` value in the copy files. */
  factCheckBy: string[];
  liveSlugs: readonly string[];
  /** `SEO_SLICE_SITE_LINKS=1` at build (AC-T8, AC-T9). */
  siteLinks: boolean;
  /** The manifest's Good to know source urls, the only external links allowed. */
  sourceUrls: string[];
}

export interface PageSurfaces {
  text: string;
  attributes: string[];
  jsonLd: string[];
  hrefs: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}

export function extractSurfaces(html: string): PageSurfaces {
  const jsonLd = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

  const attributes: string[] = [];
  const hrefs: string[] = [];
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    if (/^<meta\b/i.test(tag)) {
      const content = attr(tag, "content");
      if (content !== null) attributes.push(content);
    }
    for (const name of ["alt", "aria-label", "title"]) {
      const value = attr(tag, name);
      if (value !== null) attributes.push(value);
    }
    if (/^<a\b/i.test(tag)) {
      const href = attr(tag, "href");
      if (href !== null) hrefs.push(href);
    }
  }
  return { text, attributes, jsonLd, hrefs };
}

/** Every rule the text breaks (AC-T6), as short labels. */
export function findTermProblems(text: string, ctx: LeakScanContext): string[] {
  const problems = findLeakTerms(text).map((t) => `leak term "${t}"`);
  for (const name of ["Atlas", ...ctx.forbiddenNames, ...ctx.factCheckBy]) {
    if (containsPhrase(text, name)) problems.push(`name "${name}"`);
  }
  for (const term of SEO_SLICE_TEAM_TERMS) {
    if (containsPhrase(text, term)) problems.push(`team term "${term}"`);
  }
  const lower = text.toLowerCase();
  for (const term of SEO_SLICE_PREVIEW_TERMS) {
    if (lower.includes(term.toLowerCase())) problems.push(`preview text "${term}"`);
  }
  return problems;
}

/** The link audit (AC-T9): internal links reach only live slice paths and click outs. */
export function findLinkProblems(hrefs: string[], ctx: LeakScanContext): string[] {
  // Same paths as `slicePagePaths` in seo-slice-gate.ts, which the CLI cannot import (it uses the `@/` alias).
  const internal = new Set(ctx.liveSlugs.map((slug) => `/destinations/bangkok/${slug}`));
  if (ctx.siteLinks) {
    internal.add("/");
    internal.add("/destinations/bangkok");
  }
  const external = new Set(ctx.sourceUrls);
  const problems: string[] = [];
  for (const href of hrefs) {
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) {
      if (!external.has(href)) problems.push(`external link "${href}" is not a Good to know source`);
    } else if (href.startsWith("/go/tours/")) {
      continue;
    } else if (!internal.has(href)) {
      problems.push(`internal link "${href}" is not a live slice path`);
    }
  }
  return problems;
}

/** Every problem in one built page, each prefixed with its surface. */
export function scanPage(html: string, ctx: LeakScanContext): string[] {
  const s = extractSurfaces(html);
  return [
    ...findTermProblems(s.text, ctx).map((p) => `text: ${p}`),
    ...s.attributes.flatMap((a) => findTermProblems(a, ctx).map((p) => `attribute "${a.slice(0, 80)}": ${p}`)),
    ...s.jsonLd.flatMap((j) => findTermProblems(j, ctx).map((p) => `JSON-LD: ${p}`)),
    ...findLinkProblems(s.hrefs, ctx).map((p) => `link: ${p}`),
  ];
}

/** The whole build: every page clean, and the files exactly the live set. */
export function scanBuild(files: Record<string, string>, ctx: LeakScanContext): string[] {
  const problems: string[] = [];
  const built = Object.keys(files).sort();
  const live = [...ctx.liveSlugs].sort();
  const missing = live.filter((s) => !built.includes(s));
  const extra = built.filter((s) => !live.includes(s));
  if (missing.length) problems.push(`live pages not prerendered: ${missing.join(", ")}`);
  if (extra.length) problems.push(`prerendered pages not in LIVE_SLUGS: ${extra.join(", ")}`);
  for (const slug of built) {
    for (const p of scanPage(files[slug], ctx)) problems.push(`${slug}: ${p}`);
  }
  return problems;
}
