import type { Metadata } from "next";
import Link from "next/link";

import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "In-depth travel guides from Folio Voyage — city planning, itineraries, and the thinking behind our curation. Coming soon.",
  alternates: { canonical: "/guides" },
  openGraph: { title: `Guides · ${site.name}`, url: `${site.url}/guides` },
};

export default function GuidesPage() {
  const nav = getNavDestinations();
  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="pt-20">
        <section className="container-page py-24 md:py-32">
          <p className="eyebrow">Folio Voyage</p>
          <h1 className="mt-3 font-display text-[40px] font-semibold leading-[1.05] md:text-[56px]">
            Guides
          </h1>
          <p className="mt-6 max-w-2xl text-[18px] leading-8 text-ink-soft">
            In-depth travel guides are on the way — city planning, itineraries,
            and the thinking behind our curation. In the meantime, explore our
            hand-picked destinations.
          </p>
          <Link
            href="/destinations"
            className="mt-8 inline-flex items-center rounded-[2px] border border-accent px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
          >
            Browse destinations
          </Link>
        </section>
      </main>
      <CovillaFooter />
    </>
  );
}
