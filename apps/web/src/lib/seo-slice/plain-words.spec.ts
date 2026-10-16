import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import type { SeoSliceManifest } from "@folio/shared";
import { SLICE_CONTENT_DIR } from "./index-files";

/**
 * A category page prints `rule.plainWords` as its rule in plain words (spec
 * 0006 AC-M1), so the words and `rule.titlePattern` must say the same thing:
 * each phrase in the words matches the pattern, and each alternative in the
 * pattern appears in the words. Phrases are split on commas and "or".
 */

const manifest = JSON.parse(readFileSync(path.join(SLICE_CONTENT_DIR, "manifest.json"), "utf8")) as SeoSliceManifest;
const categoryPages = manifest.pages.filter((p) => p.kind === "category");

function phrases(plainWords: string): string[] {
  return plainWords
    .split(/,|\bor\b/i)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

/**
 * Expands a rule pattern of the shape `\b<prefix>(<a>|<b>|...)<suffix>\b`, or
 * `\b<words>\b`, into its alternatives, with a trailing `s?` dropped to the
 * singular. Throws on any other regex syntax, so a pattern this test cannot
 * read fails loudly instead of passing unchecked.
 */
function alternatives(titlePattern: string): string[] {
  const shape = /^\\b([^()|\\]*)(?:\(([^()\\]*)\))?([^()|\\]*)\\b$/.exec(titlePattern);
  if (!shape) throw new Error(`cannot expand pattern ${titlePattern}`);
  const [, prefix, group, suffix] = shape;
  const expanded = group === undefined ? [prefix + suffix] : group.split("|").map((alt) => prefix + alt + suffix);
  return expanded.map((alt) => {
    const singular = alt.replace(/s\?$/, "");
    if (!/^[a-z ]+$/i.test(singular)) throw new Error(`cannot expand alternative ${alt} in ${titlePattern}`);
    return singular.toLowerCase();
  });
}

describe("category rule plain words match the title pattern (spec 0006 AC-M1)", () => {
  it("covers every category page", () => {
    expect(categoryPages.length).toBeGreaterThan(0);
    for (const page of categoryPages) expect(page.rule).toBeDefined();
  });

  it.each(categoryPages.map((p) => [p.slug, p] as const))("%s: each plain word phrase matches the pattern", (_slug, page) => {
    const pattern = new RegExp(page.rule!.titlePattern, "i");
    const unmatched = phrases(page.rule!.plainWords).filter((p) => !pattern.test(p));
    expect(unmatched).toEqual([]);
  });

  it.each(categoryPages.map((p) => [p.slug, p] as const))("%s: each pattern alternative appears in the plain words", (_slug, page) => {
    const words = phrases(page.rule!.plainWords);
    const missing = alternatives(page.rule!.titlePattern).filter(
      (alt) => !words.some((w) => alt === w || alt === `${w}s` || alt === `${w}es`),
    );
    expect(missing).toEqual([]);
  });
});

describe("off city places in exclusions.plainWords match offCityTitlePattern (spec 0006 AC-M3)", () => {
  // The places sit in the one parenthesised list in the exclusions' plain words.
  const listed = /\(([^()]*)\)/.exec(manifest.exclusions.plainWords);
  const places = listed ? phrases(listed[1]) : [];

  it("lists the places in parentheses", () => {
    expect(places.length).toBeGreaterThan(0);
  });

  it("each place in the plain words matches the pattern", () => {
    const pattern = new RegExp(manifest.exclusions.offCityTitlePattern, "i");
    expect(places.filter((p) => !pattern.test(p))).toEqual([]);
  });

  it("each pattern alternative appears in the plain words", () => {
    expect(alternatives(manifest.exclusions.offCityTitlePattern).filter((alt) => !places.includes(alt))).toEqual([]);
  });
});
