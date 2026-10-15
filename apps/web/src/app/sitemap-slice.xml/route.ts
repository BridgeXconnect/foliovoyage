import { renderSliceSitemap, sliceSitemapEntries } from "@/lib/seo-slice-sitemap";

// The live set only changes with a deploy (it is a generated file), so the
// sitemap is built once at build time. Same output gate on or off (AC-G5).
export const dynamic = "force-static";

export function GET() {
  return new Response(renderSliceSitemap(sliceSitemapEntries()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
