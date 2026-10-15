import { describe, expect, it } from "@jest/globals";
import { fixtureManifest } from "./fixture";
import { renderLiveFile } from "./index-files";
import { liveGuardFailures, parseLiveSlugs } from "./live-guard";

describe("parseLiveSlugs", () => {
  it("reads back what renderLiveFile writes", () => {
    expect(parseLiveSlugs(renderLiveFile(["a", "b"]))).toEqual(["a", "b"]);
    expect(parseLiveSlugs(renderLiveFile([]))).toEqual([]);
  });

  it("throws on a file with no LIVE_SLUGS", () => {
    expect(() => parseLiveSlugs("export const X = 1;")).toThrow();
  });
});

describe("liveGuardFailures (spec 0006 AC-8)", () => {
  const base = { headManifest: fixtureManifest(), headNotLive: {} };

  it("passes when the base has no live file yet", () => {
    expect(liveGuardFailures({ ...base, baseSlugs: null, headSlugs: [] })).toEqual([]);
  });

  it("passes when pages are added or kept", () => {
    expect(liveGuardFailures({ ...base, baseSlugs: ["food-tours"], headSlugs: ["food-tours", "things-to-do"] })).toEqual([]);
  });

  it("fails when a live page drops out without being held, and says why", () => {
    const failures = liveGuardFailures({
      ...base,
      baseSlugs: ["food-tours"],
      headSlugs: [],
      headNotLive: { "food-tours": "checkHash stale" },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/food-tours.*checkHash stale/);
  });

  it("passes when the dropped page is held in the head manifest", () => {
    const manifest = fixtureManifest();
    manifest.pages[1].held = true;
    expect(liveGuardFailures({ baseSlugs: ["food-tours"], headSlugs: [], headManifest: manifest, headNotLive: {} })).toEqual([]);
  });

  it("fails when a live page is removed from the manifest", () => {
    const failures = liveGuardFailures({ ...base, baseSlugs: ["gone"], headSlugs: [] });
    expect(failures[0]).toMatch(/gone.*removed from the manifest/);
  });

  it("passes when the base and head live sets are the same, or both empty", () => {
    expect(liveGuardFailures({ ...base, baseSlugs: ["food-tours"], headSlugs: ["food-tours"] })).toEqual([]);
    expect(liveGuardFailures({ ...base, baseSlugs: [], headSlugs: [] })).toEqual([]);
  });

  it("does not let a held flag on another page excuse a dropped page", () => {
    const manifest = fixtureManifest();
    const other = manifest.pages.find((p) => p.slug !== "food-tours")!;
    other.held = true;
    const failures = liveGuardFailures({ baseSlugs: ["food-tours"], headSlugs: [], headManifest: manifest, headNotLive: {} });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^food-tours: .*"held": true/);
  });

  it("treats a head with no manifest as every dropped page removed from the manifest", () => {
    const failures = liveGuardFailures({ baseSlugs: ["food-tours"], headSlugs: [], headManifest: null, headNotLive: {} });
    expect(failures).toEqual(["food-tours: live on the base branch but removed from the manifest"]);
  });

  it("reports each dropped page once, and skips the held one", () => {
    const manifest = fixtureManifest();
    manifest.pages.find((p) => p.slug === "food-tours")!.held = true;
    const failures = liveGuardFailures({
      baseSlugs: ["food-tours", "things-to-do", "gone"],
      headSlugs: [],
      headManifest: manifest,
      headNotLive: {},
    });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/^things-to-do: .*\(unknown\)/);
    expect(failures[1]).toMatch(/^gone: .*removed from the manifest/);
  });
});

