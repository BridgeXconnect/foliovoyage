import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import type { SeoSliceManifest } from "@folio/shared";
import { fixtureContent, fixtureManifest } from "./fixture";
import { SLICE_CONTENT_DIR } from "./index-files";
import { findFirstPerson, findLeakTerms } from "./text-checks";
import { validateContent, validateManifest } from "./validate";

describe("text checks", () => {
  it("finds leak terms by prefix, whole word, symbol and currency", () => {
    expect(findLeakTerms("Highly rated, with reviews")).toEqual(expect.arrayContaining(["rated", "review"]));
    expect(findLeakTerms("five ★ tours")).toContain("★");
    expect(findLeakTerms("from $20")).not.toEqual([]);
    expect(findLeakTerms("about 200 THB")).not.toEqual([]);
    expect(findLeakTerms("Book now to go")).toContain("book now");
    expect(findLeakTerms("A quiet morning by the river")).toEqual([]);
  });

  it("finds first person and team wording", () => {
    expect(findFirstPerson("I loved it")).not.toEqual([]);
    expect(findFirstPerson("We’ve been twice")).not.toEqual([]);
    expect(findFirstPerson("Our editors say go early")).not.toEqual([]);
    expect(findFirstPerson("Go early, the boats fill up")).toEqual([]);
  });
});

describe("validateManifest", () => {
  it("accepts the fixture", () => {
    expect(validateManifest(fixtureManifest())).toEqual([]);
  });

  it("needs forbidden names, one hub, one stats page and no digits in printed strings", () => {
    const m = fixtureManifest();
    m.forbiddenNames = [];
    m.pages = m.pages.filter((p) => p.kind !== "stats");
    m.places.push("Soi 38");
    const problems = validateManifest(m).join("\n");
    expect(problems).toMatch(/forbiddenNames is empty/);
    expect(problems).toMatch(/exactly one stats page/);
    expect(problems).toMatch(/places\[2\] holds a digit/);
  });
});

describe("validateManifest on the real manifest (spec 0006 AC-M1, AC-M10)", () => {
  const real = JSON.parse(readFileSync(path.join(SLICE_CONTENT_DIR, "manifest.json"), "utf8")) as SeoSliceManifest;

  it("accepts manifest.json as committed", () => {
    expect(validateManifest(real)).toEqual([]);
  });

  it("rejects an image exclusion without a reason", () => {
    const m = structuredClone(real);
    m.excludedExperiences = [{ experienceId: "exp-1", reason: " " }];
    expect(validateManifest(m)).toContain("manifest: excludedExperiences[0] has no reason");
    m.excludedExperiences = [{ experienceId: "exp-1", reason: "image is a logo, not the tour" }];
    expect(validateManifest(m)).toEqual([]);
  });
});

describe("validateContent", () => {
  it("rejects a notes file that names a tour or leaks a price", () => {
    const content = fixtureContent();
    content.notes["food-tours"] = {
      schemaVersion: 1,
      slug: "food-tours",
      notes: [{ id: "n1", kind: "timing", basis: "firsthand", written: "2026-10-01", text: "A food-tours tour is worth $30" }],
    };
    const problems = validateContent(content).join("\n");
    expect(problems).toMatch(/names the tour/);
    expect(problems).toMatch(/leak terms/);
  });

  it("rejects content files without a manifest", () => {
    const content = fixtureContent();
    content.manifest = null;
    expect(validateContent(content)[0]).toMatch(/manifest.json does not/);
  });
});
