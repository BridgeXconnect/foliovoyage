import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
// The preview needs NODE_ENV=development, where next/image checks hosts against
// next.config.ts `remotePatterns`, which jest never loads. A plain img stands in.
jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, @typescript-eslint/no-explicit-any
  default: ({ src, alt }: any) => <img src={src} alt={alt} />,
}));
import SliceRoute, { dynamicParams, generateMetadata, generateStaticParams } from "@/app/destinations/bangkok/[page]/page";
import { LIVE_SLUGS } from "@/content/seo/bangkok/live.generated";
import { SEO_SLICE_PLACEHOLDER_MARKER } from "@/lib/seo-slice/preview";

/**
 * The route over the real committed files. Outside the preview it serves
 * exactly `LIVE_SLUGS` (empty today). In the preview it renders the hub and
 * the five category pages from the real snapshots with placeholder copy.
 */

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, SEO_SLICE_PREVIEW: env.SEO_SLICE_PREVIEW, VERCEL: env.VERCEL };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

const PREVIEW_SLUGS = ["things-to-do", "floating-markets", "temples", "day-trips", "cooking-classes", "cruises"];

describe("slice route", () => {
  it("prerenders LIVE_SLUGS with closed params (AC-T1)", () => {
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams()).toEqual(LIVE_SLUGS.map((page) => ({ page })));
  });

  it("ignores SEO_SLICE_PREVIEW=1 outside next dev (AC-T15)", () => {
    env.SEO_SLICE_PREVIEW = "1";
    env.NODE_ENV = "production";
    expect(generateStaticParams()).toEqual(LIVE_SLUGS.map((page) => ({ page })));
  });

  it("lists every page with a snapshot that is not held in the preview (AC-T15)", () => {
    env.SEO_SLICE_PREVIEW = "1";
    env.NODE_ENV = "development";
    delete env.VERCEL;
    expect(generateStaticParams().map((p) => p.page)).toEqual(PREVIEW_SLUGS);
  });

  it.each(PREVIEW_SLUGS)("renders %s from the real snapshot with the placeholder banner", async (slug) => {
    env.SEO_SLICE_PREVIEW = "1";
    env.NODE_ENV = "development";
    delete env.VERCEL;
    const params = Promise.resolve({ page: slug });
    const html = renderToStaticMarkup(await SliceRoute({ params }));
    expect(html).toContain("Not approved: local preview only");
    expect(html).toContain("No copy yet");
    expect(html).toContain(SEO_SLICE_PLACEHOLDER_MARKER);
    expect(html).toContain("See on Viator");
    const meta = await generateMetadata({ params });
    expect(meta.title).toEqual({ absolute: expect.stringContaining(SEO_SLICE_PLACEHOLDER_MARKER) });
  });
});
