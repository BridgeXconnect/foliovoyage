import { describe, expect, it } from "@jest/globals";
import { CANVAS_CATEGORIES, CANVAS_CITIES } from "@folio/shared";
import { parseFrom, parseFromForTour, tourHref } from "@/lib/tour-from";

const ID = "cmabc123def456ghi789jkl01";

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

describe("tourHref", () => {
  it("opens the tour page with the bucket key as from", () => {
    expect(tourHref({ id: ID, citySlug: "bangkok", categorySlug: "food-drink" })).toBe(
      `/tours/${ID}?from=bangkok.food-drink`,
    );
  });

  it("gives a from the tour page's own parser accepts, for every bucket", () => {
    let buckets = 0;
    for (const city of CANVAS_CITIES) {
      for (const category of CANVAS_CATEGORIES) {
        const href = tourHref({ id: ID, citySlug: city.slug, categorySlug: category.slug });
        const from = new URL(href, "http://x").searchParams.get("from");
        expect(parseFrom(from)).toMatchObject({
          citySlug: city.slug,
          categorySlug: category.slug,
          key: `${city.slug}.${category.slug}`,
        });
        buckets++;
      }
    }
    expect(buckets).toBe(42);
  });

  it("throws for a tile with no Experience id instead of linking to /tours/undefined", () => {
    const bad = { id: undefined as unknown as string, citySlug: "bangkok", categorySlug: "food-drink" };
    expect(() => tourHref(bad)).toThrow(/Experience id/);
    expect(() => tourHref({ ...bad, id: "" })).toThrow(/Experience id/);
  });
});
