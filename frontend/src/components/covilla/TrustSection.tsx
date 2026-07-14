import Image from "next/image";
import { Reveal } from "./Reveal";
import { IMG } from "@/data/media";

// Adapted from Covilla's "Meet your travel agents" — reframed as an honest
// "why trust us" block, keeping the four-card rhythm.
const points = [
  {
    title: "Independently written",
    body: "No sponsored rankings, no reprinted press releases. Every guide is our own editorial, in our own words.",
    image: IMG.rom_forum,
    imageAlt: "Ruins of the Roman Forum",
  },
  {
    title: "Every operator vetted",
    body: "We only point you at experiences and operators we'd send a friend to — the rest doesn't make the page.",
    image: IMG.kyo_arashiyama,
    imageAlt: "Sunlight through the Arashiyama bamboo grove, Kyoto",
  },
  {
    title: "Transparent by default",
    body: "We're reader-supported and say so, on every page. Commissions fund the work; they never buy a recommendation.",
    image: IMG.lis_belem,
    imageAlt: "Belém Tower on the Tagus river, Lisbon",
  },
  {
    title: "Locally informed",
    body: "Guides are grounded in first-hand knowledge and honest local detail — the neighbourhood notes most sites skip.",
    image: IMG.han_trainstreet,
    imageAlt: "Cafés beside the tracks on Hanoi's Train Street",
  },
];

/** "Why travellers trust us" — adapted from the Covilla team grid. */
export function TrustSection() {
  return (
    <section className="container-page py-24 md:py-32">
      <div className="flex flex-col gap-4 text-center">
        <Reveal>
          <p className="eyebrow">Why travellers trust us</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-[32px] font-semibold leading-[1.12] md:text-[46px]">
            Curation you can actually rely on
          </h2>
        </Reveal>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {points.map((p, i) => (
          <Reveal key={p.title} delay={i * 90}>
            <article className="group flex h-full flex-col overflow-hidden rounded-[3px] border border-line bg-white">
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={p.image}
                  alt={p.imageAlt}
                  fill
                  sizes="(max-width: 640px) 100vw, 25vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-display text-[19px] font-medium">
                  {p.title}
                </h3>
                <p className="mt-2 text-[14px] leading-6 text-ink-soft">
                  {p.body}
                </p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
