import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import TourPage, { dynamicParams, generateMetadata, revalidate } from "@/app/tours/[experienceId]/page";

const ID = "cmtodmrst0hdlqu18h454evr4";
const AFFILIATE = "https://www.viator.com/tours/Bangkok/Canal/d343-1P5?pid=P1&mcid=42383&medium=api";
const body = (over: Record<string, unknown> = {}) => ({
  experienceId: ID,
  tourId: "cmtnix0of008amw4c1czq706b",
  title: "Bangkok Canal Tour: 2-Hour Longtail Boat Ride",
  image: { url: "https://media-cdn.tripadvisor.com/x/caption.jpg", width: 720, height: 480, alt: "A longtail boat" },
  durationMin: 150,
  price: { amountMinor: 115000, currency: "THB" },
  cancellationDescription: "For a full refund, cancel 24 hours before.\nNo refund after that.",
  summary: { kind: "provider", text: "First paragraph.\n\nSecond <b>paragraph</b> & more." },
  affiliateUrl: AFFILIATE,
  city: { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" },
  // The api never sends a rating on this endpoint; if one ever leaked it must not render.
  ratingAvg: 4.7,
  ratingCount: 6756,
  ...over,
});
const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const fetchMock = jest.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

/** A fresh Response per call: a body can be read once, and the page and metadata both fetch. */
const answer = (data: unknown, status = 200) => fetchMock.mockImplementation(async () => respond(data, status));
afterEach(() => {
  jest.restoreAllMocks();
});

async function render(over: Record<string, unknown> = {}) {
  answer(body(over));
  const element = await TourPage({ params: Promise.resolve({ experienceId: ID }) });
  return { html: renderToStaticMarkup(element), tree: JSON.stringify(element) };
}

describe("tour page", () => {
  it("is ISR with a 900 s revalidate and open params", () => {
    expect(revalidate).toBe(900);
    expect(dynamicParams).toBe(true);
  });

  it("renders the fields and one booking button", async () => {
    const { html } = await render();
    expect(html).toContain("Bangkok Canal Tour: 2-Hour Longtail Boat Ride");
    expect(html).toMatch(/<img[^>]+src="https:\/\/media-cdn\.tripadvisor\.com\/x\/caption\.jpg"[^>]+alt="A longtail boat"/);
    expect(html).toContain("aspect-ratio:720 / 480");
    expect(html).toMatch(/From THB\s1,150/); // as returned, never converted
    expect(html).toContain("Final price shown by Viator at booking.");
    expect(html).toContain("2 h 30 min");
    expect(html).toContain("For a full refund, cancel 24 hours before.\nNo refund after that.");
    expect(html).toContain("<p");
    expect(html).toContain("First paragraph.");
    expect(html).toContain("Second &lt;b&gt;paragraph&lt;/b&gt; &amp; more."); // text, not markup
    expect(html).toContain('href="/legal/disclosure"');

    const button = html.match(/<a [^>]*href="\/go\/tours\/[^"]*"[^>]*>[^<]*<\/a>/g) ?? [];
    expect(button).toHaveLength(1);
    expect(button[0]).toContain(`href="/go/tours/${ID}"`);
    expect(button[0]).toContain('target="_blank"');
    expect(button[0]).toContain('rel="sponsored nofollow noopener"');
    expect(button[0]).toContain(">Book on Viator<");
    expect(html).not.toContain("next/image");
    expect(html).not.toContain("/_next/image");
  });

  it("hides only the missing element, and the button always shows", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ price: null }, "Final price shown by Viator"],
      [{ image: null }, "<img"],
      [{ durationMin: null }, "Duration"],
      [{ cancellationDescription: null }, "Cancellation"],
      [{ summary: null }, "First paragraph."],
    ];
    for (const [over, gone] of cases) {
      const { html } = await render(over);
      expect(html).not.toContain(gone);
      expect(html).toContain(`/go/tours/${ID}`);
    }
    const bare = await render({ price: null, image: null, durationMin: null, cancellationDescription: null, summary: null });
    expect(bare.html).toContain(`/go/tours/${ID}`);
    expect(bare.html).toContain("Affiliate disclosure");
  });

  it("drops the aspect ratio box when a dimension is unknown", async () => {
    const { html } = await render({ image: { url: "https://x/y.jpg", width: null, height: null, alt: "alt" } });
    expect(html).toContain("<img");
    expect(html).not.toContain("aspect-ratio");
  });

  it.each([
    ["null", null],
    ["a non Viator host", "https://evilviator.com/x"],
  ])("labels the button 'Search on Viator' for %s", async (_n, affiliateUrl) => {
    const { html } = await render({ affiliateUrl });
    expect(html).toContain(">Search on Viator<");
    expect(html).not.toContain("Book on Viator");
  });

  it("never lets the affiliate URL or a rating reach the HTML or the element tree", async () => {
    const { html, tree } = await render();
    // Only the empty placeholder, keyed by the experience id, is in the server output.
    expect(html).toMatch(new RegExp(`<div data-tour-rating="${ID}"[^>]*></div>`));
    expect(html).not.toContain("6,756");
    for (const out of [html, tree]) {
      expect(out).not.toContain("viator.com/tours");
      expect(out).not.toContain("pid=P1");
      expect(out).not.toContain("mcid=");
      expect(out).not.toContain("affiliateUrl");
      expect(out).not.toContain("6756");
      expect(out).not.toContain("6,756");
      expect(out).not.toContain("4.7");
      expect(out).not.toContain("ratingAvg");
    }
  });

  it("reads no request data: only params, never searchParams", async () => {
    answer(body());
    const props = {
      params: Promise.resolve({ experienceId: ID }),
      get searchParams(): never {
        throw new Error("searchParams was read");
      },
    };
    await expect(TourPage(props)).resolves.toBeTruthy();
    await expect(generateMetadata(props)).resolves.toBeTruthy();
  });

  it("404s on an api 404 and on a malformed id (with no fetch)", async () => {
    answer({ status: 404 }, 404);
    await expect(TourPage({ params: Promise.resolve({ experienceId: ID }) })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });

    fetchMock.mockReset();
    await expect(TourPage({ params: Promise.resolve({ experienceId: "../etc" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws, not 404, on an api 500 or a network error", async () => {
    answer({}, 500);
    const err = await TourPage({ params: Promise.resolve({ experienceId: ID }) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.digest ?? "")).not.toContain("404");

    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(TourPage({ params: Promise.resolve({ experienceId: ID }) })).rejects.toThrow("network down");
  });
});

describe("tour page metadata", () => {
  it("uses the title, the first 155 characters of the summary, noindex and no Open Graph", async () => {
    const long = "a".repeat(300);
    answer(body({ summary: { kind: "provider", text: long } }));
    const meta = await generateMetadata({ params: Promise.resolve({ experienceId: ID }) });
    expect(meta.title).toEqual({ absolute: "Bangkok Canal Tour: 2-Hour Longtail Boat Ride · Atlas" });
    expect(meta.description).toBe("a".repeat(155));
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta).not.toHaveProperty("openGraph");
  });

  it("omits the description without a summary", async () => {
    answer(body({ summary: null }));
    const meta = await generateMetadata({ params: Promise.resolve({ experienceId: ID }) });
    expect(meta).not.toHaveProperty("description");
  });

  it("throws on an api 500", async () => {
    answer({}, 500);
    await expect(generateMetadata({ params: Promise.resolve({ experienceId: ID }) })).rejects.toThrow();
  });
});
