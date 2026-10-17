/**
 * Test fixture for the page template (spec 0006 page template): the base
 * fixture grown into renderable pages. A hub that lists both categories with
 * two picks each; `food-tours` with two sections, a strip, a note and a Good
 * to know source; `floating-markets` with one list and nothing optional. The
 * stats page is held (its template is row 25).
 *
 * `food-tours` carries the AC-9 sentinels: 431 printable members, 217 through
 * the gate. 217 must appear nowhere on a rendered page.
 */

import type {
  SeoSliceCategoryFacts,
  SeoSliceHubFacts,
  SeoSlicePick,
  SeoSliceSnapshot,
} from "@folio/shared";
import { approve, fixtureContent } from "./fixture";
import { canonicalHash } from "./hash";
import { deriveLiveSet } from "./live-set";
import { generatedPages } from "./index-files";
import type { SliceSource } from "./page-model";
import type { SliceContent } from "./types";

export const SENTINEL_MEMBERS = 431;
export const SENTINEL_ELIGIBLE = 217;
export const NOTE_TEXT = "Go after <dusk> & bring small notes for the stalls.";
export const SOURCE_URL = "https://www.tourismthailand.org/Articles/street-food";

const pick = (slug: string, n: number, over: Partial<SeoSlicePick> = {}): SeoSlicePick => ({
  experienceId: `exp-${slug}-${n}`,
  providerTourId: `P-${slug}-${n}`,
  title: `A ${slug.replace(/-/g, " ")} tour number ${n === 1 ? "one" : n === 2 ? "two" : "three"}`,
  imageUrl: `https://media-cdn.tripadvisor.com/media/${slug}-${n}.jpg`,
  imageAlt: `Photo of ${slug.replace(/-/g, " ")}`,
  durationBand: "under4h",
  section: null,
  inclusions: [],
  ...over,
});

function refresh(snap: SeoSliceSnapshot): void {
  snap.factsHash = canonicalHash(snap.facts);
  snap.picksHash = canonicalHash(snap.picks);
}

export function pageFixtureContent(): SliceContent {
  const content = fixtureContent();
  const manifest = content.manifest!;
  const food = manifest.pages.find((p) => p.slug === "food-tours")!;
  food.groups = [{ id: "night", label: "Night food tours", titlePattern: "night" }];
  food.otherLabel = "Other food tours";
  food.ogImageExperienceId = "exp-food-tours-2";
  food.sourceFacts = [{ fact: "Most stalls on Yaowarat Road open in the evening.", url: SOURCE_URL, checked: "2026-10-12" }];
  manifest.pages.find((p) => p.slug === "floating-markets")!.ogImageExperienceId = "exp-floating-markets-1";
  manifest.pages.find((p) => p.slug === "tour-facts")!.held = true;
  manifest.pages.find((p) => p.slug === "things-to-do")!.ogImageExperienceId = "exp-food-tours-1";

  const foodSnap = content.snapshots["food-tours"];
  foodSnap.facts = {
    memberCount: SENTINEL_MEMBERS,
    bandCounts: { under4h: 300, "4to8h": 100, fullDay: 0, unknown: 31 },
    inclusionShares: { street: { count: 250, of: SENTINEL_MEMBERS } },
    topPlaces: [],
    sections: [
      { id: "night", label: "Night food tours", memberCount: 120 },
      { id: "other", label: "Other food tours", memberCount: 311 },
    ],
    strip: [
      { kind: "keyword", key: "street", label: "street food", count: 250, of: SENTINEL_MEMBERS },
      { kind: "length", key: "fullDay", label: "a full day", count: 0, of: 400 },
    ],
  } satisfies SeoSliceCategoryFacts;
  foodSnap.eligible = { count: SENTINEL_ELIGIBLE, sections: [{ id: "night", count: 60 }, { id: "other", count: 157 }] };
  foodSnap.picks = [
    pick("food-tours", 1, {
      section: "night",
      durationBand: "under4h",
      inclusions: ["Street food tastings", "Local guide", "Tuk tuk ride", "Bottled water"],
    }),
    pick("food-tours", 2, { section: "other", durationBand: "unknown" }),
  ];
  refresh(foodSnap);

  const marketSnap = content.snapshots["floating-markets"];
  marketSnap.picks = [pick("floating-markets", 1, { durationBand: "fullDay" }), pick("floating-markets", 2)];
  refresh(marketSnap);

  const hubSnap = content.snapshots["things-to-do"];
  hubSnap.facts = {
    memberCount: SENTINEL_MEMBERS + 2,
    bandCounts: { under4h: 302, "4to8h": 100, fullDay: 0, unknown: 31 },
    inclusionShares: {},
    pages: [
      { slug: "food-tours", memberCount: SENTINEL_MEMBERS, mainLength: "under4h" },
      { slug: "floating-markets", memberCount: 2, mainLength: null },
    ],
    strip: [{ kind: "keyword", key: "street", label: "street food", count: 250, of: SENTINEL_MEMBERS + 2 }],
  } satisfies SeoSliceHubFacts;
  hubSnap.picks = [
    { ...foodSnap.picks[0], section: null, fromSlug: "food-tours" },
    { ...foodSnap.picks[1], section: null, fromSlug: "food-tours" },
    { ...marketSnap.picks[0], fromSlug: "floating-markets" },
    { ...marketSnap.picks[1], fromSlug: "floating-markets" },
  ];
  refresh(hubSnap);

  content.notes["food-tours"] = {
    schemaVersion: 1,
    slug: "food-tours",
    notes: [{ id: "dusk", kind: "timing", basis: "firsthand", written: "2026-10-09", text: NOTE_TEXT }],
  };
  return approve(content);
}

/** The route's input built from fixture content, the way `seo:index` would generate it. */
export function sourceFrom(
  content: SliceContent,
  over: Partial<Pick<SliceSource, "preview" | "siteLinks">> = {},
): SliceSource {
  return {
    manifest: content.manifest!,
    pages: generatedPages(content),
    liveSlugs: deriveLiveSet(content).liveSlugs,
    preview: false,
    siteLinks: false,
    siteUrl: "https://foliovoyage.test",
    ...over,
  };
}
