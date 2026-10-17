import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { SlicePage } from "@/components/seo-slice/SlicePage";
import { scanPage, type LeakScanContext } from "@/lib/seo-slice/leak-scan";
import { canonicalHash } from "@/lib/seo-slice/hash";
import { deriveLiveSet } from "@/lib/seo-slice/live-set";
import {
  buildPageModel,
  jsonLdFor,
  serializeJsonLd,
  sliceSlugs,
  type SliceSource,
} from "@/lib/seo-slice/page-model";
import {
  NOTE_TEXT,
  SENTINEL_ELIGIBLE,
  SENTINEL_MEMBERS,
  SOURCE_URL,
  pageFixtureContent,
  sourceFrom,
} from "@/lib/seo-slice/page-fixture";
import { SEO_SLICE_PLACEHOLDER_MARKER } from "@/lib/seo-slice/preview";
import { SLICE_DISCLOSURE } from "@/lib/seo-slice/templates";

function render(source: SliceSource, slug: string) {
  const model = buildPageModel(source, slug);
  if (!model) throw new Error(`no model for ${slug}`);
  const ld = jsonLdFor(model, source.siteUrl);
  const html =
    ld.map((o) => `<script type="application/ld+json">${serializeJsonLd(o)}</script>`).join("") +
    renderToStaticMarkup(<SlicePage model={model} />);
  return { model, ld, html };
}

const ctxFor = (source: SliceSource): LeakScanContext => ({
  forbiddenNames: source.manifest.forbiddenNames,
  factCheckBy: ["Roy"],
  liveSlugs: source.liveSlugs,
  siteLinks: source.siteLinks,
  sourceUrls: [SOURCE_URL],
});

/** Indexes of each needle in order; fails if one is missing. */
function positions(html: string, needles: string[]): number[] {
  return needles.map((n) => {
    const i = html.indexOf(n);
    if (i < 0) throw new Error(`missing "${n}"`);
    return i;
  });
}

describe("slice page model and template", () => {
  it("prerenders exactly the live set outside the preview (AC-T1)", () => {
    const source = sourceFrom(pageFixtureContent());
    expect(source.liveSlugs).toEqual(["things-to-do", "food-tours", "floating-markets"]);
    expect(sliceSlugs(source)).toEqual(source.liveSlugs);
    expect(buildPageModel(source, "tour-facts")).toBeNull();
    expect(buildPageModel(source, "nope")).toBeNull();
  });

  it("renders a category page's blocks in the AC-T3 order", () => {
    const { html } = render(sourceFrom(pageFixtureContent()), "food-tours");
    const order = positions(html, [
      "<h1",
      "Tours from Viator&#x27;s Bangkok catalogue tagged Food tours",
      "Checked by the Folio team on 11 October 2026",
      "An intro for food-tours.",
      "250 of 431 include street food",
      "None of the 400 with a listed length take a full day",
      "Counts cover every tour",
      "How to choose",
      "Night food tours</h3>",
      "Other food tours</h3>",
      "Local notes",
      "Good to know",
      "How this page was made",
      "Computed on 10 October 2026",
      SLICE_DISCLOSURE.replace(/'/g, "&#x27;"),
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("omits empty blocks and section headings on a one list page (AC-T3, AC-T13, AC-T14)", () => {
    const { html } = render(sourceFrom(pageFixtureContent()), "floating-markets");
    expect(html).toContain("How to choose");
    expect(html).not.toContain("<h3 class=\"font-display text-[20px]");
    expect(html).not.toContain("Local notes");
    expect(html).not.toContain("Good to know");
    expect(html).not.toContain("Counts cover");
    expect(html).not.toContain("At a glance");
  });

  it("renders the hub as a category index (AC-T3)", () => {
    const { model, html } = render(sourceFrom(pageFixtureContent()), "things-to-do");
    expect(model.hubPages.map((p) => [p.slug, p.cards.length])).toEqual([
      ["food-tours", 2],
      ["floating-markets", 2],
    ]);
    expect(html).toContain('<a href="/destinations/bangkok/food-tours"');
    expect(html).toContain("431 tours match its rule, most of them under 4 hours");
    expect(html).toContain("2 tours match its rule<");
    expect(html).not.toContain("How to choose");
    expect(html).not.toContain("Local notes");
    expect(html.split("Counts cover every tour").length - 1).toBe(2); // under the strip and under the sections
    expect(html).toContain("This page takes two tours from each of the Bangkok topic pages linked above");
  });

  it("prints ungated counts only: 431 shows, 217 never does (AC-T13, index.md AC-9)", () => {
    const source = sourceFrom(pageFixtureContent());
    for (const slug of ["food-tours", "things-to-do"]) {
      const { html } = render(source, slug);
      expect(html).toContain(String(SENTINEL_MEMBERS));
      expect(html).not.toContain(String(SENTINEL_ELIGIBLE));
    }
  });

  it("shows a note escaped and otherwise verbatim, signed by the team (AC-T14)", () => {
    const { html } = render(sourceFrom(pageFixtureContent()), "food-tours");
    expect(NOTE_TEXT).toContain("<dusk>");
    expect(html).toContain("Go after &lt;dusk&gt; &amp; bring small notes for the stalls.");
    expect(html).toContain("Folio team, 9 October 2026");
  });

  it("links each Good to know source by host (AC-T14)", () => {
    const { html } = render(sourceFrom(pageFixtureContent()), "food-tours");
    expect(html).toContain(
      `<a href="${SOURCE_URL}" rel="noopener noreferrer" target="_blank" class="text-accent hover:text-accent-ink">www.tourismthailand.org</a>`,
    );
    expect(html).toContain("checked 12 October 2026");
  });

  it("builds each card with its one link and no more than three inclusions (AC-C1, AC-C2)", () => {
    const { html } = render(sourceFrom(pageFixtureContent()), "food-tours");
    expect(html).toContain(
      '<a href="/go/tours/exp-food-tours-1?p=food-tours" target="_blank" rel="sponsored nofollow" class="inline-flex',
    );
    expect(html).toContain(">See on Viator</a>");
    expect(html).toContain("Tuk tuk ride");
    expect(html).not.toContain("Bottled water");
    expect(html).toContain("Under 4 hours");
    expect(html).toContain("Duration not listed");
    expect(html).toMatch(/<img[^>]+alt="Photo of food tours"/);
    expect(html).not.toMatch(/href="\/tours\//);
    expect(html).not.toMatch(/\/experiences\//);
  });

  it("uses the ogImageExperienceId pick for the Open Graph image (AC-T5)", () => {
    const source = sourceFrom(pageFixtureContent());
    expect(buildPageModel(source, "food-tours")!.ogImageUrl).toBe("https://media-cdn.tripadvisor.com/media/food-tours-2.jpg");
    expect(buildPageModel(source, "food-tours")!.canonical).toBe("https://foliovoyage.test/destinations/bangkok/food-tours");
  });

  it("matches breadcrumbs to the BreadcrumbList, with and without site links (AC-T8)", () => {
    for (const siteLinks of [false, true]) {
      const source = sourceFrom(pageFixtureContent(), { siteLinks });
      const lead = siteLinks ? ["Home", "Bangkok"] : [];
      const cat = render(source, "food-tours");
      expect(cat.model.breadcrumbs.map((c) => c.name)).toEqual([...lead, "Things to do in Bangkok", "Food tours"]);
      const hub = render(source, "things-to-do");
      expect(hub.model.breadcrumbs.map((c) => c.name)).toEqual([...lead, "Things to do in Bangkok"]);
      for (const r of [cat, hub]) {
        const list = r.ld[0] as { itemListElement: { name: string }[] };
        expect(list.itemListElement.map((i) => i.name)).toEqual(r.model.breadcrumbs.map((c) => c.name));
      }
    }
  });

  it("puts names and positions only in the ItemList, with no author or Person (AC-T7)", () => {
    const { model, ld } = render(sourceFrom(pageFixtureContent()), "things-to-do");
    const list = ld[1] as { "@type": string; itemListElement: Record<string, unknown>[] };
    expect(list["@type"]).toBe("ItemList");
    expect(list.itemListElement.map((i) => i.name)).toEqual(model.hubPages.flatMap((p) => p.cards.map((c) => c.title)));
    for (const item of list.itemListElement) expect(Object.keys(item).sort()).toEqual(["@type", "name", "position"]);
    const all = JSON.stringify(ld);
    for (const word of ["author", "Person", "offers", "aggregateRating", "review", '"url"']) expect(all).not.toContain(word);
  });

  it("passes the leak scan and link audit on every live fixture page (AC-T6, AC-T9)", () => {
    for (const siteLinks of [false, true]) {
      const source = sourceFrom(pageFixtureContent(), { siteLinks });
      for (const slug of source.liveSlugs) {
        expect(scanPage(render(source, slug).html, ctxFor(source))).toEqual([]);
      }
    }
  });

  it("fails the build on a stale factsHash", () => {
    const content = pageFixtureContent();
    content.snapshots["food-tours"].factsHash = canonicalHash({ other: true });
    expect(() => buildPageModel(sourceFrom(content), "food-tours")).toThrow(/factsHash is stale/);
  });
});

describe("local preview (AC-T15)", () => {
  function noCopy() {
    const content = pageFixtureContent();
    delete content.copies["floating-markets"];
    return content;
  }

  it("lists a page with a snapshot and no copy only in the preview, and never counts it as ready", () => {
    const content = noCopy();
    const live = deriveLiveSet(content);
    expect(live.liveSlugs).toEqual([]);
    expect(live.notLive["floating-markets"]).toBe("no copy");
    expect(live.notLive["things-to-do"]).toMatch(/floating-markets \(no copy\)/);

    const off = sourceFrom(content);
    expect(sliceSlugs(off)).toEqual([]);
    expect(buildPageModel(off, "floating-markets")).toBeNull();

    const on = sourceFrom(content, { preview: true });
    expect(sliceSlugs(on)).toEqual(["things-to-do", "food-tours", "floating-markets"]);
  });

  it("renders the marked placeholders and the No copy yet banner", () => {
    const { model, html } = render(sourceFrom(noCopy(), { preview: true }), "floating-markets");
    expect(model.seoTitle.startsWith(SEO_SLICE_PLACEHOLDER_MARKER)).toBe(true);
    expect(model.metaDescription.startsWith(SEO_SLICE_PLACEHOLDER_MARKER)).toBe(true);
    expect(model.intro!.startsWith(SEO_SLICE_PLACEHOLDER_MARKER)).toBe(true);
    expect(html).toContain("Not approved: local preview only");
    expect(html).toContain("No copy yet");
    expect(html).toContain("Not live: no copy");
    expect(html).toContain("Not checked yet");
    expect(html).toContain(`${SEO_SLICE_PLACEHOLDER_MARKER} Intro for Floating markets.`);
  });

  it("shows the banner and Not checked yet on a page with copy but no fact check", () => {
    const content = pageFixtureContent();
    delete content.copies["food-tours"].factCheck;
    const { html } = render(sourceFrom(content, { preview: true }), "food-tours");
    expect(html).toContain("Not approved: local preview only");
    expect(html).toContain("Not live: not fact checked");
    expect(html).toContain("Not live: the hub is not live");
    expect(html).toContain("Not checked yet");
    expect(html).not.toContain("No copy yet");
    expect(html).toContain("An intro for food-tours.");
  });

  it("fails the leak scan on every preview text", () => {
    const source = sourceFrom(noCopy(), { preview: true });
    const problems = scanPage(render(source, "floating-markets").html, { ...ctxFor(source), liveSlugs: ["things-to-do", "food-tours", "floating-markets"] });
    expect(problems).toEqual(
      expect.arrayContaining([
        'text: preview text "Not approved"',
        'text: preview text "No copy yet"',
        `text: preview text "${SEO_SLICE_PLACEHOLDER_MARKER}"`,
      ]),
    );
  });
});
