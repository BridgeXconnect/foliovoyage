import { describe, expect, it } from "@jest/globals";
import {
  findExperienceDetail,
  listExperienceDetailParams,
  experienceDetailPath,
} from "@/lib/experience-detail";
import { getAllDestinations } from "@/data/destinations-helpers";

describe("findExperienceDetail", () => {
  it("returns the destination + experience for a real slug/id pair", () => {
    const found = findExperienceDetail("bangkok", "grand-palace-wat-phra-kaew");
    expect(found).toBeDefined();
    expect(found!.destination.slug).toBe("bangkok");
    expect(found!.experience.id).toBe("grand-palace-wat-phra-kaew");
    expect(found!.experience.title).toMatch(/Grand Palace/);
  });

  it("returns undefined for an unknown destination slug", () => {
    expect(findExperienceDetail("atlantis", "grand-palace-wat-phra-kaew")).toBeUndefined();
  });

  it("returns undefined for a known slug but unknown experience id", () => {
    expect(findExperienceDetail("bangkok", "no-such-experience")).toBeUndefined();
  });
});

describe("listExperienceDetailParams", () => {
  it("enumerates one param pair per experience across every destination", () => {
    const params = listExperienceDetailParams();
    const expected = getAllDestinations().reduce((n, d) => n + d.experiences.length, 0);
    expect(params.length).toBe(expected);
    // every pair resolves back to a real detail
    for (const p of params) {
      expect(findExperienceDetail(p.slug, p.experienceId)).toBeDefined();
    }
  });

  it("produces unique slug/id pairs", () => {
    const params = listExperienceDetailParams();
    const keys = new Set(params.map((p) => `${p.slug}/${p.experienceId}`));
    expect(keys.size).toBe(params.length);
  });
});

describe("experienceDetailPath", () => {
  it("builds the nested canonical path", () => {
    expect(experienceDetailPath("bangkok", "wat-arun-sunset")).toBe(
      "/destinations/bangkok/experiences/wat-arun-sunset",
    );
  });
});
