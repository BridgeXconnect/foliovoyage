/**
 * SEO slice membership, sections and picks (spec 0006, page manifest and
 * membership, AC-M2 to AC-M8, AC-M10).
 *
 * Pure: tour rows and the manifest in, members and picks out. No database,
 * network or clock access, so `seo:snapshot` (scope row 20) does the reading and
 * these functions decide. No coordinate field is read (umbrella AC-5), and the
 * only rating read is the BRI-200 gate, as a yes or no (AC-M5).
 *
 * Words, as in the spec: "members" are printable members (no BRI-200 gate);
 * "eligible members" also pass the gate. Printed counts come from members; the
 * floor, the section rule and the picks use eligible members (umbrella AC-9).
 */

import { isViatorHost } from "@folio/shared";
import type {
  SeoSliceLengthGroup,
  SeoSliceManifest,
  SeoSliceManifestPage,
} from "@folio/shared";
import { findLeakTerms, phrasesMatcher } from "./seo-slice-text";
import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";

/** A page with fewer eligible members than this is thin and held (AC-M6). */
export const SEO_SLICE_FLOOR = 10;
/** A named group or `other` needs this many eligible members to be a section (AC-M5). */
export const SEO_SLICE_SECTION_MIN = 3;
export const SEO_SLICE_PICKS_PER_SECTION = 3;
export const SEO_SLICE_ONE_LIST_PICKS = 12;
export const SEO_SLICE_HUB_PICKS_PER_PAGE = 2;

/** The section id for members no shown named group takes. */
export const SEO_SLICE_OTHER = "other";

/** Breaks ties between known length groups of equal size (AC-M5); `unknown` always comes last. */
const KNOWN_LENGTH_ORDER: SeoSliceLengthGroup[] = ["under4h", "4to8h", "fullDay"];

/**
 * The Tour fields these functions read, plus the linked Experience's status.
 * A Prisma `Tour` row with `experience.status` mapped onto `experienceStatus`
 * satisfies it.
 */
export interface SeoSliceTourInput {
  id: string;
  experienceId: string | null;
  /** The linked Experience's `status`, or null when the tour has none. */
  experienceStatus: string | null;
  providerTourId: string;
  title: string;
  durationMin: number | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  affiliateUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** `Tour.inclusions`, verbatim JSON. */
  inclusions: unknown;
  tags: number[];
  destinationRefs: string[];
  deletedAt: Date | null;
}

/** A pool tour: the representative tour of a published Experience. */
export type SeoSliceMember = SeoSliceTourInput & { experienceId: string };

export interface SeoSlicePageMembers {
  /** Printable members: no BRI-200 gate (AC-M2a). */
  members: SeoSliceMember[];
  /** Eligible members: also pass the gate (AC-M2). */
  eligible: SeoSliceMember[];
}

export interface SeoSliceMembership {
  /** The printable Bangkok pool (AC-M2a), with no page rule applied. */
  printablePool: SeoSliceMember[];
  /** The gated Bangkok pool (AC-M2). */
  eligiblePool: SeoSliceMember[];
  /** Every category page, held ones included, by slug. */
  pages: Record<string, SeoSlicePageMembers>;
}

/** Why AC-M3 drops a tour, in the order the rules are checked; the first one wins. */
export type SeoSliceExclusion = "offCity" | "excludedTag" | "tooLong" | "leakTerm" | "noViatorLink";

export interface SeoSliceSection {
  /** A group id, or `other`. */
  id: string;
  label: string;
  /** Eligible members in the section (internal, `eligible.sections`). */
  eligibleCount: number;
  /** Printable members in the section (`facts.sections[].memberCount`). */
  memberCount: number;
}

export interface SeoSlicePlannedPick {
  tour: SeoSliceMember;
  /** The section id, or null when the page shows one list (always null on the hub). */
  section: string | null;
}

export interface SeoSlicePagePicks {
  /** Fewer than {@link SEO_SLICE_FLOOR} eligible members: no snapshot, no picks (AC-M6). */
  thin: boolean;
  eligibleCount: number;
  /** In display order; empty when the page shows one list. */
  sections: SeoSliceSection[];
  /** In render order; empty when the page is thin. */
  picks: SeoSlicePlannedPick[];
}

export type SeoSliceHubPick = SeoSlicePlannedPick & { fromSlug: string };

const titleRegExp = (pattern: string) => new RegExp(pattern, "i");

/** The length group of a duration (AC-M5). */
export function lengthGroupOf(durationMin: number | null): SeoSliceLengthGroup {
  if (durationMin === null || !Number.isFinite(durationMin)) return "unknown";
  if (durationMin < 240) return "under4h";
  if (durationMin < 480) return "4to8h";
  return "fullDay";
}

/**
 * An inclusion's text (AC-S4): its `description`, else its `typeDescription`;
 * an item with neither is skipped.
 */
export function inclusionTexts(inclusions: unknown): string[] {
  if (!Array.isArray(inclusions)) return [];
  const texts: string[] = [];
  for (const item of inclusions) {
    if (item === null || typeof item !== "object") continue;
    const { description, typeDescription } = item as Record<string, unknown>;
    const text = [description, typeDescription].find((v) => typeof v === "string" && v.trim());
    if (typeof text === "string") texts.push(text);
  }
  return texts;
}

/** The keyword group ids a page uses: its own set, else the manifest default. */
export function keywordGroupIdsFor(manifest: SeoSliceManifest, page: SeoSliceManifestPage): string[] {
  return page.keywordGroupIds ?? manifest.defaultKeywordGroupIds;
}

/** The first AC-M3 exclusion that applies to a tour, or null. */
export function exclusionOf(tour: SeoSliceTourInput, manifest: SeoSliceManifest): SeoSliceExclusion | null {
  const ex = manifest.exclusions;
  if (titleRegExp(ex.offCityTitlePattern).test(tour.title)) return "offCity";
  if (tour.tags.some((t) => ex.excludeTagIds.includes(t))) return "excludedTag";
  if (tour.durationMin !== null && tour.durationMin > ex.maxDurationMin) return "tooLong";
  if (findLeakTerms(tour.title).length > 0) return "leakTerm";
  if (!isViatorHost(tour.affiliateUrl)) return "noViatorLink";
  return null;
}

/**
 * The representative tour of each Experience: its lowest `id` tour that is not
 * deleted (index.md, Representative tour). Ordered by Experience id.
 */
export function representativeTours(tours: SeoSliceTourInput[]): SeoSliceMember[] {
  const byExperience = new Map<string, SeoSliceMember>();
  for (const tour of tours) {
    if (tour.experienceId === null || tour.deletedAt !== null) continue;
    const current = byExperience.get(tour.experienceId);
    if (!current || tour.id < current.id) byExperience.set(tour.experienceId, tour as SeoSliceMember);
  }
  return [...byExperience.values()].sort((a, b) => compare(a.experienceId, b.experienceId));
}

function inPrintablePool(tour: SeoSliceMember, manifest: SeoSliceManifest): boolean {
  return (
    tour.destinationRefs.includes(manifest.city.destinationRef) &&
    tour.experienceStatus === "published" &&
    tour.imageUrl !== null &&
    exclusionOf(tour, manifest) === null
  );
}

/** Whether a tour passes a category page's rule (AC-M4): any of its tag ids, or its title pattern. */
export function matchesRule(tour: SeoSliceMember, page: SeoSliceManifestPage): boolean {
  const rule = page.rule;
  if (!rule) return false;
  return tour.tags.some((t) => rule.tagIds.includes(t)) || titleRegExp(rule.titlePattern).test(tour.title);
}

/**
 * The Bangkok pools and each category page's members (AC-M2, AC-M2a, AC-M4).
 * Every rule is applied to an Experience's representative tour, so one
 * Experience counts once per page. Pass every tour of every Experience that
 * may qualify, not only the ones that look like matches, or the representative
 * tour cannot be chosen correctly.
 */
export function selectMembers(tours: SeoSliceTourInput[], manifest: SeoSliceManifest): SeoSliceMembership {
  const printablePool = representativeTours(tours).filter((t) => inPrintablePool(t, manifest));
  const eligiblePool = printablePool.filter((t) => evaluateTourCopyEligibility(t).eligible);
  const pages: Record<string, SeoSlicePageMembers> = {};
  for (const page of manifest.pages) {
    if (page.kind !== "category") continue;
    pages[page.slug] = {
      members: printablePool.filter((t) => matchesRule(t, page)),
      eligible: eligiblePool.filter((t) => matchesRule(t, page)),
    };
  }
  return { printablePool, eligiblePool, pages };
}

/**
 * Sections, order and picks for one category page (AC-M5, AC-M6, AC-M10).
 * `members` is that page's entry from {@link selectMembers}.
 */
export function selectPicks(
  members: SeoSlicePageMembers,
  page: SeoSliceManifestPage,
  manifest: SeoSliceManifest,
): SeoSlicePagePicks {
  const groups = (page.groups ?? []).map((g) => ({ ...g, re: titleRegExp(g.titlePattern) }));
  const firstGroup = (t: SeoSliceMember) => groups.find((g) => g.re.test(t.title))?.id ?? SEO_SLICE_OTHER;

  // Eligible members into their first matching group; small named groups fold into `other`.
  const buckets = new Map<string, SeoSliceMember[]>();
  for (const t of members.eligible) {
    const id = firstGroup(t);
    buckets.set(id, [...(buckets.get(id) ?? []), t]);
  }
  const kept = groups.filter((g) => (buckets.get(g.id)?.length ?? 0) >= SEO_SLICE_SECTION_MIN);
  const keptIds = new Set(kept.map((g) => g.id));
  const otherEligible = members.eligible.filter((t) => !keptIds.has(firstGroup(t)));
  const showOther = otherEligible.length >= SEO_SLICE_SECTION_MIN;
  const oneList = kept.length + (showOther ? 1 : 0) < 2;

  const ordering = rankWithin(page, manifest);
  const excluded = new Set(manifest.excludedExperiences.map((e) => e.experienceId));
  const take = (pool: SeoSliceMember[], n: number) =>
    ordering(pool)
      .filter((t) => !excluded.has(t.experienceId))
      .slice(0, n);

  const eligibleCount = members.eligible.length;
  const thin = eligibleCount < SEO_SLICE_FLOOR;

  if (oneList) {
    return {
      thin,
      eligibleCount,
      sections: [],
      picks: thin ? [] : take(members.eligible, SEO_SLICE_ONE_LIST_PICKS).map((tour) => ({ tour, section: null })),
    };
  }

  // A printable member goes to its first matching group when that group is a
  // section, else to `other` (which counts only when `other` is a section).
  const memberSection = (t: SeoSliceMember) => {
    const id = firstGroup(t);
    return keptIds.has(id) ? id : SEO_SLICE_OTHER;
  };
  const shown = [
    ...kept.map((g) => ({ id: g.id, label: g.label })),
    ...(showOther ? [{ id: SEO_SLICE_OTHER, label: page.otherLabel ?? "" }] : []),
  ];
  const sections: SeoSliceSection[] = shown.map(({ id, label }) => ({
    id,
    label,
    eligibleCount: id === SEO_SLICE_OTHER ? otherEligible.length : (buckets.get(id)?.length ?? 0),
    memberCount: members.members.filter((t) => memberSection(t) === id).length,
  }));

  const picks: SeoSlicePlannedPick[] = thin
    ? []
    : sections.flatMap(({ id }) => {
        const pool = id === SEO_SLICE_OTHER ? otherEligible : (buckets.get(id) ?? []);
        return take(pool, SEO_SLICE_PICKS_PER_SECTION).map((tour) => ({ tour, section: id }));
      });

  return { thin, eligibleCount, sections, picks };
}

/**
 * The order inside a section or the one list (AC-M5): split by length group;
 * inside a length group, more of the page's keyword groups covered first, then
 * `providerTourId` ascending; then take one from each non empty length group in
 * turn until all are used. The known length groups go by member count in the
 * pool, descending (ties `under4h`, `4to8h`, `fullDay`), and `unknown` last.
 */
function rankWithin(page: SeoSliceManifestPage, manifest: SeoSliceManifest) {
  const matchers = keywordGroupIdsFor(manifest, page).map((id) => phrasesMatcher(manifest.keywordGroups[id]?.phrases ?? []));
  const covered = (t: SeoSliceMember) => {
    const texts = inclusionTexts(t.inclusions);
    return matchers.filter((m) => texts.some(m)).length;
  };

  return (pool: SeoSliceMember[]): SeoSliceMember[] => {
    const score = new Map(pool.map((t) => [t, covered(t)]));
    const bandOf = (band: SeoSliceLengthGroup) =>
      pool
        .filter((t) => lengthGroupOf(t.durationMin) === band)
        .sort((a, b) => score.get(b)! - score.get(a)! || compare(a.providerTourId, b.providerTourId));
    // A stable sort keeps KNOWN_LENGTH_ORDER for ties.
    const known = KNOWN_LENGTH_ORDER.map(bandOf).sort((a, b) => b.length - a.length);
    const bands = [...known, bandOf("unknown")];
    const out: SeoSliceMember[] = [];
    for (let i = 0; out.length < pool.length; i++) {
      for (const band of bands) if (i < band.length) out.push(band[i]);
    }
    return out;
  };
}

/**
 * The hub's picks (AC-M7): walk the category pages that are not held and have
 * a snapshot (`pagePicks` holds only those), in manifest order, taking the
 * first 2 of each page's picks, in render order, whose Experience the hub has
 * not already taken.
 */
export function selectHubPicks(
  manifest: SeoSliceManifest,
  pagePicks: Record<string, SeoSlicePlannedPick[]>,
): SeoSliceHubPick[] {
  const taken = new Set<string>();
  const out: SeoSliceHubPick[] = [];
  for (const page of manifest.pages) {
    if (page.kind !== "category" || page.held) continue;
    const picks = pagePicks[page.slug];
    if (!picks) continue;
    let given = 0;
    for (const { tour } of picks) {
      if (given === SEO_SLICE_HUB_PICKS_PER_PAGE) break;
      if (taken.has(tour.experienceId)) continue;
      taken.add(tour.experienceId);
      out.push({ tour, section: null, fromSlug: page.slug });
      given++;
    }
  }
  return out;
}

/** Plain code unit order, so the result never depends on the machine's locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
