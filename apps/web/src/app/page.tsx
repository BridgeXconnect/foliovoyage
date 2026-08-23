import type { Metadata } from "next";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { FixedRail } from "@/components/covilla/FixedRail";
import { Preloader } from "@/components/covilla/Preloader";
import { SearchHero } from "@/components/covilla/SearchHero";
import { DestinationShowcase } from "@/components/covilla/DestinationShowcase";
import { BenefitsSection } from "@/components/covilla/BenefitsSection";
import { HowItWorks } from "@/components/covilla/HowItWorks";
import { TrustSection } from "@/components/covilla/TrustSection";
import { getAllDestinations, getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  const nav = getNavDestinations();
  const destinations = getAllDestinations();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    description: site.description,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${site.url}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <Preloader />
      <CovillaHeader destinations={nav} />
      <FixedRail />

      <main className="pt-20">
        <SearchHero destinations={nav} />

        <DestinationShowcase destinations={destinations} />

        <HowItWorks />

        <BenefitsSection />

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
