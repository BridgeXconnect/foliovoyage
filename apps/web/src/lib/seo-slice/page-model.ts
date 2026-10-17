/**
 * Everything a slice page renders, worked out from the committed files (spec
 * 0006 page template). Pure: the route passes in the manifest, the generated
 * pages and the live set, so specs can pass fixtures instead. No fetch.
 *
 * Outside the local preview only live pages get a model. In the preview
 * (AC-T15) every page that is not held and has a snapshot gets one, with
 * placeholder copy when it has no copy file yet.
 */

import type {
  SeoSliceCategoryFacts,
  SeoSliceHubFacts,
  SeoSliceManifest,
  SeoSliceManifestPage,
  SeoSlicePick,
  SeoSliceSnapshot,
} from "@folio/shared";
import { canonicalHash } from "./hash";
import { checkHashFor, deriveLiveSet, groundingHashFor, ogImageUrlFor } from "./live-set";
import { SEO_SLICE_PLACEHOLDER_MARKER } from "./preview";
import {
  BAND_LABEL,
  COUNTS_CAPTION,
  formatBangkokDate,
  formatCalendarDate,
  hostOf,
  howMadeNote,
  hubFact,
  ruleLine,
  stripLine,
} from "./templates";
import type { SeoSliceGeneratedPages, SliceContent } from "./types";

export const SLICE_PATH_PREFIX = "/destinations/bangkok/";

export interface SliceSource {
  manifest: SeoSliceManifest;
  pages: SeoSliceGeneratedPages;
  liveSlugs: readonly string[];
  preview: boolean;
  /** `SEO_SLICE_SITE_LINKS=1` at build (AC-T8). */
  siteLinks: boolean;
  siteUrl: string;
}

export interface SliceCard {
  experienceId: string;
  title: string;
  imageUrl: string;
  imageAlt: string;
  bandLabel: string;
  inclusions: string[];
}

export interface SliceCrumb {
  name: string;
  /** Null on the last crumb, the page itself. */
  href: string | null;
}

export interface SlicePageModel {
  slug: string;
  kind: "hub" | "category";
  h1: string;
  canonical: string;
  seoTitle: string;
  metaDescription: string;
  ogImageUrl: string | null;
  intro: string | null;
  ruleLine: string;
  checkedLine: string;
  strip: string[];
  /** Category page: one entry per section, or a single entry with a null label for one list. */
  sections: { label: string | null; cards: SliceCard[] }[];
  /** Hub: one entry per category page it lists. */
  hubPages: { slug: string; h1: string; href: string; fact: string; cards: SliceCard[] }[];
  countsCaption: string;
  notes: { id: string; text: string; signed: string }[];
  goodToKnow: { fact: string; url: string; host: string; checked: string }[];
  howMade: string;
  computedOn: string;
  breadcrumbs: SliceCrumb[];
  /** Pick names in render order, for the `ItemList` (AC-T7). */
  itemNames: string[];
  /** Set only in the local preview (AC-T15). */
  preview: { reasons: string[]; noCopy: boolean } | null;
}

/** The slugs the route prerenders (AC-T1, AC-T15). */
export function sliceSlugs(source: Pick<SliceSource, "manifest" | "pages" | "liveSlugs" | "preview">): string[] {
  if (!source.preview) return [...source.liveSlugs];
  return source.manifest.pages
    .filter((p) => !p.held && source.pages[p.slug]?.snapshot)
    .map((p) => p.slug);
}

/** The generated pages read back as `SliceContent`, for the live set helpers. */
export function contentFrom(manifest: SeoSliceManifest, pages: SeoSliceGeneratedPages): SliceContent {
  const content: SliceContent = { manifest, snapshots: {}, copies: {}, notes: {} };
  for (const [slug, page] of Object.entries(pages)) {
    if (page.snapshot) content.snapshots[slug] = { ...page.snapshot, eligible: null } as SeoSliceSnapshot;
    if (page.copy) content.copies[slug] = page.copy;
    if (page.notes) content.notes[slug] = page.notes;
  }
  return content;
}

/** The build time hash checks (index.md, Hashes): a stale file fails the build, and the preview too. */
export function assertFresh(manifest: SeoSliceManifest, page: SeoSliceManifestPage, content: SliceContent): void {
  const snapshot = content.snapshots[page.slug];
  if (canonicalHash(snapshot.facts) !== snapshot.factsHash) {
    throw new Error(`SEO slice: ${page.slug}.snapshot.json factsHash is stale. Regenerate the snapshot, then run seo:index.`);
  }
  const copy = content.copies[page.slug];
  if (copy && copy.groundingHash !== groundingHashFor(manifest, page, snapshot)) {
    throw new Error(`SEO slice: ${page.slug}.copy.json groundingHash is stale. Rerun hub-copy:run for it, then seo:index.`);
  }
}

function card(pick: SeoSlicePick): SliceCard {
  return {
    experienceId: pick.experienceId,
    title: pick.title,
    imageUrl: pick.imageUrl,
    imageAlt: pick.imageAlt,
    bandLabel: BAND_LABEL[pick.durationBand],
    inclusions: pick.inclusions.slice(0, 3),
  };
}

const pathOf = (slug: string) => `${SLICE_PATH_PREFIX}${slug}`;

/** Null when the slug is not a page the route serves in this mode. */
export function buildPageModel(source: SliceSource, slug: string): SlicePageModel | null {
  if (!sliceSlugs(source).includes(slug)) return null;
  const { manifest } = source;
  const page = manifest.pages.find((p) => p.slug === slug);
  if (!page) return null;
  if (page.kind === "stats") {
    throw new Error("SEO slice: the stats page template is scope row 25 and is not built yet.");
  }

  const content = contentFrom(manifest, source.pages);
  assertFresh(manifest, page, content);
  const snapshot = content.snapshots[slug];
  const copy = content.copies[slug] ?? null;
  const notes = content.notes[slug]?.notes ?? [];
  const hub = manifest.pages.find((p) => p.kind === "hub")!;

  // Copy, or the marked placeholders a preview page without copy shows (AC-T15).
  const placeholder = !copy;
  if (placeholder && !source.preview) throw new Error(`SEO slice: ${slug} is live but has no copy file.`);
  const seoTitle = copy?.seoTitle ?? `${SEO_SLICE_PLACEHOLDER_MARKER} ${page.h1}`;
  const metaDescription = copy?.metaDescription ?? `${SEO_SLICE_PLACEHOLDER_MARKER} Meta description for ${page.h1}.`;
  const intro = copy ? (copy.intro ?? null) : `${SEO_SLICE_PLACEHOLDER_MARKER} Intro for ${page.h1}.`;

  const factChecked = Boolean(copy?.factCheck && copy.factCheck.checkHash === checkHashFor(content, page));
  const checkedLine =
    factChecked && copy?.factCheck
      ? `Checked by the Folio team on ${formatBangkokDate(copy.factCheck.at)}`
      : "Not checked yet";

  const sections: SlicePageModel["sections"] = [];
  const hubPages: SlicePageModel["hubPages"] = [];
  let itemNames: string[];

  if (page.kind === "hub") {
    const facts = snapshot.facts as SeoSliceHubFacts;
    for (const listed of facts.pages) {
      const target = manifest.pages.find((p) => p.slug === listed.slug);
      const picks = snapshot.picks.filter((p) => p.fromSlug === listed.slug);
      hubPages.push({
        slug: listed.slug,
        h1: target?.h1 ?? listed.slug,
        href: pathOf(listed.slug),
        fact: hubFact(listed.memberCount, listed.mainLength),
        cards: picks.map(card),
      });
    }
    itemNames = hubPages.flatMap((h) => h.cards.map((c) => c.title));
  } else {
    const facts = snapshot.facts as SeoSliceCategoryFacts;
    if (facts.sections.length === 0) {
      if (snapshot.picks.length > 0) sections.push({ label: null, cards: snapshot.picks.map(card) });
    } else {
      for (const section of facts.sections) {
        const picks = snapshot.picks.filter((p) => p.section === section.id);
        if (picks.length > 0) sections.push({ label: section.label, cards: picks.map(card) });
      }
    }
    itemNames = sections.flatMap((s) => s.cards.map((c) => c.title));
  }

  const sectionLabels =
    page.kind === "category" ? (snapshot.facts as SeoSliceCategoryFacts).sections.map((s) => s.label) : [];

  const breadcrumbs: SliceCrumb[] = [
    ...(source.siteLinks
      ? [
          { name: "Home", href: "/" },
          { name: manifest.city.name, href: `/destinations/${manifest.city.slug}` },
        ]
      : []),
    ...(page.kind === "hub" ? [] : [{ name: hub.h1, href: pathOf(hub.slug) }]),
    { name: page.h1, href: null },
  ];

  const notLive = source.preview ? deriveLiveSet(content).notLive : {};

  return {
    slug,
    kind: page.kind,
    h1: page.h1,
    canonical: `${source.siteUrl}${pathOf(slug)}`,
    seoTitle,
    metaDescription,
    ogImageUrl: ogImageUrlFor(content, page),
    intro,
    ruleLine: ruleLine(manifest, page),
    checkedLine,
    strip: (snapshot.facts as SeoSliceCategoryFacts | SeoSliceHubFacts).strip.map(stripLine),
    sections,
    hubPages,
    countsCaption: COUNTS_CAPTION,
    notes: notes.map((n) => ({ id: n.id, text: n.text, signed: `Folio team, ${formatCalendarDate(n.written)}` })),
    goodToKnow: (page.sourceFacts ?? []).map((f) => ({
      fact: f.fact,
      url: f.url,
      host: hostOf(f.url),
      checked: `checked ${formatCalendarDate(f.checked)}`,
    })),
    howMade: howMadeNote(manifest, page, sectionLabels),
    computedOn: `Computed on ${formatCalendarDate(snapshot.computedOn)}`,
    breadcrumbs,
    itemNames,
    preview: source.preview ? { reasons: notLive[slug] ? [notLive[slug]] : [], noCopy: placeholder } : null,
  };
}

/** The two JSON-LD objects (AC-T7): names and positions only, no url on a list item, no author. */
export function jsonLdFor(model: SlicePageModel, siteUrl: string): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: model.breadcrumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        ...(c.href ? { item: `${siteUrl}${c.href}` } : {}),
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: model.h1,
      itemListElement: model.itemNames.map((name, i) => ({ "@type": "ListItem", position: i + 1, name })),
    },
  ];
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so text cannot close the tag. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
