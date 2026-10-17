import { describe, expect, it } from "@jest/globals";
import { approve, fixtureContent } from "./fixture";
import { deriveLiveSet } from "./live-set";

const ALL = ["things-to-do", "food-tours", "floating-markets", "tour-facts"];

describe("deriveLiveSet (spec 0006 AC-2)", () => {
  it("every ready page is live when the hub and all listed pages are ready", () => {
    const result = deriveLiveSet(fixtureContent());
    expect(result.liveSlugs).toEqual(ALL);
    expect(result.notLive).toEqual({});
    expect(result.staleGrounding).toEqual([]);
    expect(result.staleFacts).toEqual([]);
  });

  it("no manifest means an empty live set", () => {
    expect(deriveLiveSet({ manifest: null, snapshots: {}, copies: {}, notes: {} }).liveSlugs).toEqual([]);
  });

  it("a listed page with copy but no fact check is not live, and takes the hub and the rest down", () => {
    const content = fixtureContent();
    delete content.copies["food-tours"].factCheck;
    const result = deriveLiveSet(content);
    expect(result.liveSlugs).toEqual([]);
    expect(result.notLive["food-tours"]).toBe("not fact checked");
    expect(result.notLive["things-to-do"]).toMatch(/food-tours \(not fact checked\)/);
    expect(result.notLive["floating-markets"]).toBe("the hub is not live");
    expect(result.notLive["tour-facts"]).toBe("the hub is not live");
    expect(result.notLiveReasons["food-tours"]).toEqual(["not fact checked", "the hub is not live"]);
    expect(result.notLiveReasons["floating-markets"]).toEqual(["the hub is not live"]);
  });

  it("lists every reason a page is not live, not only the first", () => {
    const content = fixtureContent();
    delete content.copies["food-tours"].factCheck;
    delete content.copies["things-to-do"];
    const result = deriveLiveSet(content);
    expect(result.notLive["things-to-do"]).toBe("no copy");
    expect(result.notLiveReasons["things-to-do"]).toEqual([
      "no copy",
      "a page it lists is not ready: food-tours (not fact checked)",
    ]);
    expect(result.notLiveReasons["food-tours"]).toEqual(["not fact checked", "the hub is not live"]);
  });

  it("a held category leaves the hub list, so the rest stay live without it", () => {
    const content = fixtureContent();
    content.manifest!.pages[2].held = true;
    // Holding the page changes what the hub renders, so the hub needs a new approval.
    expect(deriveLiveSet(content).notLive["things-to-do"]).toBe("checkHash stale");
    approve(content);
    const result = deriveLiveSet(content);
    expect(result.liveSlugs).toEqual(["things-to-do", "food-tours", "tour-facts"]);
    expect(result.notLive["floating-markets"]).toBe("held");
  });

  it("a category without a snapshot is not listed by the hub and is not live", () => {
    const content = fixtureContent();
    delete content.snapshots["floating-markets"];
    approve(content);
    const result = deriveLiveSet(content);
    expect(result.notLive["floating-markets"]).toBe("no snapshot");
    expect(result.liveSlugs).toContain("things-to-do");
  });

  it("an edited approved string makes the check stale (copy, notes, manifest h1)", () => {
    const content = fixtureContent();
    content.copies["food-tours"].seoTitle = "changed";
    expect(deriveLiveSet(content).notLive["food-tours"]).toBe("checkHash stale");

    const other = fixtureContent();
    other.manifest!.pages[1].h1 = "Bangkok food tours";
    const result = deriveLiveSet(other);
    // The hub prints category h1s, and the grounding covers the page's own h1.
    expect(result.notLive["things-to-do"]).toBe("checkHash stale");
    expect(result.staleGrounding).toEqual(["food-tours"]);
  });

  it("a new snapshot with different picks makes the check stale", () => {
    const content = fixtureContent();
    content.snapshots["floating-markets"].picksHash = "v1:other";
    expect(deriveLiveSet(content).notLive["floating-markets"]).toBe("checkHash stale");
  });

  it("flags facts that no longer hash to their factsHash", () => {
    const content = fixtureContent();
    (content.snapshots["food-tours"].facts as { memberCount: number }).memberCount = 99;
    expect(deriveLiveSet(content).staleFacts).toEqual(["food-tours"]);
  });

  it("the hub not being ready takes every page down", () => {
    const content = fixtureContent();
    delete content.copies["things-to-do"];
    const result = deriveLiveSet(content);
    expect(result.liveSlugs).toEqual([]);
    expect(result.notLive["things-to-do"]).toBe("no copy");
  });
});
