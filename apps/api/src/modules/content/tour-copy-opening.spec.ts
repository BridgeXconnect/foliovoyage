import { describe, expect, it } from "@jest/globals";

import { openingPattern } from "./tour-copy-opening";

describe("openingPattern (spec 0003 AC-4)", () => {
  it.each([
    "The tour runs 90 minutes along quiet canals. You see markets.",
    "Over 2 hours you cruise the river. Lunch follows.",
    "A 90-minute cruise starts at the pier. Then lunch.",
    "Ninety minutes on a longtail boat. Then lunch.",
    "Twenty five minutes by train. Then a walk.",
    "One hour on a longtail boat. Then lunch.",
    "Two days in the hills. Then home.",
    "Spend 1 day among the temples. Then rest.",
  ])("reads %s as duration", (paragraph) => {
    expect(openingPattern(paragraph)).toBe("duration");
  });

  it.each([
    "A local artisan family teaches lantern craft. Over 75 minutes you cut and glue silk.",
    "Longtail boats glide past floating vendors. The trip lasts 90 minutes.",
    "Small groups of 12 meet at the pier. Boats leave at once.",
    "Two guides lead the group through the market. It takes hours.",
    "An hour on the water. Then lunch.",
    "A first look at the canals. Then lunch.",
    "",
  ])("reads %s as other", (paragraph) => {
    expect(openingPattern(paragraph)).toBe("other");
  });

  it("only looks at the first sentence, and does not split on an abbreviation", () => {
    expect(openingPattern("Walk St. Paul's steps for 45 minutes. Then rest.")).toBe("duration");
    expect(openingPattern("Walk to the pier. Then 45 minutes on the water.")).toBe("other");
  });

  it("needs the number directly before the unit", () => {
    expect(openingPattern("Take 90 quiet minutes on the water. Then lunch.")).toBe("other");
    expect(openingPattern("Take 45, minutes on the water. Then lunch.")).toBe("other");
  });

  it("reads a decimal before a unit as duration", () => {
    expect(openingPattern("Cruise for 2.5 hours past the vendors. Then lunch.")).toBe("duration");
  });
});
