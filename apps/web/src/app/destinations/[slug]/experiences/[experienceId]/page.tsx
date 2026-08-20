import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Clock, Star, ShieldCheck } from "lucide-react";

import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";
import {
  findExperienceDetail,
  listExperienceDetailParams,
  experienceGoHref,
  experienceDetailAffiliateInput,
  formatFromPrice,
} from "@/lib/experience-detail";
import {
  buildExperienceMetadata,
  buildExperienceProductLd,
  buildExperienceBreadcrumbLd,
} from "@/lib/experience-detail-seo";
import { ExperienceDetailCta } from "./ExperienceDetailCta";

// Fully static — one page per (destination, experience). Unknown pairs 404.
export function generateStaticParams() {
  return listExperienceDetailParams();
}
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; experienceId: string }>;
}): Promise<Metadata> {
  const { slug, experienceId } = await params;
  const found = findExperienceDetail(slug, experienceId);
  if (!found) return {};
  return buildExperienceMetadata(site.url, found.destination, found.experience);
}

export default async function ExperienceDetailPage({
  params,
}: {
  params: Promise<{ slug: string; experienceId: string }>;
}) {
  const { slug, experienceId } = await params;
  const found = findExperienceDetail(slug, experienceId);
  if (!found) notFound();
  const { destination: d, experience: e } = found;

  const nav = getNavDestinations();
  const goHref = experienceGoHref(d.slug, e);
  const clickInput = experienceDetailAffiliateInput(d, e);
  const productLd = buildExperienceProductLd(site.url, d, e);
  const breadcrumbLd = buildExperienceBreadcrumbLd(site.url, d, e);

  const hasPrice = typeof e.fromPrice === "number" && e.fromPrice > 0;
  const hasRating = typeof e.rating === "number" && e.rating > 0;

  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-28 md:px-10">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="eyebrow">
          <Link href="/destinations" className="hover:text-ink">Destinations</Link>
          <span className="px-2" aria-hidden>/</span>
          <Link href={`/destinations/${d.slug}`} className="hover:text-ink">{d.city}</Link>
        </nav>

        <p className="eyebrow mt-6">{e.category}</p>
        <h1 className="mt-3 font-display text-[40px] font-semibold leading-[1.05] md:text-[52px]">
          {e.title}
        </h1>

        <p className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-ink-soft">
          <MapPin size={15} /> {d.city}, {d.country}
        </p>

        <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-[3px] bg-surface">
          <Image
            src={e.image}
            alt={e.imageAlt}
            fill
            priority
            sizes="(max-width: 896px) 100vw, 896px"
            className="object-cover"
          />
        </div>

        {/* Enrichment facts */}
        <p className="mt-8 text-[18px] leading-8 text-ink-soft">{e.description}</p>

        <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-y border-line py-5 text-[14px]">
          {e.duration && (
            <div className="inline-flex items-center gap-1.5">
              <Clock size={15} className="text-muted" />
              <dt className="sr-only">Duration</dt>
              <dd>{e.duration}</dd>
            </div>
          )}
          {hasRating && (
            <div className="inline-flex items-center gap-1.5">
              <Star size={15} className="fill-current text-amber-500" aria-hidden />
              <dt className="sr-only">Rating</dt>
              <dd>
                <span className="font-medium">{e.rating!.toFixed(1)}</span>
                {typeof e.ratingCount === "number" && (
                  <span className="text-muted"> ({e.ratingCount.toLocaleString("en-US")})</span>
                )}
                {e.provider && <span className="text-muted"> · via {e.provider}</span>}
              </dd>
            </div>
          )}
          {e.freeCancel && (
            <div className="inline-flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck size={15} aria-hidden />
              <dt className="sr-only">Cancellation</dt>
              <dd>Free cancellation</dd>
            </div>
          )}
        </dl>

        {/* Booking option (the 1:1 "tour") */}
        <section aria-labelledby="booking" className="mt-10 rounded-[3px] border border-line p-6 md:p-8">
          <h2 id="booking" className="font-display text-[22px] font-medium">Book this experience</h2>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                {hasPrice ? "From" : "Price"}
              </p>
              <p className="text-[20px] font-medium text-ink">
                {hasPrice ? formatFromPrice(e.fromPrice!, e.currency) : e.priceBand}
              </p>
              {hasPrice && (
                <p className="mt-1 text-[12px] text-muted">
                  Final price shown by {e.provider ?? "the provider"} at booking.
                </p>
              )}
            </div>
            <ExperienceDetailCta goHref={goHref} provider={e.provider} clickInput={clickInput} />
          </div>
          <p className="mt-5 max-w-xl text-[12px] leading-6 text-muted">
            Hand-picked and independently written. Booking links go live as partner programs are
            approved — see our{" "}
            <Link href="/legal/disclosure" className="text-accent underline">affiliate disclosure</Link>.
          </p>
        </section>

        <div className="mt-10">
          <Link href={`/destinations/${d.slug}`} className="text-[14px] text-accent underline">
            ← All experiences in {d.city}
          </Link>
        </div>
      </main>
      <CovillaFooter />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </>
  );
}
