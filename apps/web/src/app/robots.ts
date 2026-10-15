import type { MetadataRoute } from "next";
import { SLICE_SITEMAP_PATH, slicePagePaths } from "@/lib/seo-slice-gate";
import { site } from "@/lib/site";
import { gatePassword } from "@/lib/site-gate";

// Evaluate per-request (not baked at build) so the gated disallow-all below
// reflects the live SITE_GATE_PASSWORD value, matching the runtime middleware.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const sliceSitemap = `${site.url}${SLICE_SITEMAP_PATH}`;

  // While the pre-launch coming-soon gate is on, keep the site out of search
  // indexes except the live SEO slice pages (spec 0006 AC-G4). Google applies
  // the most specific rule, so these allows win for those paths only. /_next/
  // is allowed so Google can fetch the scripts, styles and images it renders
  // the pages with. Removing SITE_GATE_PASSWORD at launch restores the normal
  // crawlable rules below.
  if (gatePassword()) {
    return {
      rules: {
        userAgent: "*",
        allow: [...slicePagePaths(), SLICE_SITEMAP_PATH, "/_next/"],
        disallow: "/",
      },
      sitemap: sliceSitemap,
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // BRI-136: the affiliate redirect hop is first-party analytics, not content.
      // It is noindex per-response too; disallowing keeps crawlers off it entirely.
      // Spec 0005: protected content (the tour rating) and its script load from
      // /protected/, and the canvas feed carries ratings too, so both stay out of
      // crawlers. /tours/ itself is not disallowed: its noindex tag must stay readable.
      disallow: ["/go/", "/protected/", "/api/canvas/"],
    },
    sitemap: [`${site.url}/sitemap.xml`, sliceSitemap],
    host: site.url,
  };
}
