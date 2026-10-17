import { describe, expect, it } from "@jest/globals";
import type { SeoSliceManifest } from "@folio/shared";
import realManifest from "../../content/seo/bangkok/manifest.json";
import { fixtureManifest } from "./fixture";
import { findLeakTerms } from "./text-checks";
import {
  formatBangkokDate,
  formatCalendarDate,
  howMadeNote,
  hubFact,
  joinAnd,
  ruleLine,
  stripLine,
} from "./templates";

const QUALITY = "A minimum quality bar set from Viator's own traveller feedback decides whether a tour appears here, never where.";
const PHOTOS = "Tours whose photos do not show the tour may be left out.";

describe("slice templates", () => {
  it("joins lists with commas and 'and'", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  it("writes the rule line for a tagged page, an untagged page and the hub (AC-T12)", () => {
    const m = fixtureManifest();
    const food = m.pages.find((p) => p.slug === "food-tours")!;
    expect(ruleLine(m, food)).toBe(
      `Tours from Viator's Bangkok catalogue tagged Food tours, or with tours tagged food tours in the title. ${QUALITY}`,
    );
    const untagged = { ...food, rule: { ...food.rule!, tagIds: [] } };
    expect(ruleLine(m, untagged)).toBe(`Tours from Viator's Bangkok catalogue with tours tagged food tours in the title. ${QUALITY}`);
    expect(ruleLine(m, m.pages[0])).toBe(`Tours from each Bangkok topic page below, each chosen by that page's own rule. ${QUALITY}`);
  });

  it("joins several tag names with 'or'", () => {
    const m = fixtureManifest();
    const food = { ...m.pages[1], rule: { ...m.pages[1].rule!, tagIds: [1, 2] } };
    expect(ruleLine(m, food)).toContain("tagged Food tours or Floating markets, or with");
  });

  it("writes the note with sections, as one list, without tags, and on the hub (AC-T4)", () => {
    const m = fixtureManifest();
    const food = m.pages.find((p) => p.slug === "food-tours")!;
    expect(howMadeNote(m, food, ["Night tours", "Other food tours"])).toBe(
      "This page lists tours from Viator's Bangkok catalogue that carry the Viator tag Food tours, or whose titles mention tours tagged food tours. " +
        "It leaves out day trips out of the city. " +
        `${QUALITY} ` +
        "Tours are grouped by Night tours and Other food tours. " +
        "Inside each group they alternate across trip lengths, then follow how many of these they include: street food, then Viator's product code. " +
        PHOTOS,
    );
    const oneList = howMadeNote(m, food, []);
    expect(oneList).toContain(" Tours alternate across trip lengths, then follow how many of these they include: street food, then Viator's product code. ");
    expect(oneList).not.toContain("grouped by");
    expect(oneList.endsWith(PHOTOS)).toBe(true);
    const untagged = howMadeNote(m, { ...food, rule: { ...food.rule!, tagIds: [] } }, []);
    expect(untagged.startsWith("This page lists tours from Viator's Bangkok catalogue whose titles mention tours tagged food tours.")).toBe(true);
    expect(howMadeNote(m, m.pages[0], [])).toBe(
      "This page takes two tours from each of the Bangkok topic pages linked above, each chosen by that page's own rule. " +
        `It leaves out day trips out of the city. ${QUALITY}`,
    );
  });

  it("prints no digit and no leak term in any rule line or note of the real manifest (AC-T4, AC-T12)", () => {
    const m = realManifest as SeoSliceManifest;
    for (const page of m.pages.filter((p) => p.kind !== "stats")) {
      for (const text of [ruleLine(m, page), howMadeNote(m, page, ["A", "B"]), howMadeNote(m, page, [])]) {
        expect(text).not.toMatch(/\d/);
        expect(findLeakTerms(text)).toEqual([]);
      }
    }
  });

  it("writes strip lines, zero counts included (AC-T13)", () => {
    expect(stripLine({ kind: "keyword", key: "k", label: "hotel pickup", count: 89, of: 170 })).toBe("89 of 170 include hotel pickup");
    expect(stripLine({ kind: "keyword", key: "k", label: "hotel pickup", count: 0, of: 170 })).toBe("None of the 170 include hotel pickup");
    expect(stripLine({ kind: "length", key: "fullDay", label: "a full day", count: 58, of: 112 })).toBe(
      "58 of 112 with a listed length take a full day",
    );
    expect(stripLine({ kind: "length", key: "fullDay", label: "a full day", count: 0, of: 112 })).toBe(
      "None of the 112 with a listed length take a full day",
    );
  });

  it("writes the hub's one line fact (AC-T3)", () => {
    expect(hubFact(170, "fullDay")).toBe("170 tours match its rule, most of them a full day");
    expect(hubFact(43, "under4h")).toBe("43 tours match its rule, most of them under 4 hours");
    expect(hubFact(9, null)).toBe("9 tours match its rule");
  });

  it("formats dates as d MMMM yyyy, the fact check in Bangkok time", () => {
    expect(formatCalendarDate("2026-10-09")).toBe("9 October 2026");
    // 20:00 UTC on 11 Oct is already 12 Oct in Bangkok (UTC+7).
    expect(formatBangkokDate("2026-10-11T20:00:00Z")).toBe("12 October 2026");
  });
});
