/**
 * Test fixture: a small valid slice (hub, two categories, stats) whose pages
 * are all ready. Specs mutate a fresh copy, then call `approve` to refresh the
 * hashes the way the approve scripts would.
 */

import type {
  SeoSliceCopy,
  SeoSliceManifest,
  SeoSliceManifestPage,
  SeoSliceSnapshot,
} from "@folio/shared";
import { canonicalHash } from "./hash";
import { checkHashFor, groundingHashFor } from "./live-set";
import type { SliceContent } from "./types";

const bands = { under4h: 1, "4to8h": 1, fullDay: 0, unknown: 0 };

const category = (slug: string, h1: string, tagId: number): SeoSliceManifestPage => ({
  slug,
  kind: "category",
  targetQuery: `${slug.replace(/-/g, " ")} bangkok`,
  h1,
  rule: { tagIds: [tagId], titlePattern: slug.split("-")[0], plainWords: `tours tagged ${h1.toLowerCase()}` },
  ogImageExperienceId: `exp-${slug}`,
});

export function fixtureManifest(): SeoSliceManifest {
  return {
    schemaVersion: 1,
    city: { slug: "bangkok", countrySlug: "thailand", name: "Bangkok", destinationRef: "d343" },
    exclusions: { offCityTitlePattern: "pattaya|ayutthaya", excludeTagIds: [9], maxDurationMin: 720, plainWords: "day trips out of the city" },
    forbiddenNames: ["Somchai"],
    tagNames: { "1": "Food tours", "2": "Floating markets", "9": "Transfers" },
    keywordGroups: { street: { label: "street food", phrases: ["street food"] } },
    defaultKeywordGroupIds: ["street"],
    places: ["Chinatown", "Damnoen Saduak"],
    excludedExperiences: [],
    pages: [
      { slug: "things-to-do", kind: "hub", targetQuery: "things to do in bangkok", h1: "Things to do in Bangkok" },
      category("food-tours", "Food tours", 1),
      category("floating-markets", "Floating markets", 2),
      { slug: "tour-facts", kind: "stats", targetQuery: null, h1: "Bangkok tours by the numbers", ogImageExperienceId: "exp-food-tours" },
    ],
  };
}

function snapshot(slug: string, kind: SeoSliceManifestPage["kind"]): SeoSliceSnapshot {
  const facts =
    kind === "stats"
      ? {
          poolCount: 4,
          durationByCategory: [
            { slug: "food-tours", memberCount: 2, bandCounts: bands, medianDurationMin: 180 },
            { slug: "floating-markets", memberCount: 2, bandCounts: bands, medianDurationMin: 300 },
          ],
          inclusionShares: {},
          topPlaces: [],
        }
      : { memberCount: 2, bandCounts: bands, inclusionShares: {}, topPlaces: [], sections: [], strip: [] };
  const picks =
    kind === "stats"
      ? []
      : [
          {
            experienceId: `exp-${slug}`,
            providerTourId: `P-${slug}`,
            title: `A ${slug} tour`,
            imageUrl: `https://img.test/${slug}.jpg`,
            imageAlt: slug,
            durationBand: "under4h" as const,
            section: null,
            inclusions: [],
          },
        ];
  return {
    schemaVersion: 1,
    slug,
    computedOn: "2026-10-10",
    facts,
    factsHash: canonicalHash(facts),
    eligible: kind === "category" ? { count: 7, sections: [] } : null,
    picks,
    picksHash: canonicalHash(picks),
  };
}

function copy(slug: string, kind: SeoSliceManifestPage["kind"]): SeoSliceCopy {
  return {
    schemaVersion: 1,
    slug,
    ...(kind === "stats" ? {} : { intro: `An intro for ${slug}.` }),
    seoTitle: `${slug} title`,
    metaDescription: `${slug} description`,
    groundingHash: "",
    model: "claude-test",
    promptVersion: "v1",
    attempts: 1,
    generatedAt: "2026-10-10T00:00:00Z",
  };
}

/** Refreshes grounding and fact check hashes so every page with files is ready. */
export function approve(content: SliceContent, slugs?: string[]): SliceContent {
  const manifest = content.manifest!;
  for (const page of manifest.pages) {
    if (slugs && !slugs.includes(page.slug)) continue;
    const c = content.copies[page.slug];
    const s = content.snapshots[page.slug];
    if (!c || !s) continue;
    c.groundingHash = groundingHashFor(manifest, page, s);
    c.factCheck = { by: "Roy", at: "2026-10-11", checkHash: checkHashFor(content, page) };
  }
  return content;
}

export function fixtureContent(): SliceContent {
  const manifest = fixtureManifest();
  const content: SliceContent = { manifest, snapshots: {}, copies: {}, notes: {} };
  for (const p of manifest.pages) {
    content.snapshots[p.slug] = snapshot(p.slug, p.kind);
    content.copies[p.slug] = copy(p.slug, p.kind);
  }
  return approve(content);
}
