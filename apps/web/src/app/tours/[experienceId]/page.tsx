import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TourPageView } from "@/components/tour/TourPageView";
import { fetchExperiencePage } from "@/lib/experience-api";
import { isViatorHost } from "@/lib/viator-url";

/**
 * /tours/:experienceId — the database tour page (spec 0005, AC-4, AC-7, AC-8,
 * AC-15). ISR: built on first request, rebuilt in the background every 15
 * minutes. The page reads no request data (no `searchParams`, cookies or
 * headers), so it stays cacheable. `affiliateUrl` is read here only to pick the
 * button label and never leaves this file.
 */
export const revalidate = 900;
export const dynamicParams = true;

/**
 * No tour is built ahead of time (30k pages, any id that passes the cuid check
 * may create an entry). The empty list is still required: without a
 * `generateStaticParams` export Next renders a dynamic route on every request
 * (`Cache-Control: no-store`) and `revalidate` never takes effect.
 */
export function generateStaticParams(): { experienceId: string }[] {
  return [];
}

type Props = { params: Promise<{ experienceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { experienceId } = await params;
  // The same fetch as the page, so Next dedupes it. An api failure throws.
  const tour = await fetchExperiencePage(experienceId);
  const robots = { index: false, follow: false };
  if (!tour) return { title: "Tour not found", robots };
  return {
    title: { absolute: `${tour.title} · Atlas` },
    ...(tour.summary ? { description: tour.summary.text.slice(0, 155) } : {}),
    robots,
  };
}

export default async function TourPage({ params }: Props) {
  const { experienceId } = await params;
  const page = await fetchExperiencePage(experienceId);
  if (!page) notFound();

  const { affiliateUrl, ...tour } = page;
  const bookLabel = isViatorHost(affiliateUrl) ? "Book on Viator" : "Search on Viator";

  return (
    <>
      <SiteHeader />
      <TourPageView tour={tour} bookLabel={bookLabel} />
      <SiteFooter />
    </>
  );
}
