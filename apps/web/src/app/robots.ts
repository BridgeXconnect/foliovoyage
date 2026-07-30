import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { gatePassword } from "@/lib/site-gate";

// Evaluate per-request (not baked at build) so the gated disallow-all below
// reflects the live SITE_GATE_PASSWORD value, matching the runtime middleware.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  // While the pre-launch coming-soon gate is on, keep the whole site out of
  // search indexes (and advertise no sitemap). Removing SITE_GATE_PASSWORD at
  // launch restores the normal crawlable rules below.
  if (gatePassword()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
