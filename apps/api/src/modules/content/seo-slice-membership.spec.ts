import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isViatorHost } from "@folio/shared";
import type { SeoSliceManifest, SeoSliceManifestPage } from "@folio/shared";
import {
  exclusionOf,
  lengthGroupOf,
  selectHubPicks,
  selectMembers,
  selectPicks,
  type SeoSlicePlannedPick,
  type SeoSliceTourInput,
} from "./seo-slice-membership";

/**
 * Spec 0006 page manifest and membership, AC-M2 to AC-M8 and AC-M10. Runs on
 * the real manifest, so a manifest edit that breaks a named case fails here.
 */

const MANIFEST_PATH = path.resolve(__dirname, "../../../../web/src/content/seo/bangkok/manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SeoSliceManifest;
const pageOf = (slug: string): SeoSliceManifestPage => {
  const page = manifest.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`no page ${slug}`);
  return page;
};

let seq = 0;
/** One tour that passes every pool condition, with its own Experience. */
function tour(over: Partial<SeoSliceTourInput> = {}): SeoSliceTourInput {
  const n = String(++seq).padStart(5, "0");
  return {
    id: `t${n}`,
    experienceId: `e${n}`,
    experienceStatus: "published",
    providerTourId: `P${n}`,
    title: "Floating market tour",
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
  };
}
const many = (count: number, over: Partial<SeoSliceTourInput> = {}) => Array.from({ length: count }, () => tour(over));
/** Fails the BRI-200 gate (too few reviews) but is otherwise printable. */
const UNGATED = { ratingCount: 2 };

const memberSlugs = (tours: SeoSliceTourInput[], t: SeoSliceTourInput) => {
  const { pages } = selectMembers(tours, manifest);
  return Object.entries(pages)
    .filter(([, m]) => m.members.some((x) => x.id === t.id))
    .map(([slug]) => slug);
};

describe("SEO slice pools and exclusions (AC-M2, AC-M2a, AC-M3)", () => {
  it("drops every named off city title from every page, and keeps an Ayutthaya day trip", () => {
    const offCity = [
      tour({ title: "Phuket Island Hopping Day Trip with Floating Market" }),
      tour({ title: "Phi Phi Islands Day Trip by Speedboat" }),
      tour({ title: "Krabi 4 Islands Day Trip" }),
      tour({ title: "Samui Temples and Floating Market Day Trip" }),
      tour({ title: "Pattaya Floating Market Tour from Bangkok" }),
      tour({ title: "Pattaya Floating Market and Sanctuary of Truth Day Trip" }),
    ];
    const ayutthaya = tour({ title: "Ayutthaya Day Trip from Bangkok", tags: [11889] });
    const all = [...offCity, ayutthaya];

    for (const t of offCity) {
      expect(exclusionOf(t, manifest)).toBe("offCity");
      expect(memberSlugs(all, t)).toEqual([]);
    }
    expect(exclusionOf(ayutthaya, manifest)).toBeNull();
    expect(memberSlugs(all, ayutthaya)).toEqual(["day-trips"]);
  });

  it("keeps only https viator.com links, using the shared isViatorHost", () => {
    const bad = [
      tour({ affiliateUrl: null }),
      tour({ affiliateUrl: "http://www.viator.com/tours/x" }),
      tour({ affiliateUrl: "https://evilviator.com/tours/x" }),
      tour({ affiliateUrl: "https://viator.com.evil.com/tours/x" }),
    ];
    const good = tour({ affiliateUrl: "https://www.viator.com/tours/x" });
    const { printablePool, eligiblePool } = selectMembers([...bad, good], manifest);

    expect(isViatorHost(good.affiliateUrl)).toBe(true);
    for (const t of bad) expect(exclusionOf(t, manifest)).toBe("noViatorLink");
    expect(printablePool.map((t) => t.id)).toEqual([good.id]);
    expect(eligiblePool.map((t) => t.id)).toEqual([good.id]);
  });

  it("applies the other shared exclusions", () => {
    expect(exclusionOf(tour({ tags: [11922] }), manifest)).toBe("excludedTag");
    expect(exclusionOf(tour({ tags: [12044] }), manifest)).toBe("excludedTag");
    expect(exclusionOf(tour({ tags: [367668] }), manifest)).toBeNull();
    expect(exclusionOf(tour({ durationMin: 1441 }), manifest)).toBe("tooLong");
    expect(exclusionOf(tour({ durationMin: 1440 }), manifest)).toBeNull();
    expect(exclusionOf(tour({ title: "Floating Market Tour, Free Cancellation" }), manifest)).toBe("leakTerm");
    expect(exclusionOf(tour({ title: "Floating Market Tour from $25" }), manifest)).toBe("leakTerm");
  });

  it("holds the pool conditions, with the gate splitting printable from eligible", () => {
    const ok = tour();
    const ungated = tour(UNGATED);
    const lowRating = tour({ ratingAvg: 3.9 });
    const out = [
      tour({ deletedAt: new Date("2026-10-01") }),
      tour({ destinationRefs: ["5267"] }),
      tour({ experienceStatus: "draft" }),
      tour({ experienceId: null, experienceStatus: null }),
      tour({ imageUrl: null }),
    ];
    const { printablePool, eligiblePool } = selectMembers([ok, ungated, lowRating, ...out], manifest);

    expect(printablePool.map((t) => t.id)).toEqual([ok.id, ungated.id, lowRating.id]);
    expect(eligiblePool.map((t) => t.id)).toEqual([ok.id]);
  });

  it("judges each Experience by its representative tour, the lowest id that is not deleted", () => {
    // Experience A: its lowest id tour is deleted, so the next one represents it.
    const aDeleted = tour({ id: "a1", experienceId: "A", deletedAt: new Date("2026-10-01") });
    const aRep = tour({ id: "a2", experienceId: "A" });
    const aLater = tour({ id: "a3", experienceId: "A" });
    // Experience B: its representative tour has no image, so B is out even though a later tour has one.
    const bRep = tour({ id: "b1", experienceId: "B", imageUrl: null });
    const bLater = tour({ id: "b2", experienceId: "B" });

    const { printablePool, pages } = selectMembers([aLater, bLater, aDeleted, bRep, aRep], manifest);

    expect(printablePool.map((t) => t.id)).toEqual(["a2"]);
    expect(pages["floating-markets"].members.map((t) => t.id)).toEqual(["a2"]);
  });
});

describe("SEO slice page membership (AC-M4)", () => {
  it("takes a tour that matches by tag only and one that matches by title only", () => {
    const byTag = tour({ title: "Damnoen Saduak Morning Boat Ride", tags: [20226] });
    const byTitle = tour({ title: "Bangkok Floating Markets Tour", tags: [] });
    const neither = tour({ title: "Bangkok Street Food Night", tags: [] });
    const { pages } = selectMembers([byTag, byTitle, neither], manifest);

    expect(pages["floating-markets"].members.map((t) => t.id)).toEqual([byTag.id, byTitle.id]);
  });

  it("lists every category page, held ones included, and lets a member sit on more than one", () => {
    const both = tour({ title: "Ayutthaya Temples Day Trip", tags: [] });
    const { pages } = selectMembers([both], manifest);

    expect(Object.keys(pages).sort()).toEqual(
      ["cooking-classes", "cruises", "day-trips", "floating-markets", "muay-thai", "spa-and-massage", "temples"],
    );
    expect(pages.temples.members).toHaveLength(1);
    expect(pages["day-trips"].members).toHaveLength(1);
  });
});

describe("SEO slice sections and order (AC-M5)", () => {
  const page = pageOf("floating-markets");
  const picksFor = (tours: SeoSliceTourInput[], m: SeoSliceManifest = manifest, p = page) =>
    selectPicks(selectMembers(tours, m).pages[p.slug], p, m);

  it("puts a Damnoen Saduak and Maeklong title in damnoen-saduak only", () => {
    const both = many(3, { title: "Damnoen Saduak Floating Market and Maeklong Railway Market" });
    const maeklong = many(3, { title: "Maeklong Railway and Floating Market Tour" });
    const generic = many(4, { title: "Bangkok Floating Market Tour" });
    const result = picksFor([...both, ...maeklong, ...generic]);

    expect(result.sections.map((s) => [s.id, s.eligibleCount, s.memberCount])).toEqual([
      ["damnoen-saduak", 3, 3],
      ["maeklong", 3, 3],
      ["other", 4, 4],
    ]);
    const damnoenPicks = result.picks.filter((p) => p.section === "damnoen-saduak").map((p) => p.tour.id);
    expect(damnoenPicks.sort()).toEqual(both.map((t) => t.id).sort());
  });

  it("shows one list when one named section and an other of 2 remain", () => {
    const damnoen = many(10, { title: "Damnoen Saduak Floating Market Tour" });
    const generic = many(2, { title: "Bangkok Floating Market Tour" });
    const result = picksFor([...damnoen, ...generic]);

    expect(result.sections).toEqual([]);
    expect(result.picks).toHaveLength(12);
    expect(result.picks.every((p) => p.section === null)).toBe(true);
  });

  it("splits a section by length and takes from each length in turn", () => {
    const under = [
      tour({ title: "Damnoen Saduak Floating Market Tour", durationMin: 180 }),
      tour({ title: "Damnoen Saduak Floating Market Tour", durationMin: 200 }),
    ];
    const fullDay = tour({ title: "Damnoen Saduak Floating Market Tour", durationMin: 600 });
    const unknown = many(3, { title: "Damnoen Saduak Floating Market Tour", durationMin: null });
    const ayutthaya = many(4, { title: "Ayutthaya and Floating Market Tour" });
    const result = picksFor([...under, fullDay, ...unknown, ...ayutthaya]);

    expect(lengthGroupOf(null)).toBe("unknown");
    expect(lengthGroupOf(239)).toBe("under4h");
    expect(lengthGroupOf(240)).toBe("4to8h");
    expect(lengthGroupOf(479)).toBe("4to8h");
    expect(lengthGroupOf(480)).toBe("fullDay");
    const damnoen = result.picks.filter((p) => p.section === "damnoen-saduak");
    expect(damnoen.map((p) => lengthGroupOf(p.tour.durationMin))).toEqual(["under4h", "fullDay", "unknown"]);
  });

  it("ranks more keyword groups covered above more inclusions inside a length group", () => {
    const inclusions = (...texts: string[]) => texts.map((description) => ({ description }));
    // Default keyword groups for this page: pickup, meal, entryFee, guide.
    const threeGroups = tour({
      title: "Damnoen Saduak Floating Market Tour",
      providerTourId: "Z9",
      inclusions: inclusions("Hotel pickup and drop off", "Lunch", "English speaking guide"),
    });
    const oneGroup = tour({
      title: "Damnoen Saduak Floating Market Tour",
      providerTourId: "A1",
      inclusions: inclusions(...Array.from({ length: 9 }, (_, i) => `Lunch course ${i + 1}`)),
    });
    // typeDescription stands in when description is missing (AC-S4).
    const fallback = tour({
      title: "Damnoen Saduak Floating Market Tour",
      providerTourId: "M5",
      inclusions: [{ typeDescription: "Entry fee" }, { typeDescription: "Breakfast" }],
    });
    const ayutthaya = many(7, { title: "Ayutthaya and Floating Market Tour" });
    const result = picksFor([oneGroup, fallback, threeGroups, ...ayutthaya]);

    const damnoen = result.picks.filter((p) => p.section === "damnoen-saduak").map((p) => p.tour.id);
    expect(damnoen).toEqual([threeGroups.id, fallback.id, oneGroup.id]);
  });

  it("never draws all of a section's picks from one length when another length has members", () => {
    const short = many(5, { title: "Damnoen Saduak Floating Market Tour", durationMin: 120 });
    const long = many(1, { title: "Damnoen Saduak Floating Market Tour", durationMin: 540 });
    const ayutthaya = many(4, { title: "Ayutthaya and Floating Market Tour" });
    const result = picksFor([...short, ...long, ...ayutthaya]);

    const lengths = new Set(
      result.picks.filter((p) => p.section === "damnoen-saduak").map((p) => lengthGroupOf(p.tour.durationMin)),
    );
    expect(lengths).toEqual(new Set(["under4h", "fullDay"]));
  });
});

describe("SEO slice picks and the floor (AC-M2a, AC-M5, AC-M6)", () => {
  it("counts 431 printable and 217 eligible members, and decides with the 217", () => {
    const damnoen = [
      ...many(197, { title: "Damnoen Saduak Floating Market Tour" }),
      ...many(210, { title: "Damnoen Saduak Floating Market Tour", ...UNGATED }),
    ];
    // A group with 2 eligible and 6 printable members folds into other.
    const maeklong = [
      ...many(2, { title: "Maeklong Railway and Floating Market" }),
      ...many(4, { title: "Maeklong Railway and Floating Market", ...UNGATED }),
    ];
    const ayutthaya = many(15, { title: "Ayutthaya and Floating Market Tour" });
    const generic = many(3, { title: "Bangkok Floating Market Tour" });

    const members = selectMembers([...damnoen, ...maeklong, ...ayutthaya, ...generic], manifest).pages["floating-markets"];
    expect(members.members).toHaveLength(431);
    expect(members.eligible).toHaveLength(217);

    const result = selectPicks(members, pageOf("floating-markets"), manifest);
    expect(result.thin).toBe(false);
    expect(result.eligibleCount).toBe(217);
    expect(result.sections.map((s) => [s.id, s.eligibleCount, s.memberCount])).toEqual([
      ["damnoen-saduak", 197, 407],
      ["ayutthaya", 15, 15],
      ["other", 5, 9],
    ]);
    // 3 picks per section, sections in order.
    expect(result.picks.map((p) => p.section)).toEqual([
      "damnoen-saduak", "damnoen-saduak", "damnoen-saduak",
      "ayutthaya", "ayutthaya", "ayutthaya",
      "other", "other", "other",
    ]);
    expect(result.picks.every((p) => members.eligible.includes(p.tour))).toBe(true);
  });

  it("takes 12 for the one list", () => {
    const page = pageOf("cooking-classes");
    const tours = many(15, { title: "Thai Cooking Class in Bangkok" });
    const result = selectPicks(selectMembers(tours, manifest).pages["cooking-classes"], page, manifest);

    expect(result.sections).toEqual([]);
    expect(result.picks).toHaveLength(12);
  });

  it("calls a page with 9 eligible and 40 printable members thin, with no picks", () => {
    const tours = [
      ...many(9, { title: "Damnoen Saduak Floating Market Tour" }),
      ...many(31, { title: "Damnoen Saduak Floating Market Tour", ...UNGATED }),
    ];
    const members = selectMembers(tours, manifest).pages["floating-markets"];
    const result = selectPicks(members, pageOf("floating-markets"), manifest);

    expect(members.members).toHaveLength(40);
    expect(result).toMatchObject({ thin: true, eligibleCount: 9, picks: [] });
  });
});

describe("SEO slice flagged Experiences (AC-M10)", () => {
  it("counts a flagged Experience but never picks it, on a page or the hub", () => {
    const tours = many(12, { title: "Thai Cooking Class in Bangkok" });
    const plain = selectPicks(selectMembers(tours, manifest).pages["cooking-classes"], pageOf("cooking-classes"), manifest);
    const flaggedId = plain.picks[0].tour.experienceId;

    const flagged: SeoSliceManifest = {
      ...manifest,
      excludedExperiences: [{ experienceId: flaggedId, reason: "image shows a different city" }],
    };
    const members = selectMembers(tours, flagged).pages["cooking-classes"];
    const result = selectPicks(members, pageOf("cooking-classes"), flagged);

    expect(members.members.map((t) => t.experienceId)).toContain(flaggedId);
    expect(result.picks).toHaveLength(12 - 1);
    expect(result.picks.map((p) => p.tour.experienceId)).not.toContain(flaggedId);
    // The next member takes the flagged one's place.
    expect(result.picks.map((p) => p.tour.id)).toEqual(plain.picks.slice(1).map((p) => p.tour.id));

    const hub = selectHubPicks(flagged, { "cooking-classes": result.picks });
    expect(hub.map((p) => p.tour.experienceId)).not.toContain(flaggedId);
  });
});

describe("SEO slice hub picks (AC-M7)", () => {
  const picks = (slug: string, tours: SeoSliceTourInput[]): SeoSlicePlannedPick[] => {
    const members = selectMembers(tours, manifest).pages[slug];
    return members.eligible.map((t) => ({ tour: t, section: null }));
  };

  it("takes 2 per page in manifest order, skipping an Experience already taken, with fromSlug set", () => {
    const shared = tour({ title: "Ayutthaya Temples and Floating Market Tour" });
    const fm = [shared, ...many(2, { title: "Bangkok Floating Market Tour" })];
    const temples = [shared, ...many(2, { title: "Wat Arun Temple Tour" })];
    const fmPicks = picks("floating-markets", fm);
    const templePicks = picks("temples", temples);
    // The shared Experience tops both pages.
    expect(fmPicks[0].tour.id).toBe(shared.id);
    expect(templePicks[0].tour.id).toBe(shared.id);

    const hub = selectHubPicks(manifest, { temples: templePicks, "floating-markets": fmPicks });

    expect(hub.map((p) => [p.fromSlug, p.tour.id])).toEqual([
      ["floating-markets", fmPicks[0].tour.id],
      ["floating-markets", fmPicks[1].tour.id],
      ["temples", templePicks[1].tour.id],
      ["temples", templePicks[2].tour.id],
    ]);
    expect(hub.every((p) => p.section === null)).toBe(true);
  });

  it("skips held pages and pages with no snapshot", () => {
    const spa = picks("spa-and-massage", many(3, { title: "Thai Massage in Bangkok" }));
    const cruises = picks("cruises", many(3, { title: "Chao Phraya Dinner Cruise" }));
    // spa-and-massage is held in the manifest; cooking-classes has no snapshot (absent).
    const hub = selectHubPicks(manifest, { "spa-and-massage": spa, cruises });

    expect(hub.map((p) => p.fromSlug)).toEqual(["cruises", "cruises"]);
  });
});
