/**
 * The fixed text templates a slice page prints (spec 0006 page template): the
 * rule line (AC-T12), the "How this page was made" note (AC-T4), the stat
 * strip and its caption (AC-T13), the hub's one line fact (AC-T3), the
 * disclosure (AC-T11), card band labels (spec 0006 pick card, AC-C1) and the
 * dates. Pure: no generated text, filled only from manifest and snapshot data.
 * The rule line and the notes hold no digits; the manifest strings they print
 * hold none either (index.md, No digits in note and rule line inputs).
 */

import type {
  SeoSliceKnownLengthGroup,
  SeoSliceLengthGroup,
  SeoSliceManifest,
  SeoSliceManifestPage,
  SeoSliceStripEntry,
} from "@folio/shared";
import { keywordGroupIdsFor } from "./validate";

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const QUALITY_BAR =
  "A minimum quality bar set from Viator's own traveller feedback decides whether a tour appears here, never where.";

/** The page's tag names, in rule order, joined with "or" (AC-T4, AC-T12). */
export function tagNamesFor(manifest: SeoSliceManifest, page: SeoSliceManifestPage): string {
  return (page.rule?.tagIds ?? []).map((id) => manifest.tagNames[String(id)] ?? String(id)).join(" or ");
}

/** AC-T12. Category pages and the hub; the stats page has its own (row 25). */
export function ruleLine(manifest: SeoSliceManifest, page: SeoSliceManifestPage): string {
  if (page.kind === "hub") {
    return `Tours from each Bangkok topic page below, each chosen by that page's own rule. ${QUALITY_BAR}`;
  }
  const words = page.rule?.plainWords ?? "";
  if ((page.rule?.tagIds ?? []).length === 0) {
    return `Tours from Viator's Bangkok catalogue with ${words} in the title. ${QUALITY_BAR}`;
  }
  return `Tours from Viator's Bangkok catalogue tagged ${tagNamesFor(manifest, page)}, or with ${words} in the title. ${QUALITY_BAR}`;
}

/**
 * AC-T4, the "How this page was made" note. `sectionLabels` are the snapshot's
 * section labels in order; an empty list means the page shows one list.
 */
export function howMadeNote(
  manifest: SeoSliceManifest,
  page: SeoSliceManifestPage,
  sectionLabels: string[],
): string {
  const exclusions = `It leaves out ${manifest.exclusions.plainWords}.`;
  if (page.kind === "hub") {
    return [
      "This page takes two tours from each of the Bangkok topic pages linked above, each chosen by that page's own rule.",
      exclusions,
      QUALITY_BAR,
    ].join(" ");
  }
  const words = page.rule?.plainWords ?? "";
  const first =
    (page.rule?.tagIds ?? []).length === 0
      ? `This page lists tours from Viator's Bangkok catalogue whose titles mention ${words}.`
      : `This page lists tours from Viator's Bangkok catalogue that carry the Viator tag ${tagNamesFor(manifest, page)}, or whose titles mention ${words}.`;
  const keywords = joinAnd(
    keywordGroupIdsFor(manifest, page).map((id) => manifest.keywordGroups[id]?.label ?? id),
  );
  const order =
    sectionLabels.length === 0
      ? [`Tours alternate across trip lengths, then follow how many of these they include: ${keywords}, then Viator's product code.`]
      : [
          `Tours are grouped by ${joinAnd(sectionLabels)}.`,
          `Inside each group they alternate across trip lengths, then follow how many of these they include: ${keywords}, then Viator's product code.`,
        ];
  return [first, exclusions, QUALITY_BAR, ...order, "Tours whose photos do not show the tour may be left out."].join(" ");
}

/** AC-T13, one line per strip entry, in order. */
export function stripLine(entry: SeoSliceStripEntry): string {
  if (entry.kind === "keyword") {
    return entry.count > 0
      ? `${entry.count} of ${entry.of} include ${entry.label}`
      : `None of the ${entry.of} include ${entry.label}`;
  }
  return entry.count > 0
    ? `${entry.count} of ${entry.of} with a listed length take ${entry.label}`
    : `None of the ${entry.of} with a listed length take ${entry.label}`;
}

/** AC-T13, under a strip and under the hub's sections. */
export const COUNTS_CAPTION =
  "Counts cover every tour in Viator's Bangkok catalogue that matches the rule, including tours below the quality bar.";

const LENGTH_PHRASE: Record<SeoSliceKnownLengthGroup, string> = {
  under4h: "under 4 hours",
  "4to8h": "4 to 8 hours",
  fullDay: "a full day",
};

/** AC-T3, the hub's one line fact for a category page it lists. */
export function hubFact(memberCount: number, mainLength: SeoSliceKnownLengthGroup | null): string {
  return mainLength
    ? `${memberCount} tours match its rule, most of them ${LENGTH_PHRASE[mainLength]}`
    : `${memberCount} tours match its rule`;
}

/** AC-T11, shown in full on every slice page. */
export const SLICE_DISCLOSURE =
  "Folio Voyage earns a commission when you book a tour through the Viator links on this page, at no extra cost to you. Tours appear by the rule on this page, never by commission.";

/** Spec 0006 pick card, AC-C1. */
export const BAND_LABEL: Record<SeoSliceLengthGroup, string> = {
  under4h: "Under 4 hours",
  "4to8h": "4 to 8 hours",
  fullDay: "A full day",
  unknown: "Duration not listed",
};

const LONG_DATE = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone });

/** A `YYYY-MM-DD` calendar date as `d MMMM yyyy` ("16 October 2026"). */
export function formatCalendarDate(date: string): string {
  return LONG_DATE("UTC").format(new Date(`${date}T00:00:00Z`));
}

/** An instant as its `d MMMM yyyy` date in Asia/Bangkok (AC-T12, `factCheck.at`). */
export function formatBangkokDate(instant: string): string {
  return LONG_DATE("Asia/Bangkok").format(new Date(instant));
}

/** The link text for a Good to know source: the url's host name (AC-T14). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
