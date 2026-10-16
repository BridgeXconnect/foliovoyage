/**
 * What one `seo:snapshot` run writes, deletes and prints (spec 0006 prod
 * snapshot, AC-S4 to AC-S7, AC-S9).
 *
 * Pure: tour rows, the manifest, the existing snapshot files and today's date
 * in, a plan out. `seo-snapshot.cli.ts` does the reading and writing. The
 * stats snapshot (AC-D1) belongs to scope row 25, so the stats page is
 * reported as skipped and its file is left as it is.
 */

import type { SeoSliceEligible, SeoSliceManifest, SeoSliceSnapshot } from "@folio/shared";
import { isViatorHost } from "@folio/shared";
import { categoryFactsOf, eligibleOf, hubFactsOf, pickOf } from "./seo-slice-facts";
import { canonicalHash, canonicalJson } from "./seo-slice-hash";
import {
  matchesRule,
  representativeTours,
  SEO_SLICE_FLOOR,
  selectHubPicks,
  selectMembers,
  selectPicks,
  type SeoSliceMember,
  type SeoSlicePlannedPick,
  type SeoSliceTourInput,
} from "./seo-slice-membership";
import { findLeakTerms } from "./seo-slice-text";

/** The Viator tags AC-S7 names on their own; every other `excludeTagIds` entry counts as flagged. */
export const SEO_SLICE_MULTI_DAY_TAG = 11922;
export const SEO_SLICE_TRANSFERS_TAG = 12044;

/** The exclusion counts' labels, in the order a tour is checked; the first that hits wins. */
export const SEO_SLICE_EXCLUSION_LABELS = [
  "off city",
  "multi day",
  "transfers",
  "flagged",
  "leak term",
  "non Viator link",
] as const;
export type SeoSliceExclusionLabel = (typeof SEO_SLICE_EXCLUSION_LABELS)[number];

export type SeoSnapshotStatus =
  | "unchanged"
  | "facts changed"
  | "picks changed"
  | "facts changed, picks changed"
  | "eligible changed"
  | "thin"
  | "held"
  | "skipped";

export interface SeoSnapshotPagePlan {
  slug: string;
  status: SeoSnapshotStatus;
  /** The file to write, when the page's file changes. */
  write: SeoSliceSnapshot | null;
  /** True when a thin page's existing file must be deleted. */
  remove: boolean;
  factsChanged: boolean;
  picksChanged: boolean;
  /** Why a page was skipped, for the report. */
  note?: string;
}

export interface SeoSnapshotExclusionRow {
  /** A category page's slug, or null for the whole pool. */
  slug: string | null;
  counts: Record<SeoSliceExclusionLabel, number>;
}

export interface SeoSnapshotPlan {
  pages: SeoSnapshotPagePlan[];
  thin: string[];
  exclusions: SeoSnapshotExclusionRow[];
}

/**
 * The first AC-S7 exclusion that hits a tour, or null. Same rules as the
 * pool's AC-M3 check, split into the labels the report prints.
 */
export function exclusionLabelOf(tour: SeoSliceTourInput, manifest: SeoSliceManifest): SeoSliceExclusionLabel | null {
  const ex = manifest.exclusions;
  const excluded = (id: number) => tour.tags.includes(id) && ex.excludeTagIds.includes(id);
  if (new RegExp(ex.offCityTitlePattern, "i").test(tour.title)) return "off city";
  if (excluded(SEO_SLICE_MULTI_DAY_TAG) || (tour.durationMin !== null && tour.durationMin > ex.maxDurationMin)) {
    return "multi day";
  }
  if (excluded(SEO_SLICE_TRANSFERS_TAG)) return "transfers";
  if (tour.tags.some((t) => ex.excludeTagIds.includes(t))) return "flagged";
  if (findLeakTerms(tour.title).length > 0) return "leak term";
  if (!isViatorHost(tour.affiliateUrl)) return "non Viator link";
  return null;
}

/**
 * Exclusion counts per category page (held pages included) and for the whole
 * pool (AC-S7). A tour counts when it is the representative tour of a
 * published Experience under the city's ref with an image, before the BRI-200
 * gate. CLI output only: never written or hashed.
 */
export function exclusionCounts(tours: SeoSliceTourInput[], manifest: SeoSliceManifest): SeoSnapshotExclusionRow[] {
  const base = representativeTours(tours).filter(
    (t) =>
      t.destinationRefs.includes(manifest.city.destinationRef) && t.experienceStatus === "published" && t.imageUrl !== null,
  );
  const labelled = base.map((t) => ({ t, label: exclusionLabelOf(t, manifest) }));
  const count = (rows: typeof labelled): SeoSnapshotExclusionRow["counts"] => {
    const counts = Object.fromEntries(SEO_SLICE_EXCLUSION_LABELS.map((l) => [l, 0])) as SeoSnapshotExclusionRow["counts"];
    for (const { label } of rows) if (label) counts[label]++;
    return counts;
  };
  const rows: SeoSnapshotExclusionRow[] = manifest.pages
    .filter((p) => p.kind === "category")
    .map((p) => ({ slug: p.slug, counts: count(labelled.filter(({ t }) => matchesRule(t, p))) }));
  rows.push({ slug: null, counts: count(labelled) });
  return rows;
}

/** A snapshot with both hashes set. */
function snapshotOf(
  slug: string,
  computedOn: string,
  facts: SeoSliceSnapshot["facts"],
  eligible: SeoSliceEligible | null,
  picks: SeoSliceSnapshot["picks"],
): SeoSliceSnapshot {
  return {
    schemaVersion: 1,
    slug,
    computedOn,
    facts,
    factsHash: canonicalHash(facts),
    eligible,
    picks,
    picksHash: canonicalHash(picks),
  };
}

/** Compares a fresh snapshot with the file on disk and decides what to write (AC-S7). */
function compareWithExisting(next: SeoSliceSnapshot, existing: SeoSliceSnapshot | null): SeoSnapshotPagePlan {
  const base = { slug: next.slug, remove: false };
  if (!existing) {
    return { ...base, status: "facts changed, picks changed", write: next, factsChanged: true, picksChanged: true };
  }
  const factsChanged = existing.factsHash !== next.factsHash;
  const picksChanged = existing.picksHash !== next.picksHash;
  if (!factsChanged && !picksChanged) {
    if (canonicalJson(existing.eligible ?? null) === canonicalJson(next.eligible)) {
      return { ...base, status: "unchanged", write: null, factsChanged, picksChanged };
    }
    return {
      ...base,
      status: "eligible changed",
      write: { ...next, computedOn: existing.computedOn },
      factsChanged,
      picksChanged,
    };
  }
  const status = factsChanged && picksChanged ? "facts changed, picks changed" : factsChanged ? "facts changed" : "picks changed";
  return { ...base, status, write: next, factsChanged, picksChanged };
}

/**
 * The run's plan. Category pages first; the hub after them, from the
 * category pages that passed (not held, not thin), so it never waits on a
 * thin page (AC-S6).
 */
export function planSnapshot(input: {
  tours: SeoSliceTourInput[];
  manifest: SeoSliceManifest;
  existing: Record<string, SeoSliceSnapshot | null>;
  /** `YYYY-MM-DD` in Asia/Bangkok. */
  today: string;
}): SeoSnapshotPlan {
  const { tours, manifest, existing, today } = input;
  const membership = selectMembers(tours, manifest);
  const pages: SeoSnapshotPagePlan[] = [];
  const thin: string[] = [];
  const passed: { slug: string; members: SeoSliceMember[]; picks: SeoSlicePlannedPick[] }[] = [];
  const skip = (slug: string, status: "held" | "skipped", note: string): SeoSnapshotPagePlan => ({
    slug,
    status,
    write: null,
    remove: false,
    factsChanged: false,
    picksChanged: false,
    note,
  });

  for (const page of manifest.pages) {
    if (page.kind !== "category") continue;
    if (page.held) {
      pages.push(skip(page.slug, "held", "held in the manifest, file left as it is"));
      continue;
    }
    const members = membership.pages[page.slug];
    const plan = selectPicks(members, page, manifest);
    if (plan.thin) {
      thin.push(page.slug);
      pages.push({
        slug: page.slug,
        status: "thin",
        write: null,
        remove: Boolean(existing[page.slug]),
        factsChanged: false,
        picksChanged: false,
        note: `${plan.eligibleCount} eligible members, the floor is ${SEO_SLICE_FLOOR}`,
      });
      continue;
    }
    passed.push({ slug: page.slug, members: members.members, picks: plan.picks });
    const next = snapshotOf(
      page.slug,
      today,
      categoryFactsOf(members.members, plan, page, manifest),
      eligibleOf(plan),
      plan.picks.map(pickOf),
    );
    pages.push(compareWithExisting(next, existing[page.slug] ?? null));
  }

  for (const page of manifest.pages) {
    if (page.kind === "category") continue;
    if (page.held) {
      pages.push(skip(page.slug, "held", "held in the manifest, file left as it is"));
      continue;
    }
    if (page.kind === "stats") {
      pages.push(skip(page.slug, "skipped", "the stats snapshot is built in scope row 25, file left as it is"));
      continue;
    }
    const hubPicks = selectHubPicks(manifest, Object.fromEntries(passed.map((p) => [p.slug, p.picks])));
    const next = snapshotOf(page.slug, today, hubFactsOf(passed, manifest), null, hubPicks.map(pickOf));
    pages.push(compareWithExisting(next, existing[page.slug] ?? null));
  }

  // Reported in manifest order, though the hub was computed last.
  const order = new Map(manifest.pages.map((p, i) => [p.slug, i]));
  pages.sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  return { pages, thin, exclusions: exclusionCounts(tours, manifest) };
}
