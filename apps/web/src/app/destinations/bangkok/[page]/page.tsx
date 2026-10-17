import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SeoSliceManifest } from "@folio/shared";
import { SlicePage } from "@/components/seo-slice/SlicePage";
import { LIVE_SLUGS } from "@/content/seo/bangkok/live.generated";
import manifestJson from "@/content/seo/bangkok/manifest.json";
import { SLICE_PAGES } from "@/content/seo/bangkok/pages.generated";
import {
  buildPageModel,
  jsonLdFor,
  serializeJsonLd,
  sliceSlugs,
  type SliceSource,
} from "@/lib/seo-slice/page-model";
import { isSlicePreview } from "@/lib/seo-slice/preview";
import { site } from "@/lib/site";

/**
 * The SEO slice pages (spec 0006 page template): one static page per live
 * slug, rendered from the committed files only. No fetch, no API client.
 * Any other `/destinations/bangkok/{x}` is a 404 (AC-T1). In the local preview
 * (AC-T15) the slug list also holds pages that are not live yet.
 */

export const dynamicParams = false;

function source(): SliceSource {
  return {
    manifest: manifestJson as SeoSliceManifest,
    pages: SLICE_PAGES,
    liveSlugs: LIVE_SLUGS,
    preview: isSlicePreview(),
    siteLinks: process.env.SEO_SLICE_SITE_LINKS === "1",
    siteUrl: site.url,
  };
}

type Params = { params: Promise<{ page: string }> };

export function generateStaticParams(): { page: string }[] {
  return sliceSlugs(source()).map((page) => ({ page }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { page } = await params;
  const model = buildPageModel(source(), page);
  if (!model) return {};
  const images = model.ogImageUrl ? [model.ogImageUrl] : undefined;
  return {
    title: { absolute: model.seoTitle },
    description: model.metaDescription,
    alternates: { canonical: model.canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: site.name,
      url: model.canonical,
      title: model.seoTitle,
      description: model.metaDescription,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: model.seoTitle,
      description: model.metaDescription,
      images,
    },
  };
}

export default async function SliceRoute({ params }: Params) {
  const { page } = await params;
  const model = buildPageModel(source(), page);
  if (!model) notFound();
  return (
    <>
      {jsonLdFor(model, site.url).map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }} />
      ))}
      <SlicePage model={model} />
    </>
  );
}
