import type { Metadata } from "next";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { PromiseBand } from "@/components/covilla/PromiseBand";
import {
  PopularVacations,
  type VacationItem,
} from "@/components/covilla/PopularVacations";
import {
  getAllDestinations,
  getNavDestinations,
} from "@/data/destinations-helpers";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Destinations",
  description:
    "Browse Folio Voyage's hand-picked city guides — original editorial and curated tours and experiences across the world's most rewarding destinations.",
  alternates: { canonical: "/destinations" },
  openGraph: {
    title: `Destinations · ${site.name}`,
    description:
      "Hand-picked city guides and curated experiences across the world's most rewarding destinations.",
    url: `${site.url}/destinations`,
  },
};

export default function DestinationsPage() {
  const nav = getNavDestinations();
  const destinations = getAllDestinations();

  // Curated experiences grouped by country (3 per country tab).
  const vacationItems: VacationItem[] = destinations.flatMap((d) =>
    d.experiences.slice(0, 3).map((e) => ({
      id: `${d.slug}-${e.id}`,
      title: e.title,
      description: e.description,
      image: e.image,
      imageAlt: e.imageAlt,
      priceBand: e.priceBand,
      city: d.city,
      country: d.country,
      slug: d.slug,
    })),
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Folio Voyage destinations",
    itemListElement: destinations.map((d, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${site.url}/destinations/${d.slug}`,
      name: `${d.city}, ${d.country}`,
    })),
  };

  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="pt-20">
        <section className="border-b border-line bg-surface">
          <div className="container-page py-16 md:py-20">
            <p className="eyebrow">The atlas</p>
            <h1 className="mt-3 max-w-3xl text-[40px] font-semibold leading-[1.1] md:text-[56px]">
              Destinations worth the journey
            </h1>
            <p className="mt-5 max-w-2xl text-[18px] leading-8 text-ink-soft">
              Every guide below is researched and checked, built around the
              experiences we think are worth your time: the landmarks, the
              neighbourhoods, the meals, and the day trips that define a place.
            </p>
          </div>
        </section>

        <PopularVacations
          items={vacationItems}
          eyebrow="Browse by country"
          title="Curated experiences, country by country"
        />
      </main>

      <PromiseBand />
      <CovillaFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
