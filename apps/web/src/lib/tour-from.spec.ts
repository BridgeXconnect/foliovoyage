import { describe, expect, it } from "@jest/globals";
import { parseFrom, parseFromForTour } from "@/lib/tour-from";

describe("parseFrom", () => {
  it("accepts a valid city.category and rebuilds the key from the parts", () => {
    expect(parseFrom("bangkok.food-drink")).toEqual({
      citySlug: "bangkok",
      categorySlug: "food-drink",
      categoryLabel: "Food & Drink",
      key: "bangkok.food-drink",
    });
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["garbage"],
    ["bangkok"],
    ["bangkok."],
    [".food-drink"],
    ["atlantis.food-drink"],
    ["bangkok.nonsense"],
    ["bangkok.food-drink.extra"], // split on the first dot: the category part has a dot
    ["bangkok..food-drink"],
    ["BANGKOK.food-drink"],
    ["bangkok.food-drink<script>"],
    ["bangkok. food-drink"],
  ])("rejects %p", (raw) => {
    expect(parseFrom(raw as string | null | undefined)).toBeNull();
  });
});

describe("parseFromForTour", () => {
  it("accepts only the tour's own city", () => {
    expect(parseFromForTour("bangkok.food-drink", "bangkok")?.key).toBe("bangkok.food-drink");
    expect(parseFromForTour("kyoto.food-drink", "bangkok")).toBeNull();
  });
});
