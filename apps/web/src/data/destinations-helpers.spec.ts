import { describe, expect, it } from "@jest/globals";
import { getAllDestinations } from "@/data/destinations-helpers";
import viatorLinks from "@/data/viator-links.json";

describe("public static destination data", () => {
  it("keeps protected ratings out of both the source JSON and public experiences", () => {
    for (const link of Object.values(viatorLinks)) {
      expect(link).not.toHaveProperty("rating");
      expect(link).not.toHaveProperty("ratingCount");
    }
    for (const destination of getAllDestinations()) {
      for (const experience of destination.experiences) {
        expect(experience).not.toHaveProperty("rating");
        expect(experience).not.toHaveProperty("ratingCount");
      }
    }
  });
});
