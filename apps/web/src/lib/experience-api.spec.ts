import { describe, expect, it, jest } from "@jest/globals";
import { fetchExperiencePage, isExperienceId } from "@/lib/experience-api";

const ID = "cmtodmrst0hdlqu18h454evr4";
const body = {
  experienceId: ID,
  tourId: "cmtnix0of008amw4c1czq706b",
  title: "Bangkok Canal Tour",
  image: null,
  durationMin: 120,
  price: { amountMinor: 115000, currency: "THB" },
  cancellationDescription: null,
  summary: null,
  affiliateUrl: null,
  city: { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" },
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("isExperienceId", () => {
  it("accepts a 25 character production id and refuses everything else", () => {
    expect(isExperienceId(ID)).toBe(true);
    expect(isExperienceId("x")).toBe(false);
    expect(isExperienceId("CMTODMRST0HDLQU18H454EVR4")).toBe(false);
    expect(isExperienceId(`${ID}/../etc`)).toBe(false);
    expect(isExperienceId("")).toBe(false);
  });
});

describe("fetchExperiencePage", () => {
  it("returns the parsed page and asks Next to cache it for 900 s", async () => {
    const f = jest.fn<typeof fetch>(async () => json(body));
    const page = await fetchExperiencePage(ID, "http://api", asFetch(f));
    expect(page?.title).toBe("Bangkok Canal Tour");
    expect(f).toHaveBeenCalledWith(`http://api/v1/experiences/${ID}`, { next: { revalidate: 900 } });
  });

  it("returns null without a fetch for a malformed id", async () => {
    const f = jest.fn();
    expect(await fetchExperiencePage("not-a-cuid", "http://api", asFetch(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on an api 404", async () => {
    const f = jest.fn<typeof fetch>(async () => json({ status: 404 }, 404));
    expect(await fetchExperiencePage(ID, "http://api", asFetch(f))).toBeNull();
  });

  it("throws on an api 5xx, a network error and a body off the contract", async () => {
    await expect(fetchExperiencePage(ID, "http://api", asFetch(async () => json({}, 500)))).rejects.toThrow(/500/);
    await expect(
      fetchExperiencePage(ID, "http://api", asFetch(async () => { throw new Error("down"); })),
    ).rejects.toThrow("down");
    await expect(fetchExperiencePage(ID, "http://api", asFetch(async () => json({ nope: 1 })))).rejects.toThrow(
      /Unexpected response/,
    );
  });
});
