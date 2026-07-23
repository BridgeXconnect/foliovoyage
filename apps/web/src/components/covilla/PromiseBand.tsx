import Image from "next/image";
import Link from "next/link";
import { Reveal } from "./Reveal";
import { IMG } from "@/data/media";

/** Full-bleed "promise" band (Covilla): image + centred statement + CTA. */
export function PromiseBand() {
  return (
    <section className="relative flex min-h-[460px] items-center overflow-hidden">
      <Image
        src={IMG.bal_tegallalang}
        alt="Sculpted green rice terraces descending a valley in Bali"
        fill
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-overlay/62" />
      <div className="container-page relative z-10 py-24 text-center text-white">
        <Reveal>
          <p className="eyebrow !text-white/70">The Folio promise</p>
          <h2 className="mx-auto mt-4 max-w-3xl text-[32px] font-semibold leading-[1.15] text-white md:text-[48px]">
            Peace of mind from the first idea to the trip itself
          </h2>
          <Link
            href="/legal/contact"
            className="mt-9 inline-flex items-center bg-white px-10 py-5 text-[11px] font-medium uppercase tracking-[0.22em] text-ink transition-transform hover:-translate-y-0.5"
          >
            Contact us
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
