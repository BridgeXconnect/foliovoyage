import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSeoSliceManifest } from "./seo-slice-manifest-schema";

/** Spec 0006 prod snapshot, AC-S2: the manifest rules from index.md, checked in apps/api. */

const MANIFEST_PATH = path.resolve(__dirname, "../../../../web/src/content/seo/bangkok/manifest.json");
/** A manifest the tests break on purpose, so it is loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const fresh = (): Loose => JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const problemsOf = (m: unknown) => {
  const r = parseSeoSliceManifest(m);
  return r.ok ? [] : r.problems;
};
const category = (m: Loose): Loose => m.pages.find((p: Loose) => p.kind === "category");

describe("parseSeoSliceManifest (AC-S2)", () => {
  it("accepts the real manifest", () => {
    expect(problemsOf(fresh())).toEqual([]);
  });

  it("accepts a category page with no tag ids, and a tag name no page uses", () => {
    const m = fresh();
    category(m).rule.tagIds = [];
    m.tagNames["999999"] = "Unused Tag 2";
    expect(problemsOf(m)).toEqual([]);
  });

  it("refuses an empty forbiddenNames and a blank entry in it", () => {
    const empty = fresh();
    empty.forbiddenNames = [];
    expect(problemsOf(empty).join("\n")).toMatch(/forbiddenNames is empty/);

    const blank = fresh();
    blank.forbiddenNames = ["Roy", "  "];
    expect(problemsOf(blank).join("\n")).toMatch(/forbiddenNames\.1 is blank/);
  });

  it("refuses an excludedExperiences entry with no reason", () => {
    const m = fresh();
    m.excludedExperiences = [{ experienceId: "exp-1", reason: " " }];
    expect(problemsOf(m).join("\n")).toMatch(/excludedExperiences\.0\.reason is blank/);
    m.excludedExperiences = [{ experienceId: "exp-1" }];
    expect(problemsOf(m)).not.toEqual([]);
  });

  it("refuses a digit in any printed string", () => {
    const cases: ((m: Loose) => void)[] = [
      (m) => (m.exclusions.plainWords = "tours over 24 hours"),
      (m) => (m.keywordGroups.pickup.label = "pickup in 5 zones"),
      (m) => m.places.push("Soi 11"),
      (m) => (category(m).rule.plainWords = "top 10 markets"),
      (m) => (category(m).otherLabel = "Other 3 tours"),
      (m) => (category(m).groups[0].label = "Group 1"),
      (m) => (m.tagNames[String(m.pages.find((p: Loose) => p.slug === "spa-and-massage").rule.tagIds[0])] = "Spas 2"),
    ];
    for (const edit of cases) {
      const m = fresh();
      edit(m);
      expect(problemsOf(m).join("\n")).toMatch(/holds a digit/);
    }
  });

  it("refuses the other structural and value rules", () => {
    const cases: [(m: Loose) => void, RegExp][] = [
      [(m) => (m.schemaVersion = 2), /schemaVersion/],
      [(m) => m.pages.push({ ...m.pages[1] }), /repeated slugs/],
      [(m) => (m.pages = m.pages.filter((p: { kind: string }) => p.kind !== "stats")), /exactly one stats page/],
      [(m) => (m.exclusions.offCityTitlePattern = "("), /offCityTitlePattern is not a valid pattern/],
      [(m) => m.exclusions.excludeTagIds.push(424242), /tag 424242 has no entry in tagNames/],
      [(m) => m.defaultKeywordGroupIds.push("nope"), /unknown group nope/],
      [(m) => (category(m).keywordGroupIds = ["nope"]), /keywordGroupIds names unknown group nope/],
      [(m) => delete category(m).rule, /a category page needs a rule/],
      [(m) => (category(m).rule.titlePattern = "["), /titlePattern is not a valid pattern/],
      [(m) => m.forbiddenNames.push("Wat Pho"), /forbidden name "Wat Pho" matches the place/],
      [
        (m) => (category(m).sourceFacts = [{ fact: "Highly rated by all", url: "https://x.test", checked: "2026-10-01" }]),
        /leak term/,
      ],
      [(m) => (category(m).sourceFacts = [{ fact: "Busy at dawn", url: "http://x.test", checked: "2026-10-01" }]), /not https/],
    ];
    for (const [edit, expected] of cases) {
      const m = fresh();
      edit(m);
      expect(problemsOf(m).join("\n")).toMatch(expected);
    }
  });
});
