import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { fixtureContent } from "./fixture";
import { buildIndex, generatedPages, LIVE_FILE, PAGES_FILE, readSliceContent, SLICE_CONTENT_DIR } from "./index-files";

describe("seo:index staleness (spec 0006 AC-1, AC-2)", () => {
  it("the committed generated files match what seo:index would write now", () => {
    const build = buildIndex(readSliceContent(SLICE_CONTENT_DIR));
    expect(build.problems).toEqual([]);
    for (const file of [LIVE_FILE, PAGES_FILE] as const) {
      const onDisk = readFileSync(path.join(SLICE_CONTENT_DIR, file), "utf8");
      // A failure here means someone edited a content file without running
      // `pnpm --filter @folio/web seo:index`.
      expect([file, onDisk]).toEqual([file, build.files[file]]);
    }
  });
});

describe("generated pages (spec 0006 AC-9)", () => {
  it("carry no eligible block", () => {
    const pages = generatedPages(fixtureContent());
    expect(Object.keys(pages)).toEqual(["things-to-do", "food-tours", "floating-markets", "tour-facts"]);
    for (const page of Object.values(pages)) {
      expect(page.snapshot).not.toBeNull();
      expect(page.snapshot).not.toHaveProperty("eligible");
    }
    expect(buildIndex(fixtureContent()).files[PAGES_FILE]).not.toContain("eligible");
  });

  it("the fixture is valid and fully live", () => {
    const build = buildIndex(fixtureContent());
    expect(build.problems).toEqual([]);
    expect(build.files[LIVE_FILE]).toContain('["things-to-do","food-tours","floating-markets","tour-facts"]');
  });
});
