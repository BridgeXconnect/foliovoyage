/**
 * Pure SEO builders for experience detail pages (ST-17). Mirrors the metadata +
 * JSON-LD pattern already used by the destination page (`destinations/[slug]/
 * page.tsx`): a descriptive title, a nested canonical, OpenGraph/Twitter cards,
 * and `Product` + `BreadcrumbList` structured data.
 *
 * `siteUrl` is a parameter (not read from `@/lib/site` here) so these are
 * deterministic under test and free of `next`/env coupling. Nullable provider
 * signals are emitted only when present — no protected rating data or fabricated price (docs/02
 * §1.3, plan Findings §6).
 */
import type { Metadata } from "next";
import type { Destination, Experience } from "@folio/shared";
import { experienceDetailPath } from "@/lib/experience-detail";

const SITE_NAME = "Folio Voyage";

function detailUrl(siteUrl: string, d: Destination, e: Experience): string {
  return `${siteUrl}${experienceDetailPath(d.slug, e.id)}`;
}

export function buildExperienceMetadata(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Metadata {
  const title = `${e.title} — ${d.city}, ${d.country}`;
  const description = e.description;
  const url = detailUrl(siteUrl, d, e);
  return {
    title,
    description,
    alternates: { canonical: experienceDetailPath(d.slug, e.id) },
    openGraph: {
      type: "article",
      title: `${e.title} · ${SITE_NAME}`,
      description,
      url,
      images: [{ url: e.image, alt: e.imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${e.title} · ${SITE_NAME}`,
      description,
      images: [e.image],
    },
  };
}

export function buildExperienceProductLd(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Record<string, unknown> {
  const url = detailUrl(siteUrl, d, e);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: e.title,
    description: e.description,
    image: e.image,
    category: e.category,
    url,
  };

  // Offer: always present (the page has a booking affordance), but price is
  // included only when a real "from" price exists — never fabricated.
  const offer: Record<string, unknown> = { "@type": "Offer", url };
  if (typeof e.fromPrice === "number" && e.currency) {
    offer.price = String(e.fromPrice);
    offer.priceCurrency = e.currency;
  }
  if (e.provider) {
    offer.seller = { "@type": "Organization", name: e.provider };
  }
  ld.offers = offer;

  return ld;
}

export function buildExperienceBreadcrumbLd(
  siteUrl: string,
  d: Destination,
  e: Experience,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Destinations", item: `${siteUrl}/destinations` },
      { "@type": "ListItem", position: 3, name: d.city, item: `${siteUrl}/destinations/${d.slug}` },
      { "@type": "ListItem", position: 4, name: e.title, item: detailUrl(siteUrl, d, e) },
    ],
  };
}
