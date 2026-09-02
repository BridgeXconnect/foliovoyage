import { describe, expect, it } from "@jest/globals";

import { incrementData } from "./increment-data";
import { ImportRunCounts } from "./import.pipeline";

/**
 * Unit tests for `incrementData` (BRI-176's persistence shape, extended by
 * BRI-181 to also carry `lastCursor`). Pulled into its own module so it can
 * be tested directly without importing `segment-worker.cli.ts`, whose
 * unconditional top-level `void main()` would otherwise run on import.
 */
describe("incrementData", () => {
  it("includes lastCursor when this segment observed one", () => {
    const counts = new ImportRunCounts();
    counts.fetched = 5;
    counts.cursor = null; // crawl reached its true end
    counts.lastCursor = "cursor-4";

    const data = incrementData(counts);

    expect(data.cursor).toBeNull();
    expect(data.lastCursor).toBe("cursor-4");
  });

  it("omits lastCursor when this segment saw no page with a nextCursor, so an already-persisted row value survives", () => {
    const counts = new ImportRunCounts();
    counts.fetched = 1;
    counts.cursor = null;
    // counts.lastCursor stays at its default null -- this segment's only
    // page was already the crawl's true, terminal last page (BRI-181: see
    // import.pipeline.spec.ts's "segment 3" case for the scenario this
    // guards against -- without this guard, this update would overwrite an
    // earlier segment's already-persisted lastCursor with null).
    const data = incrementData(counts);

    expect("lastCursor" in data).toBe(false);
  });

  it("carries lastCursor mid-crawl (cursor non-null) the same as lastPage", () => {
    const counts = new ImportRunCounts();
    counts.cursor = "cursor-9";
    counts.lastPage = 9;
    counts.lastCursor = "cursor-9";

    const data = incrementData(counts);

    expect(data).toMatchObject({
      cursor: "cursor-9",
      lastPage: 9,
      lastCursor: "cursor-9",
    });
  });

  it("always writes cursor unconditionally, even null, unlike the guarded lastPage/lastCursor", () => {
    const counts = new ImportRunCounts();
    // Defaults: cursor null, lastPage null, lastCursor null.
    const data = incrementData(counts);

    expect("cursor" in data).toBe(true);
    expect(data.cursor).toBeNull();
    expect("lastPage" in data).toBe(false);
    expect("lastCursor" in data).toBe(false);
  });
});
