import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  CITY_REGION_HEIGHT,
  CITY_REGION_WIDTH,
  EXCLUDED_CATEGORY_TAG_ID,
  EXIT_TILE_CORNER,
  MAX_TILES_PER_BUCKET,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  slotCentre,
  slotOrigin,
  slotOriginByIndex,
  tierForRank,
} from "./geometry";

describe("world geometry", () => {
  it("derives the region and world sizes from the slot (index.md table)", () => {
    expect([SLOT_WIDTH, SLOT_HEIGHT]).toEqual([2400, 1624]);
    expect([CITY_REGION_WIDTH, CITY_REGION_HEIGHT]).toEqual([9600, 3248]);
    expect([WORLD_WIDTH, WORLD_HEIGHT]).toEqual([28800, 6496]);
  });

  it("keeps the fixed city and category order", () => {
    expect(CANVAS_CITIES.map((c) => c.slug)).toEqual([
      "bangkok",
      "kyoto",
      "hanoi",
      "rome",
      "lisbon",
      "bali",
    ]);
    expect(CANVAS_CATEGORIES.map((c) => c.tagId)).toEqual([
      21909, 21910, 21911, 21912, 21913, 21915, 21916,
    ]);
    expect(CANVAS_CATEGORIES.map((c) => c.slug)).toEqual([
      "outdoor-activities",
      "art-culture",
      "food-drink",
      "tickets-passes",
      "tours-sightseeing",
      "classes-workshops",
      "seasonal-events",
    ]);
  });

  it("never lists the excluded category", () => {
    expect(EXCLUDED_CATEGORY_TAG_ID).toBe(21914);
    expect(CANVAS_CATEGORIES.map((c) => c.tagId)).not.toContain(21914);
  });

  // Expected values are worked out by hand from the formulas in index.md:
  //   x = cityCol * 9600 + catCol * 2400, y = cityRow * 3248 + catRow * 1624
  it.each([
    ["bangkok", "outdoor-activities", 0, 0],
    ["bangkok", "art-culture", 2400, 0],
    ["bangkok", "tours-sightseeing", 0, 1624], // category 4: column 0, row 1
    ["bangkok", "seasonal-events", 4800, 1624], // category 6: column 2, row 1
    ["kyoto", "outdoor-activities", 9600, 0], // city 1: column 1, row 0
    ["hanoi", "tickets-passes", 19200 + 7200, 0], // city 2: column 2, row 0
    ["rome", "outdoor-activities", 0, 3248], // city 3: column 0, row 1
    ["lisbon", "food-drink", 9600 + 4800, 3248],
    ["bali", "seasonal-events", 19200 + 4800, 3248 + 1624], // last used slot
  ])("puts %s / %s at (%i, %i)", (city, category, x, y) => {
    expect(slotOrigin(city, category)).toEqual({ x, y });
  });

  it("puts the slot centre at the origin plus half a slot", () => {
    expect(slotCentre("kyoto", "art-culture")).toEqual({
      x: 9600 + 2400 + 1200,
      y: 812,
    });
  });

  it("returns null for an unknown city or category slug", () => {
    expect(slotOrigin("paris", "outdoor-activities")).toBeNull();
    expect(slotOrigin("bangkok", "travel-transportation")).toBeNull();
    expect(slotCentre("nowhere", "art-culture")).toBeNull();
  });

  it("gives all 42 buckets distinct slots that sit inside the world", () => {
    const seen = new Set<string>();
    CANVAS_CITIES.forEach((_, cityIndex) => {
      CANVAS_CATEGORIES.forEach((__, categoryIndex) => {
        const { x, y } = slotOriginByIndex(cityIndex, categoryIndex);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + SLOT_WIDTH).toBeLessThanOrEqual(WORLD_WIDTH);
        expect(y + SLOT_HEIGHT).toBeLessThanOrEqual(WORLD_HEIGHT);
        seen.add(`${x},${y}`);
      });
    });
    expect(seen.size).toBe(42);
  });

  it("puts the exit tile at the slot size minus margin minus tile size", () => {
    expect(EXIT_TILE_CORNER).toEqual({ x: 2112, y: 1416 });
  });

  it("maps rank to tier: 1 to 4 lg, 5 to 20 md, 21 to 60 sm", () => {
    expect([1, 4].map(tierForRank)).toEqual(["lg", "lg"]);
    expect([5, 20].map(tierForRank)).toEqual(["md", "md"]);
    expect([21, MAX_TILES_PER_BUCKET].map(tierForRank)).toEqual(["sm", "sm"]);
  });
});

// The purity rule is enforced here, not by convention: this folder must stay
// free of imports and of Node or DOM APIs, and only geometry.ts may hold a
// pixel literal. A new file in this folder is checked automatically.
describe("canvas folder purity", () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));

  /** The source with comments and string literals blanked, so only code is scanned. */
  const codeOnly = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

  it("finds the geometry file", () => {
    expect(sources.map((s) => s.file)).toContain("geometry.ts");
  });

  it("has no imports and no Node or DOM API in any file", () => {
    for (const { text } of sources) {
      const code = codeOnly(text);
      expect(code).not.toMatch(/^\s*import\b/m);
      expect(code).not.toMatch(/^\s*export\b[^;]*\bfrom\b/m);
      expect(code).not.toMatch(/\brequire\s*\(/);
      expect(code).not.toMatch(/\bimport\s*\(/);
      expect(code).not.toMatch(
        /\b(window|document|navigator|localStorage|process|Buffer|__dirname|globalThis|performance|Date|setTimeout|requestAnimationFrame|Math\.random)\b/,
      );
    }
  });

  // Small integers that are structure, not pixels (indexes, halves, steps).
  const ALLOWED = new Set(["0", "1", "2", "-1"]);

  // Today geometry.ts is the only file here; the check covers every file added later.
  it("holds no pixel literal outside geometry.ts", () => {
    for (const { file, text } of sources.filter((s) => s.file !== "geometry.ts")) {
      const literals = codeOnly(text).match(/(?<![\w.$])-?\d+(?:\.\d+)?(?![\w.$])/g) ?? [];
      expect({ file, pixels: literals.filter((n) => !ALLOWED.has(n)) }).toEqual({ file, pixels: [] });
    }
  });
});
