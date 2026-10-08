import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

import { CityBackLink } from "@/components/tour/CityBackLink";

describe("CityBackLink", () => {
  it("links to the city page", () => {
    const out = renderToStaticMarkup(<CityBackLink citySlug="bangkok" cityName="Bangkok" />);
    expect(out).toBe(
      '<a class="inline-block text-sm text-ink-soft underline-offset-2 hover:underline" href="/destinations/bangkok">← Back to Bangkok</a>',
    );
  });

  it("encodes the city slug", () => {
    const out = renderToStaticMarkup(<CityBackLink citySlug="a b" cityName="X" />);
    expect(out).toContain('href="/destinations/a%20b"');
  });
});
