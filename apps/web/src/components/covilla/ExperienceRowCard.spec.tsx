import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { Experience } from "@folio/shared";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";

const rated: Experience = {
  id: "sample",
  title: "Sample experience",
  description: "A description",
  image: "https://e.test/sample.jpg",
  imageAlt: "Sample",
  category: "Landmarks",
  priceBand: "$$",
  rating: 4.7,
  ratingCount: 1200,
  freeCancel: true,
};

describe("ExperienceRowCard server output", () => {
  it("omits ratings even if a caller accidentally supplies them", () => {
    const html = renderToStaticMarkup(
      <ExperienceRowCard experience={rated} destination={{ slug: "bangkok", city: "Bangkok", country: "Thailand" }} />,
    );
    expect(html).toContain("Free cancellation");
    expect(html).not.toMatch(/average rating|4\.7|1,200|ratingCount|AggregateRating/);
  });
});
