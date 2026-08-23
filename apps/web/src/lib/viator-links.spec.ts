import { describe, expect, it } from "@jest/globals";
import viatorLinks from "@/data/viator-links.json";
import { findExperienceDetail } from "@/lib/experience-detail";

type LinkEntry = { affiliateUrl?: string; provider?: string };
const links = viatorLinks as Record<string, LinkEntry>;

describe("viator-links.json (BRI-137 regression)", () => {
  it("has at least one matched link (data file isn't accidentally empty)", () => {
    expect(Object.keys(links).length).toBeGreaterThan(0);
  });

  it("every entry's affiliateUrl carries pid and mcid params on a viator.com host", () => {
    for (const [key, entry] of Object.entries(links)) {
      if (!entry.affiliateUrl) throw new Error(`${key} has no affiliateUrl`);
      const url = new URL(entry.affiliateUrl);
      expect(url.hostname.endsWith("viator.com")).toBe(true);
      expect(url.searchParams.get("pid")).toBeTruthy();
      expect(url.searchParams.get("mcid")).toBeTruthy();
    }
  });

  it("every registry key resolves to a real (destination, experience) pair", () => {
    for (const key of Object.keys(links)) {
      const [slug, experienceId] = key.split("/");
      expect(findExperienceDetail(slug!, experienceId!)).toBeDefined();
    }
  });
});
