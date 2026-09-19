import Image from "next/image";
import Link from "next/link";
import { Compass, Sparkles, Wallet, HeartHandshake } from "lucide-react";
import { Reveal } from "./Reveal";
import { IMG } from "@/data/media";

const features = [
  {
    icon: Compass,
    title: "Hands-on curation",
    body: "Considered picks, not an endless list to wade through.",
  },
  {
    icon: Sparkles,
    title: "Only what's worth it",
    body: "We cut the filler, so each experience we feature earns its place on the page.",
  },
  {
    icon: Wallet,
    title: "Value across budgets",
    body: "Curated doesn't mean costly. We surface standout experiences at every price band and flag real value.",
  },
  {
    icon: HeartHandshake,
    title: "Honest by design",
    body: "We're reader-supported and say so. Recommendations are editorial first — commissions never buy a ranking.",
  },
];

/** Covilla "benefits" block: two-column intro + a four-up "why we're different" row. */
export function BenefitsSection() {
  return (
    <section className="container-page py-24 md:py-32">
      <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
        <Reveal variant="left">
          <p className="eyebrow">The Folio approach</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.1] md:text-[46px]">
            Take the guesswork out of your next trip
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-8 text-ink-soft">
            Folio Voyage is a hand-picked collection of the world&apos;s most
            rewarding tours and experiences. We do the research and bring you
            only the trips worth taking — so you can plan less and travel more.
          </p>
          <Link
            href="/destinations"
            className="mt-8 inline-flex items-center bg-accent px-8 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-white transition-colors hover:bg-accent-ink"
          >
            Choose a destination
          </Link>
        </Reveal>

        <Reveal variant="right" className="relative aspect-[4/5] overflow-hidden rounded-[3px] md:aspect-[4/4.4]">
          <Image
            src={IMG.home_hero}
            alt="Whitewashed cliffside village above the sea at golden hour"
            fill
            sizes="(max-width: 768px) 100vw, 45vw"
            className="object-cover"
          />
        </Reveal>
      </div>

      <div className="mt-20 md:mt-28">
        <Reveal>
          <div className="flex items-center gap-5">
            <p className="eyebrow whitespace-nowrap">Why we&apos;re different</p>
            <span className="h-px flex-1 bg-line" />
          </div>
        </Reveal>

        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <Reveal
              key={f.title}
              delay={i * 90}
              className="flex min-h-[240px] flex-col gap-8 bg-white p-8"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-muted">
                <f.icon size={22} strokeWidth={1.6} />
              </span>
              <div>
                <h3 className="font-display text-[20px] font-medium">
                  {f.title}
                </h3>
                <p className="mt-2 text-[14px] leading-6 text-ink-soft">
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
