import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { FixedRail } from "@/components/covilla/FixedRail";
import { Preloader } from "@/components/covilla/Preloader";
import { Reveal } from "@/components/covilla/Reveal";
import { HeroSlider } from "@/components/covilla/HeroSlider";
import { AcrossWorldSlider } from "@/components/covilla/AcrossWorldSlider";
import { BenefitsSection } from "@/components/covilla/BenefitsSection";
import { TestimonialParallax } from "@/components/covilla/TestimonialParallax";
import {
  PopularVacations,
  type VacationItem,
} from "@/components/covilla/PopularVacations";
import { PromiseBand } from "@/components/covilla/PromiseBand";
import { HowItWorks } from "@/components/covilla/HowItWorks";
import { AboutSection } from "@/components/covilla/AboutSection";
import { GalleryRow } from "@/components/covilla/GalleryRow";
import { TrustSection } from "@/components/covilla/TrustSection";
import { getAllDestinations, getNavDestinations } from "@/data/destinations-helpers";
import { testimonials } from "@/data/testimonials";
import { IMG } from "@/data/media";
import { site } from "@/lib/site";

export default function HomePage() {
  const nav = getNavDestinations();
  const destinations = getAllDestinations();

  // Popular experiences, derived from real destination content (2 per city).
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
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    description: site.description,
  };

  return (
    <>
      <Preloader />
      <CovillaHeader destinations={nav} transparent />
      <FixedRail />

      <main>
        <HeroSlider slides={nav} />

        {/* Across the world */}
        <section className="py-24 md:py-32">
          <div className="container-page text-center">
            <Reveal>
              <p className="eyebrow">Folio destinations</p>
              <h2 className="mt-4 text-[36px] font-semibold leading-tight md:text-[52px]">
                Across the world
              </h2>
            </Reveal>
          </div>
          <div className="mt-14">
            <AcrossWorldSlider slides={nav} />
          </div>
        </section>

        <BenefitsSection />

        <TestimonialParallax
          testimonials={testimonials}
          eyebrow="What we stand for"
          image={IMG.bal_hero}
          imageAlt="Palm-covered hillside above a valley in Bali"
        />

        <PopularVacations items={vacationItems} />

        <PromiseBand />

        <HowItWorks />

        <AboutSection />

        <GalleryRow />

        <TrustSection />
      </main>

      <CovillaFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
