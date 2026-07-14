import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { getAllDestinations } from "@/data/destinations-helpers";
import { posts } from "@/data/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${site.url}/`, changeFrequency: "weekly", priority: 1, lastModified: now },
    {
      url: `${site.url}/destinations`,
      changeFrequency: "weekly",
      priority: 0.9,
      lastModified: now,
    },
    { url: `${site.url}/blog`, changeFrequency: "weekly", priority: 0.7, lastModified: now },
    { url: `${site.url}/legal/disclosure`, priority: 0.3, lastModified: now },
    { url: `${site.url}/legal/privacy`, priority: 0.2, lastModified: now },
    { url: `${site.url}/legal/terms`, priority: 0.2, lastModified: now },
    { url: `${site.url}/legal/contact`, priority: 0.3, lastModified: now },
  ];

  const destinationRoutes: MetadataRoute.Sitemap = getAllDestinations().map(
    (d) => ({
      url: `${site.url}/destinations/${d.slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    }),
  );

  const blogRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${site.url}/blog/${p.slug}`,
    lastModified: new Date(p.date),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...destinationRoutes, ...blogRoutes];
}
