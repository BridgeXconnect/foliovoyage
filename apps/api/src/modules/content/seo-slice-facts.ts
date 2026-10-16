/**
 * SEO slice facts, the internal `eligible` block and pick fields (spec 0006
 * prod snapshot, AC-S4, AC-S4a, AC-S5, AC-S8).
 *
 * Pure: members and the manifest in, snapshot parts out. Every count in
 * `facts` is over printable members (umbrella AC-9); gated counts go only to
 * `eligible`, which is never hashed, grounded or rendered.
 */

import type {
  SeoSliceCategoryFacts,
  SeoSliceEligible,
  SeoSliceHubFacts,
  SeoSliceKnownLengthGroup,
  SeoSliceLengthGroup,
  SeoSliceManifest,
  SeoSliceManifestPage,
  SeoSlicePick,
  SeoSlicePlaceCount,
  SeoSliceShare,
  SeoSliceStripEntry,
} from "@folio/shared";
import {
  inclusionTexts,
  keywordGroupIdsFor,
  lengthGroupOf,
  type SeoSliceHubPick,
  type SeoSliceMember,
  type SeoSlicePagePicks,
  type SeoSlicePlannedPick,
} from "./seo-slice-membership";
import { findFirstPerson, findLeakTerms, phrasesMatcher } from "./seo-slice-text";

export const SEO_SLICE_TOP_PLACES = 5;
export const SEO_SLICE_PLACE_MIN_COUNT = 2;
export const SEO_SLICE_STRIP_MAX = 3;
export const SEO_SLICE_STRIP_MIN = 2;
export const SEO_SLICE_PICK_INCLUSIONS = 3;
export const SEO_SLICE_INCLUSION_MAX_CHARS = 120;

const KNOWN_LENGTHS: SeoSliceKnownLengthGroup[] = ["under4h", "4to8h", "fullDay"];

/** The words a template prints for a length group (AC-S4, the stat strip). */
export const SEO_SLICE_LENGTH_LABELS: Record<SeoSliceKnownLengthGroup, string> = {
  under4h: "under 4 hours",
  "4to8h": "4 to 8 hours",
  fullDay: "a full day",
};

/** Members per length group (AC-M5), every group present. */
export function bandCountsOf(members: SeoSliceMember[]): Record<SeoSliceLengthGroup, number> {
  const counts: Record<SeoSliceLengthGroup, number> = { under4h: 0, "4to8h": 0, fullDay: 0, unknown: 0 };
  for (const t of members) counts[lengthGroupOf(t.durationMin)]++;
  return counts;
}

/**
 * One `{ count, of }` per keyword group id: `count` is members with at least
 * one inclusion text matching the group, `of` is the member count (AC-S4, AC-S8).
 */
export function inclusionSharesOf(
  members: SeoSliceMember[],
  groupIds: string[],
  manifest: SeoSliceManifest,
): Record<string, SeoSliceShare> {
  const texts = members.map((t) => inclusionTexts(t.inclusions));
  const shares: Record<string, SeoSliceShare> = {};
  for (const id of groupIds) {
    const matches = phrasesMatcher(manifest.keywordGroups[id]?.phrases ?? []);
    shares[id] = { count: texts.filter((list) => list.some(matches)).length, of: members.length };
  }
  return shares;
}

/**
 * Places named in member titles: the manifest `places` minus `excludePlaces`,
 * by count descending then name, only counts of at least 2, at most `limit`.
 */
export function topPlacesOf(
  members: SeoSliceMember[],
  manifest: SeoSliceManifest,
  excludePlaces: readonly string[] = [],
  limit = SEO_SLICE_TOP_PLACES,
): SeoSlicePlaceCount[] {
  const dropped = new Set(excludePlaces.map((p) => p.toLowerCase()));
  return manifest.places
    .filter((name) => !dropped.has(name.toLowerCase()))
    .map((name) => {
      const matches = phrasesMatcher([name]);
      return { name, count: members.filter((t) => matches(t.title)).length };
    })
    .filter((p) => p.count >= SEO_SLICE_PLACE_MIN_COUNT)
    .sort((a, b) => b.count - a.count || compare(a.name, b.name))
    .slice(0, limit);
}

/**
 * The stat strip (D1). Candidates are the keyword groups, in the page's order,
 * then the three known length groups. A keyword share is over every member; a
 * length share is over the members with a listed length (`memberCount` minus
 * `bandCounts.unknown`), and there are no length candidates when none has one.
 * A candidate qualifies at a count of 0 or at a share from 0.2 to 0.8
 * inclusive. Counts above 0 come first, closest to one half first; counts of 0
 * after; ties keep candidate order. The first 3, or none when fewer than 2
 * qualify.
 */
export function stripOf(
  shares: Record<string, SeoSliceShare>,
  groupIds: string[],
  bandCounts: Record<SeoSliceLengthGroup, number>,
  memberCount: number,
  manifest: SeoSliceManifest,
): SeoSliceStripEntry[] {
  const withLength = memberCount - bandCounts.unknown;
  const candidates: SeoSliceStripEntry[] = [
    ...groupIds.map((key) => ({
      kind: "keyword" as const,
      key,
      label: manifest.keywordGroups[key]?.label ?? key,
      count: shares[key]?.count ?? 0,
      of: shares[key]?.of ?? memberCount,
    })),
    ...(withLength > 0 ? KNOWN_LENGTHS : []).map((key) => ({
      kind: "length" as const,
      key,
      label: SEO_SLICE_LENGTH_LABELS[key],
      count: bandCounts[key],
      of: withLength,
    })),
  ];
  // Integer arithmetic, so a share of exactly 0.2 or 0.8 qualifies and ties are exact.
  const qualifies = (c: SeoSliceStripEntry) => c.count === 0 || (5 * c.count >= c.of && 5 * c.count <= 4 * c.of);
  const qualified = candidates.map((entry, index) => ({ entry, index })).filter(({ entry }) => qualifies(entry));
  if (qualified.length < SEO_SLICE_STRIP_MIN) return [];

  // |count / of - 1/2| compared as |2 count - of| / of, cross multiplied.
  const distance = (c: SeoSliceStripEntry) => Math.abs(2 * c.count - c.of);
  qualified.sort((a, b) => {
    const aZero = a.entry.count === 0;
    const bZero = b.entry.count === 0;
    if (aZero !== bZero) return aZero ? 1 : -1;
    if (!aZero) {
      const diff = distance(a.entry) * b.entry.of - distance(b.entry) * a.entry.of;
      if (diff !== 0) return diff;
    }
    return a.index - b.index;
  });
  return qualified.slice(0, SEO_SLICE_STRIP_MAX).map(({ entry }) => entry);
}

/** A category page's `facts` over its printable members (AC-S4). */
export function categoryFactsOf(
  members: SeoSliceMember[],
  plan: SeoSlicePagePicks,
  page: SeoSliceManifestPage,
  manifest: SeoSliceManifest,
): SeoSliceCategoryFacts {
  const groupIds = keywordGroupIdsFor(manifest, page);
  const bandCounts = bandCountsOf(members);
  const inclusionShares = inclusionSharesOf(members, groupIds, manifest);
  return {
    memberCount: members.length,
    bandCounts,
    inclusionShares,
    topPlaces: topPlacesOf(members, manifest, page.excludePlaces),
    sections: plan.sections.map(({ id, label, memberCount }) => ({ id, label, memberCount })),
    strip: stripOf(inclusionShares, groupIds, bandCounts, members.length, manifest),
  };
}

/** A category page's internal gated counts (AC-S4a). */
export function eligibleOf(plan: SeoSlicePagePicks): SeoSliceEligible {
  return {
    count: plan.eligibleCount,
    sections: plan.sections.map(({ id, eligibleCount }) => ({ id, count: eligibleCount })),
  };
}

/** The known length group with the most members, ties in length order; null when none has any. */
export function mainLengthOf(members: SeoSliceMember[]): SeoSliceKnownLengthGroup | null {
  const counts = bandCountsOf(members);
  let best: SeoSliceKnownLengthGroup | null = null;
  for (const band of KNOWN_LENGTHS) {
    if (counts[band] > 0 && (best === null || counts[band] > counts[best])) best = band;
  }
  return best;
}

/**
 * The hub's `facts` (AC-S4): over the union of the printable members of the
 * category pages it lists (`listed`, in manifest order: those with a snapshot
 * that are not held), using the default keyword groups.
 */
export function hubFactsOf(
  listed: { slug: string; members: SeoSliceMember[] }[],
  manifest: SeoSliceManifest,
): SeoSliceHubFacts {
  const union = new Map<string, SeoSliceMember>();
  for (const { members } of listed) for (const t of members) union.set(t.experienceId, t);
  const pool = [...union.values()];
  const groupIds = manifest.defaultKeywordGroupIds;
  const bandCounts = bandCountsOf(pool);
  const inclusionShares = inclusionSharesOf(pool, groupIds, manifest);
  return {
    memberCount: pool.length,
    bandCounts,
    inclusionShares,
    pages: listed.map(({ slug, members }) => ({ slug, memberCount: members.length, mainLength: mainLengthOf(members) })),
    strip: stripOf(inclusionShares, groupIds, bandCounts, pool.length, manifest),
  };
}

/**
 * A pick as the snapshot holds it (AC-S5): no rating, review count, price,
 * coordinate or affiliate URL. `imageAlt` falls back to the title when it is
 * empty or holds a leak term; inclusions are the first 3 clean texts, each
 * trimmed, shown once (case insensitive), at most 120 characters (a longer
 * text is skipped, never cut) and none in the first person.
 */
export function pickOf(planned: SeoSlicePlannedPick | SeoSliceHubPick): SeoSlicePick {
  const { tour, section } = planned;
  const alt = tour.imageAlt?.trim();
  const seen = new Set<string>();
  const inclusions = inclusionTexts(tour.inclusions)
    .map((text) => text.trim())
    .filter((text) => findLeakTerms(text).length === 0 && findFirstPerson(text).length === 0)
    .filter((text) => {
      const key = text.toLowerCase();
      if (text.length === 0 || text.length > SEO_SLICE_INCLUSION_MAX_CHARS || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SEO_SLICE_PICK_INCLUSIONS);
  const pick: SeoSlicePick = {
    experienceId: tour.experienceId,
    providerTourId: tour.providerTourId,
    title: tour.title,
    // The pool keeps only tours with an image (AC-M2a).
    imageUrl: tour.imageUrl as string,
    imageAlt: alt && findLeakTerms(alt).length === 0 ? alt : tour.title,
    durationBand: lengthGroupOf(tour.durationMin),
    section,
    inclusions,
  };
  if ("fromSlug" in planned) pick.fromSlug = planned.fromSlug;
  return pick;
}

/** Plain code unit order, so the result never depends on the machine's locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
