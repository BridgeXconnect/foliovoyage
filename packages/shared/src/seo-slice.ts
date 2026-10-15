/**
 * SEO proving slice, Bangkok (BRI-114, spec 0006): the file formats the slice
 * shares across apps, plus the two word lists every scan uses.
 *
 * Types and data only. `apps/api` imports the types with `import type` (it is
 * CommonJS and cannot `require` this ESM package at runtime), so it keeps its
 * own copy of the two lists and a parity test compares them with this file.
 * `apps/web` imports both freely.
 *
 * The content files live in `apps/web/src/content/seo/bangkok/`; see spec 0006
 * index.md (Cross child contract) for who writes and reads each one.
 */

export type SeoSlicePageKind = "hub" | "category" | "stats";

/** Trip length groups (AC-M5): under 240 min, 240 to 479, 480 or more, no duration. */
export type SeoSliceLengthGroup = "under4h" | "4to8h" | "fullDay" | "unknown";
export type SeoSliceKnownLengthGroup = Exclude<SeoSliceLengthGroup, "unknown">;

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

export interface SeoSliceRule {
  tagIds: number[];
  /** JavaScript regular expression, matched case insensitive against `Tour.title`. */
  titlePattern: string;
  /** The title pattern said in words, for the method note and the copy grounding. */
  plainWords: string;
}

export interface SeoSliceGroup {
  id: string;
  label: string;
  titlePattern: string;
}

export interface SeoSliceKeywordGroup {
  /** The words a template prints, for example "hotel pickup". */
  label: string;
  phrases: string[];
}

export interface SeoSliceSourceFact {
  fact: string;
  /** An `https` link to the public source. */
  url: string;
  /** `YYYY-MM-DD`, the date the source was last read. */
  checked: string;
}

export interface SeoSliceExcludedExperience {
  experienceId: string;
  /** Internal only, never rendered. */
  reason: string;
}

export interface SeoSliceManifestPage {
  slug: string;
  kind: SeoSlicePageKind;
  /** Null on the stats page. */
  targetQuery: string | null;
  h1: string;
  /** Takes the page out of the snapshot, the hub and the live set without deleting it. */
  held?: boolean;
  /** Category pages only. */
  rule?: SeoSliceRule;
  groups?: SeoSliceGroup[];
  otherLabel?: string;
  /** Falls back to the manifest's `defaultKeywordGroupIds`. */
  keywordGroupIds?: string[];
  excludePlaces?: string[];
  ogImageExperienceId?: string;
  sourceFacts?: SeoSliceSourceFact[];
}

export interface SeoSliceManifest {
  schemaVersion: 1;
  city: { slug: string; countrySlug: string; name: string; destinationRef: string };
  exclusions: {
    offCityTitlePattern: string;
    excludeTagIds: number[];
    maxDurationMin: number;
    plainWords: string;
  };
  /** Personal names that must never appear on a slice page. Roy fills it; empty fails validation. */
  forbiddenNames: string[];
  /** Tag id (as a string key) to its name, for every tag id the manifest uses. */
  tagNames: Record<string, string>;
  keywordGroups: Record<string, SeoSliceKeywordGroup>;
  defaultKeywordGroupIds: string[];
  places: string[];
  excludedExperiences: SeoSliceExcludedExperience[];
  pages: SeoSliceManifestPage[];
}

// ---------------------------------------------------------------------------
// {slug}.snapshot.json
// ---------------------------------------------------------------------------

export interface SeoSliceShare {
  count: number;
  of: number;
}

export interface SeoSlicePlaceCount {
  name: string;
  count: number;
}

export interface SeoSliceStripEntry {
  kind: "keyword" | "length";
  /** The keyword group id or the length group. */
  key: string;
  label: string;
  count: number;
  of: number;
}

export interface SeoSliceSectionFact {
  id: string;
  label: string;
  memberCount: number;
}

/** Every count is over printable members (spec 0006 AC-9). */
export interface SeoSliceCategoryFacts {
  memberCount: number;
  bandCounts: Record<SeoSliceLengthGroup, number>;
  /** Keyed by keyword group id. */
  inclusionShares: Record<string, SeoSliceShare>;
  topPlaces: SeoSlicePlaceCount[];
  sections: SeoSliceSectionFact[];
  strip: SeoSliceStripEntry[];
}

export interface SeoSliceHubFacts {
  memberCount: number;
  bandCounts: Record<SeoSliceLengthGroup, number>;
  inclusionShares: Record<string, SeoSliceShare>;
  pages: { slug: string; memberCount: number; mainLength: SeoSliceKnownLengthGroup | null }[];
  strip: SeoSliceStripEntry[];
}

export interface SeoSliceStatsFacts {
  poolCount: number;
  durationByCategory: {
    slug: string;
    memberCount: number;
    bandCounts: Record<SeoSliceLengthGroup, number>;
    medianDurationMin: number | null;
  }[];
  inclusionShares: Record<string, SeoSliceShare>;
  topPlaces: SeoSlicePlaceCount[];
}

export type SeoSliceFacts = SeoSliceCategoryFacts | SeoSliceHubFacts | SeoSliceStatsFacts;

export interface SeoSlicePick {
  experienceId: string;
  providerTourId: string;
  title: string;
  imageUrl: string;
  imageAlt: string;
  durationBand: SeoSliceLengthGroup;
  /** The group id, "other", or null when the page shows one list (always null on the hub). */
  section: string | null;
  inclusions: string[];
  /** Hub picks only: the category page the pick came from. */
  fromSlug?: string;
}

/** Internal counts through the BRI-200 gate. Never rendered, hashed or grounded. */
export interface SeoSliceEligible {
  count: number;
  sections: { id: string; count: number }[];
}

export interface SeoSliceSnapshot {
  schemaVersion: 1;
  slug: string;
  /** `YYYY-MM-DD` in Asia/Bangkok. */
  computedOn: string;
  facts: SeoSliceFacts;
  factsHash: string;
  /** Null on the hub and stats snapshots. */
  eligible: SeoSliceEligible | null;
  picks: SeoSlicePick[];
  picksHash: string;
}

/** A snapshot as `pages.generated.ts` carries it: without the internal `eligible` block. */
export type SeoSlicePublicSnapshot = Omit<SeoSliceSnapshot, "eligible">;

// ---------------------------------------------------------------------------
// {slug}.notes.json
// ---------------------------------------------------------------------------

export type SeoSliceNoteKind = "timing" | "how-to" | "opinion" | "warning";

export interface SeoSliceNote {
  id: string;
  kind: SeoSliceNoteKind;
  basis: "firsthand";
  /** `YYYY-MM-DD`. */
  written: string;
  /** 1 to 400 characters, rendered verbatim. */
  text: string;
}

export interface SeoSliceNotes {
  schemaVersion: 1;
  slug: string;
  notes: SeoSliceNote[];
}

// ---------------------------------------------------------------------------
// {slug}.copy.json
// ---------------------------------------------------------------------------

export interface SeoSliceFactCheck {
  /** Internal record, never rendered. */
  by: string;
  at: string;
  checkHash: string;
}

export interface SeoSliceCopy {
  schemaVersion: 1;
  slug: string;
  /** Absent on the stats page. */
  intro?: string;
  seoTitle: string;
  metaDescription: string;
  groundingHash: string;
  model: string;
  promptVersion: string;
  attempts: number;
  generatedAt: string;
  /** Absent until `hub-copy:approve` writes it. */
  factCheck?: SeoSliceFactCheck;
}

// ---------------------------------------------------------------------------
// Word lists (spec 0006 page template, AC-T6)
// ---------------------------------------------------------------------------

/**
 * Terms no slice page, note, source fact or generated copy may contain.
 * Matching rules, all case insensitive:
 * - `wordPrefixes` match at the start of a word ("rated", "reviews");
 * - `wholeWords` match as a whole word or phrase;
 * - `symbols` match anywhere;
 * - `currencies` match next to a digit ("$12", "200 THB"), or after the word
 *   "from" ("from USD").
 */
export const SEO_SLICE_LEAK_TERMS = {
  wordPrefixes: ["rating", "rated", "review", "price", "availab", "cancel", "refund"],
  wholeWords: ["stars", "sold out", "book now", "spots left"],
  symbols: ["★"],
  currencies: ["$", "€", "£", "฿", "USD", "THB", "EUR", "GBP"],
} as const;

/** Wording that implies more people than exist (spec 0006 AC-7). */
export const SEO_SLICE_TEAM_TERMS = [
  "our editors",
  "our experts",
  "our writers",
  "our team of",
  "our staff",
] as const;
