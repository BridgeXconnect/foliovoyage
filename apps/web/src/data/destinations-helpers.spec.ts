import { describe, expect, it } from "@jest/globals";
import { getAllDestinations } from "@/data/destinations-helpers";
import viatorLinks from "@/data/viator-links.json";

describe("public static destination data", () => {
  it("strips provider ratings before any page or client island receives an experience", () => {
    // Keep the assertion meaningful if the fixture changes: this source really
    // contains protected rating data that must not reach the public corpus.
    expect(Object.values(viatorLinks).some((link) => "rating" in link)).toBe(true);
    for (const destination of getAllDestinations()) {
      for (const experience of destination.experiences) {
        expect(experience).not.toHaveProperty("rating");
        expect(experience).not.toHaveProperty("ratingCount");
      }
    }
  });
});
