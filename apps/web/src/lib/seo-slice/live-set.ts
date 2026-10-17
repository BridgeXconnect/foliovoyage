/**
 * The live set (spec 0006 index.md AC-2, Hashes, Live set): which slice pages
 * are ready, which are live, and the three page hashes that decide it.
 *
 * `hub-copy:approve` in apps/api computes `checkHash` from the same inputs, in
 * the same shape, as `checkHashInput` below. Change one, change both.
 */

import type {
  SeoSliceManifest,
  SeoSliceManifestPage,
  SeoSliceSnapshot,
  SeoSliceStatsFacts,
} from "@folio/shared";
import { canonicalHash } from "./hash";
import { keywordGroupIdsFor } from "./validate";
import type { SliceContent } from "./types";

/** `canonicalHash` of the inputs the copy was written from (index.md, Hashes). */
export function groundingHashFor(
  manifest: SeoSliceManifest,
  page: SeoSliceManifestPage,
  snapshot: SeoSliceSnapshot,
): string {
  return canonicalHash({
    factsHash: snapshot.factsHash,
    h1: page.h1,
    targetQuery: page.targetQuery,
    rulePlainWords: page.rule?.plainWords ?? null,
    exclusionsPlainWords: manifest.exclusions.plainWords,
    sourceFacts: page.sourceFacts ?? [],
  });
}

/** The category pages the hub lists: a snapshot and not held, in manifest order (AC-M7). */
export function listedCategoryPages(content: SliceContent): SeoSliceManifestPage[] {
  return (content.manifest?.pages ?? []).filter(
    (p) => p.kind === "category" && !p.held && content.snapshots[p.slug] !== undefined,
  );
}

/**
 * The `imageUrl` of the pick `ogImageExperienceId` names (AC-T5): from the
 * page's own picks, or for the stats page from any category page snapshot.
 * Null when no current snapshot holds that pick.
 */
export function ogImageUrlFor(content: SliceContent, page: SeoSliceManifestPage): string | null {
  const id = page.ogImageExperienceId;
  if (!id) return null;
  const snapshots =
    page.kind === "stats"
      ? (content.manifest?.pages ?? [])
          .filter((p) => p.kind === "category")
          .map((p) => content.snapshots[p.slug])
      : [content.snapshots[page.slug]];
  for (const snap of snapshots) {
    const pick = snap?.picks.find((p) => p.experienceId === id);
    if (pick) return pick.imageUrl;
  }
  return null;
}

/**
 * Every manifest string the page prints that the grounding does not already
 * cover (index.md, Hashes, `rendered`). Keys absent for a kind are omitted.
 */
export function renderedStrings(content: SliceContent, page: SeoSliceManifestPage): Record<string, unknown> {
  const manifest = content.manifest!;
  const byslug = new Map(manifest.pages.map((p) => [p.slug, p]));
  const hub = manifest.pages.find((p) => p.kind === "hub");
  const label = (id: string) => manifest.keywordGroups[id]?.label ?? null;
  const rendered: Record<string, unknown> = { hubH1: hub?.h1 ?? null };

  if (page.kind === "category") {
    rendered.tagNames = (page.rule?.tagIds ?? []).map((id) => manifest.tagNames[String(id)] ?? null);
    rendered.keywordLabels = keywordGroupIdsFor(manifest, page).map(label);
  } else if (page.kind === "hub") {
    rendered.pages = listedCategoryPages(content).map((p) => ({ slug: p.slug, h1: p.h1 }));
  } else {
    const facts = content.snapshots[page.slug]?.facts as SeoSliceStatsFacts | undefined;
    rendered.pages = (facts?.durationByCategory ?? []).map((d) => ({
      slug: d.slug,
      h1: byslug.get(d.slug)?.h1 ?? null,
    }));
    rendered.keywordLabels = manifest.defaultKeywordGroupIds.map(label);
    rendered.places = manifest.places;
  }
  return rendered;
}

/** The value `checkHash` hashes (index.md, Hashes). Needs the page's snapshot and copy. */
export function checkHashInput(content: SliceContent, page: SeoSliceManifestPage): Record<string, unknown> {
  const copy = content.copies[page.slug];
  const snapshot = content.snapshots[page.slug];
  const input: Record<string, unknown> = {
    seoTitle: copy.seoTitle,
    metaDescription: copy.metaDescription,
    notes: content.notes[page.slug]?.notes ?? [],
    sourceFacts: page.sourceFacts ?? [],
    picksHash: page.kind === "stats" ? null : snapshot.picksHash,
    ogImageExperienceId: page.ogImageExperienceId ?? null,
    ogImageUrl: ogImageUrlFor(content, page),
    rendered: renderedStrings(content, page),
  };
  if (page.kind !== "stats") input.intro = copy.intro ?? null;
  return input;
}

export function checkHashFor(content: SliceContent, page: SeoSliceManifestPage): string {
  return canonicalHash(checkHashInput(content, page));
}

export type NotReadyReason = "held" | "no snapshot" | "no copy" | "not fact checked" | "checkHash stale";

export interface LiveSetResult {
  /** Live slugs in manifest order. */
  liveSlugs: string[];
  /** Why each page that is not live is not live: the first reason. */
  notLive: Record<string, string>;
  /** Every reason each page that is not live is not live (the preview banner, AC-T15). */
  notLiveReasons: Record<string, string[]>;
  /** Pages (not held, with both files) whose copy no longer matches its snapshot and manifest. */
  staleGrounding: string[];
  /** Snapshots whose `facts` no longer hash to their `factsHash`. */
  staleFacts: string[];
}

function readiness(content: SliceContent, page: SeoSliceManifestPage): NotReadyReason | null {
  if (page.held) return "held";
  if (!content.snapshots[page.slug]) return "no snapshot";
  const copy = content.copies[page.slug];
  if (!copy) return "no copy";
  if (!copy.factCheck) return "not fact checked";
  if (copy.factCheck.checkHash !== checkHashFor(content, page)) return "checkHash stale";
  return null;
}

/** AC-2: ready pages, then liveness through the links between pages. */
export function deriveLiveSet(content: SliceContent): LiveSetResult {
  const result: LiveSetResult = { liveSlugs: [], notLive: {}, notLiveReasons: {}, staleGrounding: [], staleFacts: [] };
  const manifest = content.manifest;
  if (!manifest) return result;

  for (const page of manifest.pages) {
    const snapshot = content.snapshots[page.slug];
    if (snapshot && canonicalHash(snapshot.facts) !== snapshot.factsHash) result.staleFacts.push(page.slug);
    const copy = content.copies[page.slug];
    if (!page.held && snapshot && copy && copy.groundingHash !== groundingHashFor(manifest, page, snapshot)) {
      result.staleGrounding.push(page.slug);
    }
  }

  const reasons = new Map(manifest.pages.map((p) => [p.slug, readiness(content, p)]));
  const hub = manifest.pages.find((p) => p.kind === "hub");
  const hubReason = hub ? reasons.get(hub.slug) : "no hub page";
  const listedNotReady = listedCategoryPages(content).filter((p) => reasons.get(p.slug) !== null);
  const hubLive = hubReason === null && listedNotReady.length === 0;

  for (const page of manifest.pages) {
    const all: string[] = [];
    const own = reasons.get(page.slug);
    if (own) all.push(own);
    if (page.kind === "hub" && listedNotReady.length > 0) {
      all.push(
        `a page it lists is not ready: ${listedNotReady.map((p) => `${p.slug} (${reasons.get(p.slug)})`).join(", ")}`,
      );
    } else if (page.kind !== "hub" && !hubLive) {
      all.push("the hub is not live");
    }
    if (all.length === 0) {
      result.liveSlugs.push(page.slug);
    } else {
      result.notLive[page.slug] = all[0];
      result.notLiveReasons[page.slug] = all;
    }
  }
  return result;
}
