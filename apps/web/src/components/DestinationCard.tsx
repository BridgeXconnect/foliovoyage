import Image from "next/image";
import Link from "next/link";
import type { Destination } from "@/data/types";

/**
 * Tall image card with a bottom gradient scrim and centred/anchored label —
 * the destination-tile treatment carried over from the original homepage
 * carousel.
 */
export function DestinationCard({
  destination,
}: {
  destination: Destination;
}) {
  const { slug, city, country, heroImage, heroImageAlt, experiences } =
    destination;
  return (
    <Link
      href={`/destinations/${slug}`}
      className="group relative flex min-h-[420px] flex-col justify-end overflow-hidden rounded-card text-white"
    >
      <Image
        src={heroImage}
        alt={heroImageAlt}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,19,38,0) 35%, rgba(15,19,38,0.82))",
        }}
        aria-hidden
      />
      <div className="relative z-10 p-6">
        <div className="flex items-center gap-2 eyebrow !text-white/80">
          <span>{experiences.length}</span>
          <span>experiences</span>
        </div>
        <h3 className="mt-2 text-[28px] font-display font-semibold leading-tight text-white">
          {city}
        </h3>
        <p className="text-[14px] text-white/85">{country}</p>
      </div>
    </Link>
  );
}
