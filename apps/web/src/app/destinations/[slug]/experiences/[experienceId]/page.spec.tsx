import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import ExperienceDetailPage from "@/app/destinations/[slug]/experiences/[experienceId]/page";
import viatorLinks from "@/data/viator-links.json";

describe("indexable experience detail page", () => {
  it("omits Viator rating and review data from server HTML and JSON-LD", async () => {
    const entry = Object.entries(viatorLinks).find(([, link]) => "affiliateUrl" in link);
    expect(entry).toBeDefined();
    const [key] = entry!;
    const [slug, experienceId] = key.split("/");
    const element = await ExperienceDetailPage({ params: Promise.resolve({ slug, experienceId }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toMatch(/AggregateRating|aggregateRating|ratingCount|reviewCount|ratingValue|average rating|<dt>Rating<\/dt>/);
  });
});
