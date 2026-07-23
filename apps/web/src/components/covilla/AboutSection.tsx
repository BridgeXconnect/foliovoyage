import { Reveal } from "./Reveal";

/** "About" (Covilla): two-column editorial statement. */
export function AboutSection() {
  return (
    <section className="border-t border-line bg-surface">
      <div className="container-page grid gap-10 py-24 md:grid-cols-[0.9fr_1.1fr] md:gap-20 md:py-32">
        <Reveal variant="left">
          <p className="eyebrow">About Folio Voyage</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.12] md:text-[42px]">
            A curated travel folio, not another listings site
          </h2>
        </Reveal>
        <Reveal variant="right" delay={80} className="space-y-5 text-[17px] leading-8 text-ink-soft">
          <p>
            Folio Voyage exists because planning a trip has become a chore. The
            information is all out there, scattered across listing sites, blogs,
            maps, and forums, but no single place tells you what&apos;s actually
            worth doing, where it is, and when to go.
          </p>
          <p>
            So we do the reading for you. Each destination is researched and
            checked, built around the experiences we think are worth your time,
            with honest notes on neighbourhoods, best seasons, and the things
            most sites gloss over.
          </p>
          <p>
            We&apos;re reader-supported: as affiliate partnerships go live, we may
            earn a commission when you book through our links, at no extra cost to
            you. That funds the curation — but it never buys a recommendation. The
            trust is the whole point.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
