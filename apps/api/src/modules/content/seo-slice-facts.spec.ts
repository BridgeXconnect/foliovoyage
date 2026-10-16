import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SeoSliceLengthGroup, SeoSliceManifest, SeoSliceManifestPage } from "@folio/shared";
import {
  categoryFactsOf,
  eligibleOf,
  hubFactsOf,
  mainLengthOf,
  pickOf,
  stripOf,
  topPlacesOf,
} from "./seo-slice-facts";
import { selectMembers, selectPicks, type SeoSliceMember, type SeoSliceTourInput } from "./seo-slice-membership";

/** Spec 0006 prod snapshot, AC-S4, AC-S4a, AC-S5, AC-S8. Runs on the real manifest. */

const MANIFEST_PATH = path.resolve(__dirname, "../../../../web/src/content/seo/bangkok/manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SeoSliceManifest;
const pageOf = (slug: string): SeoSliceManifestPage => {
  const page = manifest.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`no page ${slug}`);
  return page;
};

let seq = 0;
/** One tour that passes every pool condition, with its own Experience. */
function tour(over: Partial<SeoSliceTourInput> = {}): SeoSliceMember {
  const n = String(++seq).padStart(5, "0");
  return {
    id: `t${n}`,
    experienceId: `e${n}`,
    experienceStatus: "published",
    providerTourId: `P${n}`,
    title: "Damnoen Saduak Floating Market Tour",
    durationMin: 300,
    ratingAvg: 4.6,
    ratingCount: 40,
    affiliateUrl: `https://www.viator.com/tours/Bangkok/x/d343-${n}`,
    imageUrl: `https://img.example/${n}.jpg`,
    imageAlt: null,
    inclusions: [],
    tags: [],
    destinationRefs: ["343"],
    deletedAt: null,
    ...over,
  } as SeoSliceMember;
}
const many = (count: number, over: Partial<SeoSliceTourInput> = {}) => Array.from({ length: count }, () => tour(over));
const UNGATED = { ratingCount: 2 };
const bands = (b: Partial<Record<SeoSliceLengthGroup, number>>) => ({ under4h: 0, "4to8h": 0, fullDay: 0, unknown: 0, ...b });

describe("SEO slice stat strip (AC-S4, D1)", () => {
  const groupIds = ["pickup", "guide"];
  const share = (pickup: number, guide: number) => ({ pickup: { count: pickup, of: 100 }, guide: { count: guide, of: 100 } });

  it("drops a 90% guide, puts a 56% pickup before a 33% full day, and a 0 length group last", () => {
    const strip = stripOf(share(56, 90), groupIds, bands({ under4h: 10, fullDay: 33 }), 100, manifest);

    expect(strip.map((e) => [e.kind, e.key, e.count])).toEqual([
      ["keyword", "pickup", 56],
      ["length", "fullDay", 33],
      ["length", "4to8h", 0],
    ]);
    expect(strip[0]).toEqual({ kind: "keyword", key: "pickup", label: "hotel pickup", count: 56, of: 100 });
    expect(strip[1].label).toBe("a full day");
    expect(strip[2].label).toBe("4 to 8 hours");
  });

  it("is empty when only 1 candidate qualifies", () => {
    expect(stripOf(share(56, 90), groupIds, bands({ under4h: 90, "4to8h": 5, fullDay: 5 }), 100, manifest)).toEqual([]);
  });

  it("takes 0.2 and 0.8 exactly, not just past them, and never offers unknown", () => {
    // unknown is 0 here: were it a candidate, it would qualify at a count of 0.
    const strip = stripOf(share(20, 80), groupIds, bands({ under4h: 19, "4to8h": 81, fullDay: 1, unknown: 0 }), 100, manifest);
    expect(strip.map((e) => e.key)).toEqual(["pickup", "guide"]);
  });

  it("takes a length share over the members with a listed length, and a keyword share over every member", () => {
    // 60 of 100 have no length: full day is 20 of 40 and under 4 hours 15 of 40, not 20 and 15 of 100.
    const strip = stripOf(share(90, 95), groupIds, bands({ under4h: 15, "4to8h": 5, fullDay: 20, unknown: 60 }), 100, manifest);
    expect(strip.map((e) => [e.key, e.count, e.of])).toEqual([
      ["fullDay", 20, 40],
      ["under4h", 15, 40],
    ]);
  });

  it("offers no length group when no member has a listed length", () => {
    const shares = { pickup: { count: 5, of: 10 }, guide: { count: 0, of: 10 } };
    const strip = stripOf(shares, groupIds, bands({ unknown: 10 }), 10, manifest);
    expect(strip.map((e) => [e.kind, e.key])).toEqual([
      ["keyword", "pickup"],
      ["keyword", "guide"],
    ]);
  });

  it("breaks a tie by keyword groups in page order, then length order, and takes 3", () => {
    const strip = stripOf(share(40, 60), groupIds, bands({ under4h: 40, "4to8h": 60, fullDay: 50 }), 100, manifest);
    expect(strip.map((e) => e.key)).toEqual(["fullDay", "pickup", "guide"]);
  });
});

describe("SEO slice category facts (AC-S4, AC-S4a, AC-S8)", () => {
  it("counts facts over 431 printable members and puts the 217 eligible ones in eligible", () => {
    const tours = [
      ...many(197, { title: "Damnoen Saduak Floating Market Tour", inclusions: [{ description: "Hotel pickup" }] }),
      ...many(210, { title: "Damnoen Saduak Floating Market Tour", ...UNGATED, durationMin: 600 }),
      ...many(2, { title: "Maeklong Railway and Floating Market" }),
      ...many(4, { title: "Maeklong Railway and Floating Market", ...UNGATED }),
      ...many(15, { title: "Ayutthaya and Floating Market Tour", durationMin: 120 }),
      ...many(3, { title: "Bangkok Floating Market Tour", durationMin: null }),
    ];
    const page = pageOf("floating-markets");
    const members = selectMembers(tours, manifest).pages["floating-markets"];
    const plan = selectPicks(members, page, manifest);
    const facts = categoryFactsOf(members.members, plan, page, manifest);

    expect(facts.memberCount).toBe(431);
    expect(facts.bandCounts).toEqual({ under4h: 15, "4to8h": 203, fullDay: 210, unknown: 3 });
    expect(facts.inclusionShares).toEqual({
      pickup: { count: 197, of: 431 },
      meal: { count: 0, of: 431 },
      entryFee: { count: 0, of: 431 },
      guide: { count: 0, of: 431 },
    });
    expect(facts.sections).toEqual([
      { id: "damnoen-saduak", label: "Damnoen Saduak", memberCount: 407 },
      { id: "ayutthaya", label: "Combined with Ayutthaya", memberCount: 15 },
      { id: "other", label: "Other floating market tours", memberCount: 9 },
    ]);
    // Closest to one half first: full day 210, then 4 to 8 hours 203 (both over the 428 with a listed length),
    // then pickup 197 of all 431 (under 4 hours, 15, is too rare).
    expect(facts.strip.map((e) => [e.key, e.count, e.of])).toEqual([
      ["fullDay", 210, 428],
      ["4to8h", 203, 428],
      ["pickup", 197, 431],
    ]);
    expect(eligibleOf(plan)).toEqual({
      count: 217,
      sections: [
        { id: "damnoen-saduak", count: 197 },
        { id: "ayutthaya", count: 15 },
        { id: "other", count: 5 },
      ],
    });
  });

  it("uses the page's own keyword groups, and the inclusion's typeDescription when it has no description", () => {
    const page = pageOf("cooking-classes");
    const tours = [
      ...many(6, { title: "Thai Cooking Class", inclusions: [{ typeDescription: "Market tour" }] }),
      ...many(6, { title: "Thai Cooking Class", inclusions: [{ description: "Recipe book", typeDescription: "Lunch" }] }),
    ];
    const members = selectMembers(tours, manifest).pages["cooking-classes"];
    const facts = categoryFactsOf(members.members, selectPicks(members, page, manifest), page, manifest);

    expect(Object.keys(facts.inclusionShares)).toEqual(["pickup", "meal", "marketVisit", "recipe", "vegetarian"]);
    expect(facts.inclusionShares.marketVisit).toEqual({ count: 6, of: 12 });
    expect(facts.inclusionShares.recipe).toEqual({ count: 6, of: 12 });
    // "Lunch" is the typeDescription of an item that has a description, so it is not read.
    expect(facts.inclusionShares.meal).toEqual({ count: 0, of: 12 });
    expect(facts.sections).toEqual([]);
    expect(eligibleOf(selectPicks(members, page, manifest))).toEqual({ count: 12, sections: [] });
  });

  it("never lists Floating Market on floating-markets, and counts Taling Chan once 2 titles name it", () => {
    const page = pageOf("floating-markets");
    const one = [tour({ title: "Taling Chan Floating Market" }), ...many(3, { title: "Bangkok Floating Market Tour" })];
    expect(topPlacesOf(one, manifest, page.excludePlaces)).toEqual([]);

    const two = [...one, tour({ title: "Taling chan floating market by longtail" })];
    expect(topPlacesOf(two, manifest, page.excludePlaces)).toEqual([{ name: "Taling Chan", count: 2 }]);
    // Without the page's excludePlaces the topic itself would lead.
    expect(topPlacesOf(two, manifest)[0]).toEqual({ name: "Floating Market", count: 5 });
  });

  it("orders places by count, then name, and keeps 5", () => {
    const names = ["Wat Pho", "Wat Arun", "Grand Palace", "Chinatown", "Erawan", "Lumpini"];
    const tours = names.flatMap((name, i) => many(i === 0 ? 3 : 2, { title: `${name} tour` }));
    expect(topPlacesOf(tours, manifest).map((p) => p.name)).toEqual([
      "Wat Pho", "Chinatown", "Erawan", "Grand Palace", "Lumpini",
    ]);
  });
});

describe("SEO slice hub facts (AC-S4)", () => {
  it("counts the union of members once per Experience, with each page's main length", () => {
    const shared = tour({ durationMin: 120, inclusions: [{ description: "Lunch" }] });
    const a = [shared, ...many(2, { durationMin: 300 })];
    const b = [shared, ...many(2, { durationMin: null })];
    const facts = hubFactsOf(
      [
        { slug: "floating-markets", members: a },
        { slug: "temples", members: b },
      ],
      manifest,
    );

    expect(facts.memberCount).toBe(5);
    expect(facts.bandCounts).toEqual({ under4h: 1, "4to8h": 2, fullDay: 0, unknown: 2 });
    expect(facts.inclusionShares.meal).toEqual({ count: 1, of: 5 });
    expect(facts.pages).toEqual([
      { slug: "floating-markets", memberCount: 3, mainLength: "4to8h" },
      { slug: "temples", memberCount: 3, mainLength: "under4h" },
    ]);
  });

  it("gives mainLength ties to the shorter length, and null when no member has a duration", () => {
    expect(mainLengthOf([tour({ durationMin: 600 }), tour({ durationMin: 100 })])).toBe("under4h");
    expect(mainLengthOf([tour({ durationMin: null })])).toBeNull();
    expect(mainLengthOf([])).toBeNull();
  });
});

describe("SEO slice pick fields (AC-S5)", () => {
  it("skips a Free cancellation inclusion for the next one, trims, skips a text over 120 characters and keeps 3", () => {
    const long = "x".repeat(130);
    const t = tour({
      inclusions: [
        { description: "Free cancellation" },
        { description: "  Hotel pickup  " },
        { typeDescription: long },
        { description: "Lunch" },
        { description: "Bottled water" },
      ],
    });
    const pick = pickOf({ tour: t, section: "damnoen-saduak" });

    expect(pick.inclusions).toEqual(["Hotel pickup", "Lunch", "Bottled water"]);
    expect(pick).toEqual({
      experienceId: t.experienceId,
      providerTourId: t.providerTourId,
      title: t.title,
      imageUrl: t.imageUrl,
      imageAlt: t.title,
      durationBand: "4to8h",
      section: "damnoen-saduak",
      inclusions: pick.inclusions,
    });
    for (const key of ["ratingAvg", "ratingCount", "affiliateUrl", "fromSlug"]) expect(pick).not.toHaveProperty(key);
  });

  it("keeps a text of exactly 120 characters, never cuts a longer one, and checks repeats on the whole text", () => {
    const head = "y".repeat(120);
    const t = tour({
      inclusions: [
        { description: `${head} and more` },
        { description: `  ${head}  ` },
        { description: "z".repeat(121) },
      ],
    });

    // Under a cut, the first text would show as its first 120 characters and the second would be its repeat.
    expect(pickOf({ tour: t, section: null }).inclusions).toEqual([head]);
  });

  it("shows a repeated inclusion once, ignoring case and spaces, and skips first person texts", () => {
    const t = tour({
      inclusions: [
        { description: "All Fees and Taxes" },
        { description: " all fees and taxes " },
        { description: "we're unable to pickup guests from Airbnb" },
        { description: "Our guide meets you at the pier" },
        { description: "I’m sorry, no hotel pickup" },
        { description: "Bottled water" },
        { description: "Mineral water" },
        { description: "Lunch" },
      ],
    });

    expect(pickOf({ tour: t, section: null }).inclusions).toEqual(["All Fees and Taxes", "Bottled water", "Mineral water"]);
  });

  it("keeps an inclusion where a first person word sits inside another word", () => {
    const t = tour({ inclusions: [{ description: "Museum entry" }, { description: "Tour of the Weekend market" }] });

    expect(pickOf({ tour: t, section: null }).inclusions).toEqual(["Museum entry", "Tour of the Weekend market"]);
  });

  it("replaces an imageAlt holding highly rated with the title, and keeps a clean one", () => {
    expect(pickOf({ tour: tour({ imageAlt: "A highly rated boat trip" }), section: null }).imageAlt).toBe(
      "Damnoen Saduak Floating Market Tour",
    );
    expect(pickOf({ tour: tour({ imageAlt: " Boats on the canal " }), section: null }).imageAlt).toBe("Boats on the canal");
  });

  it("carries fromSlug on a hub pick", () => {
    expect(pickOf({ tour: tour(), section: null, fromSlug: "temples" }).fromSlug).toBe("temples");
  });
});
