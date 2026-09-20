import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DestinationCard } from "@/components/DestinationCard";
import { Reveal } from "./Reveal";
import type { Destination } from "@/data/types";

/**
 * Real destination showcase: every curated city, reusing the existing
 * DestinationCard (already used by /search's destination results) in a plain
 * responsive grid rather than a Covilla-specific carousel — see the plan's
 * Decision 4.
 */
export function DestinationShowcase({
  destinations,
}: {
  destinations: Destination[];
}) {
  return (
    <section className="container-page py-24 md:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal className="max-w-xl">
          <p className="eyebrow">Folio destinations</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.1] md:text-[46px]">
            Six cities
          </h2>
        </Reveal>
        <Link
          href="/destinations"
          className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
        >
          Browse all destinations <ArrowUpRight size={15} />
        </Link>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((d, i) => (
          <Reveal key={d.slug} delay={i * 90}>
            <DestinationCard destination={d} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
