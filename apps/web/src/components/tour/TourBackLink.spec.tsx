import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

let mockFrom: string | null = null;
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "from" ? mockFrom : null) }),
}));

import { CityBackLink, TourBackLink } from "@/components/tour/TourBackLink";

const html = () => renderToStaticMarkup(<TourBackLink citySlug="bangkok" cityName="Bangkok" />);
beforeEach(() => {
  mockFrom = null;
});

describe("TourBackLink", () => {
  it("links to the canvas bucket for a valid from of the tour's own city", () => {
    mockFrom = "bangkok.food-drink";
    const out = html();
    expect(out).toContain('href="/discover?at=bangkok.food-drink"');
    expect(out).toContain("← Back to Bangkok · Food &amp; Drink");
  });

  it.each([
    ["no from", null],
    ["another city's from", "kyoto.food-drink"],
    ["garbage", "../../etc/passwd"],
    ["an unknown category", "bangkok.nonsense"],
    ["a category with an extra dot", "bangkok.food-drink.x"],
    ["markup", '"><script>alert(1)</script>'],
  ])("falls back to the city link for %s", (_label, from) => {
    mockFrom = from;
    const out = html();
    expect(out).toContain('href="/destinations/bangkok"');
    expect(out).toContain("← Back to Bangkok");
    expect(out).not.toContain("/discover");
    expect(out).not.toContain("·");
  });

  it("never puts the raw from value into the HTML", () => {
    mockFrom = "bangkok.food-drink.<b>raw</b>";
    expect(html()).not.toContain("raw");
  });

  it("the server fallback is the city link, whatever the query", () => {
    const out = renderToStaticMarkup(<CityBackLink citySlug="bangkok" cityName="Bangkok" />);
    expect(out).toBe('<a class="inline-block text-sm text-ink-soft underline-offset-2 hover:underline" href="/destinations/bangkok">← Back to Bangkok</a>');
  });
});
