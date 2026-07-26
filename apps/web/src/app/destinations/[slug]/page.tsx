import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MapPin, CalendarClock } from "lucide-react";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { FixedRail } from "@/components/covilla/FixedRail";
import { StickyFeaturedPanel } from "@/components/covilla/StickyFeaturedPanel";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
import { OtherDestinationsGrid } from "@/components/covilla/OtherDestinationsGrid";
import { PlanTripCta } from "@/components/PlanTripCta";
import {
  getDestination,
  getDestinationSlugs,
  getAllDestinations,
  getNavDestinations,
} from "@/data/destinations-helpers";
import { site } from "@/lib/site";

// Fully static — every destination is prerendered at build time (SSG).
export function generateStaticParams() {
  return getDestinationSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const d = getDestination(slug);
  if (!d) return {};

  const title = `${d.city} Travel Guide — Best Tours & Experiences`;
  const description = `${d.city}, ${d.country}: an original guide to ${d.experiences.length} hand-picked experiences — ${d.knownFor.slice(0, 3).join(", ")} and more. Best time to visit: ${d.bestTime}.`;

  return {
    title,
    description,
    alternates: { canonical: `/destinations/${d.slug}` },
    openGraph: {
      type: "article",
      title: `${d.city} Travel Guide · ${site.name}`,
      description,
      url: `${site.url}/destinations/${d.slug}`,
      images: [{ url: d.heroImage, alt: d.heroImageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${d.city} Travel Guide · ${site.name}`,
      description,
      images: [d.heroImage],
    },
  };
}

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const d = getDestination(slug);
  if (!d) notFound();

  const nav = getNavDestinations();
  const all = getAllDestinations();
  const idx = all.findIndex((x) => x.slug === d.slug);
  const prev = all[(idx - 1 + all.length) % all.length];
  const next = all[(idx + 1) % all.length];
  const others = nav.filter((n) => n.slug !== d.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TouristDestination",
    name: `${d.city}, ${d.country}`,
    description: d.intro[0],
    url: `${site.url}/destinations/${d.slug}`,
    image: d.heroImage,
    geo: { "@type": "GeoCoordinates", latitude: d.lat, longitude: d.lng },
    includesAttraction: d.experiences.map((e) => ({
      "@type": "TouristAttraction",
      name: e.title,
      description: e.description,
      image: e.image,
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: site.url },
      {
        "@type": "ListItem",
        position: 2,
        name: "Destinations",
        item: `${site.url}/destinations`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: d.city,
        item: `${site.url}/destinations/${d.slug}`,
      },
    ],
  };

  return (
    <>
      <CovillaHeader destinations={nav} transparent dropdownOnLight />
      <FixedRail tone="light" />

      <main>
        <div className="grid lg:grid-cols-[42%_58%]">
          {/* Fixed featured city panel */}
          <StickyFeaturedPanel>
            <Image
              src={d.heroImage}
              alt={d.heroImageAlt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 42vw"
              className="object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(15,19,38,0.35) 0%, rgba(15,19,38,0.15) 40%, rgba(15,19,38,0.85))",
              }}
              aria-hidden
            />

            {/* prev / next destination */}
            <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-4 lg:flex">
              <Link
                href={`/destinations/${next.slug}`}
                aria-label={`Next destination: ${next.city}`}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-ink transition-transform hover:scale-105"
              >
                <ArrowRight size={18} />
              </Link>
              <Link
                href={`/destinations/${prev.slug}`}
                aria-label={`Previous destination: ${prev.city}`}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-ink transition-transform hover:scale-105"
              >
                <ArrowLeft size={18} />
              </Link>
            </div>

            <div className="relative z-10 px-8 pb-14 pt-28 lg:px-14">
              <p className="eyebrow !text-white/75">Destination guide</p>
              <h1 className="mt-4 font-display text-[46px] font-semibold leading-[1.02] text-white md:text-[64px]">
                {d.city}
              </h1>
              <p className="mt-3 max-w-md text-[17px] text-white/85">
                {d.tagline}
              </p>
              <PlanTripCta city={d.city} destinationSlug={d.slug} />
            </div>
          </StickyFeaturedPanel>

          {/* Scrolling content column */}
          <div className="px-6 pb-20 pt-24 md:px-10 lg:px-14 lg:pt-28 xl:px-20">
            <nav aria-label="Breadcrumb" className="eyebrow">
              <Link href="/destinations" className="hover:text-ink">
                Destinations
              </Link>
              <span className="px-2" aria-hidden>
                /
              </span>
              <span>{d.country}</span>
            </nav>

            <h2 className="mt-4 text-[40px] font-semibold leading-[1.05] md:text-[54px]">
              Experiences in {d.city}
            </h2>

            {/* Written guide lead block */}
            <div className="mt-8 space-y-5 text-[17px] leading-8 text-ink-soft">
              {d.intro.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-5 text-[13px] text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={15} /> {d.city}, {d.country}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={15} /> Best time: {d.bestTime}
              </span>
            </div>

            <div className="mt-6">
              <p className="eyebrow">Known for</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {d.knownFor.map((k) => (
                  <li
                    key={k}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft"
                  >
                    {k}
                  </li>
                ))}
              </ul>
            </div>

            {/* Experiences */}
            <div className="mt-14 flex items-center gap-5">
              <p className="eyebrow whitespace-nowrap">
                {d.experiences.length} curated experiences
              </p>
              <span className="h-px flex-1 bg-line" />
            </div>

            <div className="mt-8 space-y-6">
              {d.experiences.map((e) => (
                <ExperienceRowCard key={e.id} experience={e} />
              ))}
            </div>

            <p className="mt-6 max-w-xl text-[13px] leading-6 text-muted">
              Hand-picked and independently written. Booking links go live as
              partner programs are approved — see our{" "}
              <Link href="/legal/disclosure" className="text-accent underline">
                affiliate disclosure
              </Link>
              .
            </p>

            {/* Neighbourhoods */}
            {d.neighbourhoods && d.neighbourhoods.length > 0 && (
              <div className="mt-16">
                <div className="flex items-center gap-5">
                  <p className="eyebrow whitespace-nowrap">
                    Where to base yourself
                  </p>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <dl className="mt-8 grid gap-8 sm:grid-cols-2">
                  {d.neighbourhoods.map((n) => (
                    <div key={n.name}>
                      <dt className="font-display text-[19px] font-medium text-ink">
                        {n.name}
                      </dt>
                      <dd className="mt-2 text-[14px] leading-7 text-ink-soft">
                        {n.note}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Other destinations */}
            <div className="mt-16">
              <div className="flex items-center gap-5">
                <p className="eyebrow whitespace-nowrap">Other destinations</p>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-8">
                <OtherDestinationsGrid destinations={others} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <CovillaFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
    </>
  );
}
