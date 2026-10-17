import { describe, expect, it } from "@jest/globals";
import { extractSurfaces, findLinkProblems, scanBuild, scanPage, type LeakScanContext } from "./leak-scan";

const ctx: LeakScanContext = {
  forbiddenNames: ["Somchai", "Roy Mkhabela"],
  factCheckBy: ["Roy"],
  liveSlugs: ["things-to-do", "food-tours"],
  siteLinks: false,
  sourceUrls: ["https://www.tourismthailand.org/x"],
};

const page = ({ head = "", body = "", scripts = "" } = {}) =>
  `<!DOCTYPE html><html><head><title>Food tours</title>${head}</head><body>${body}${scripts}</body></html>`;

describe("leak scan (AC-T6)", () => {
  it("reads visible text, shown attributes and JSON-LD, and skips other scripts", () => {
    const s = extractSurfaces(
      page({
        head: '<meta name="description" content="A &amp; B"/><style>.a{content:"$12"}</style>',
        body: '<img alt="Boat" src="x.jpg"/><a href="/go/tours/x" aria-label="Go" title="T">See</a>',
        scripts: '<script>self.__next_f.push("$1a")</script><script type="application/ld+json">{"name":"N"}</script>',
      }),
    );
    expect(s.text).toBe("Food tours See");
    expect(s.attributes).toEqual(["A & B", "Boat", "Go", "T"]);
    expect(s.jsonLd).toEqual(['{"name":"N"}']);
    expect(s.hrefs).toEqual(["/go/tours/x"]);
  });

  it("passes framework data like $1a in a script", () => {
    expect(scanPage(page({ body: "<p>Fine</p>", scripts: '<script>self.__next_f.push([1,"$1a"])</script>' }), ctx)).toEqual([]);
  });

  it.each([
    ["a price in visible text", "<p>Only $12 today</p>", 'leak term "currency next to a digit"'],
    ["a fee amount in a note", "<p>The entry fee 200 THB is paid at the gate</p>", 'leak term "currency next to a digit"'],
    ["Atlas", "<p>Made with Atlas</p>", 'name "Atlas"'],
    ["the factCheck.by value", "<p>Checked by Roy</p>", 'name "Roy"'],
    ["a forbiddenNames entry", "<p>Ask Somchai at the pier</p>", 'name "Somchai"'],
    ["a team phrase", "<p>Picked by our editors</p>", 'team term "our editors"'],
    ["a rating word", "<p>Highly rated</p>", 'leak term "rated"'],
    ["the preview banner", "<p>Not approved: local preview only</p>", 'preview text "Not approved"'],
    ["No copy yet", "<p>No copy yet</p>", 'preview text "No copy yet"'],
    ["the placeholder marker", "<p>[placeholder until hub-copy:run] Intro</p>", 'preview text "[placeholder until hub-copy:run]"'],
  ])("fails on %s in visible text", (_name, body, problem) => {
    expect(scanPage(page({ body }), ctx)).toContain(`text: ${problem}`);
  });

  it("fails on the marker in the title and in the meta description", () => {
    const html = `<html><head><title>[placeholder until hub-copy:run] X</title><meta name="description" content="[placeholder until hub-copy:run] D"/></head><body></body></html>`;
    const problems = scanPage(html, ctx);
    expect(problems).toContain('text: preview text "[placeholder until hub-copy:run]"');
    expect(problems.some((p) => p.startsWith("attribute ") && p.includes("[placeholder until hub-copy:run]"))).toBe(true);
  });

  it.each([
    ['<meta name="description" content="A highly rated tour"/>', 'leak term "rated"'],
    ['<meta property="og:title" content="Atlas picks"/>', 'name "Atlas"'],
    ['<img alt="Somchai steering the boat" src="x"/>', 'name "Somchai"'],
    ['<span aria-label="Roy Mkhabela">x</span>', 'name "Roy Mkhabela"'],
    ['<span title="Rated 4.8">x</span>', 'leak term "rated"'],
  ])("fails on a term in an attribute: %s", (tag, problem) => {
    const problems = scanPage(page({ head: tag.startsWith("<meta") ? tag : "", body: tag.startsWith("<meta") ? "" : tag }), ctx);
    expect(problems.some((p) => p.startsWith("attribute ") && p.endsWith(problem))).toBe(true);
  });

  it("fails on a term in JSON-LD", () => {
    const problems = scanPage(page({ scripts: '<script type="application/ld+json">{"aggregateRating":{"ratingValue":5}}</script>' }), ctx);
    expect(problems).toContain('JSON-LD: leak term "rating"');
  });

  it("matches names as whole words only", () => {
    expect(scanPage(page({ body: "<p>Royal barges and Atlases</p>" }), ctx)).toEqual([]);
  });

  it("fails when the built pages are not exactly LIVE_SLUGS", () => {
    const clean = page({ body: "<p>Fine</p>" });
    expect(scanBuild({ "things-to-do": clean, "food-tours": clean }, ctx)).toEqual([]);
    expect(scanBuild({ "things-to-do": clean }, ctx)).toEqual(["live pages not prerendered: food-tours"]);
    expect(scanBuild({ "things-to-do": clean, "food-tours": clean, temples: clean }, ctx)).toEqual([
      "prerendered pages not in LIVE_SLUGS: temples",
    ]);
    expect(scanBuild({}, { ...ctx, liveSlugs: [] })).toEqual([]);
  });
});

describe("link audit (AC-T9)", () => {
  it("allows only live slice paths, click outs and Good to know sources with site links off", () => {
    expect(
      findLinkProblems(["/destinations/bangkok/food-tours", "/go/tours/abc?p=food-tours", "https://www.tourismthailand.org/x"], ctx),
    ).toEqual([]);
    expect(findLinkProblems(["/", "/destinations/bangkok", "/legal/disclosure", "/destinations/bangkok/temples"], ctx)).toEqual([
      'internal link "/" is not a live slice path',
      'internal link "/destinations/bangkok" is not a live slice path',
      'internal link "/legal/disclosure" is not a live slice path',
      'internal link "/destinations/bangkok/temples" is not a live slice path',
    ]);
    expect(findLinkProblems(["https://www.viator.com/tours/x"], ctx)).toEqual([
      'external link "https://www.viator.com/tours/x" is not a Good to know source',
    ]);
  });

  it("also allows Home and Bangkok with SEO_SLICE_SITE_LINKS=1", () => {
    const on = { ...ctx, siteLinks: true };
    expect(findLinkProblems(["/", "/destinations/bangkok"], on)).toEqual([]);
    expect(findLinkProblems(["/legal/disclosure"], on)).toEqual(['internal link "/legal/disclosure" is not a live slice path']);
  });
});
