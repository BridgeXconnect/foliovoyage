import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // BRI-136: the affiliate redirect hop is first-party analytics, not content.
      // It is noindex per-response too; disallowing keeps crawlers off it entirely.
      disallow: "/go/",
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
