import Image from "next/image";
import { IMG } from "@/data/media";

const shots: { src: string; alt: string }[] = [
  { src: IMG.rom_trastevere, alt: "A cobbled restaurant-lined street in Trastevere, Rome" },
  { src: IMG.kyo_gion, alt: "Traditional wooden machiya houses in Gion, Kyoto" },
  { src: IMG.bkk_chatuchak, alt: "Covered market aisles at Chatuchak Weekend Market, Bangkok" },
  { src: IMG.han_oldquarter, alt: "A busy street in Hanoi's Old Quarter" },
  { src: IMG.lis_sintra, alt: "The colourful towers of Pena Palace in Sintra, Portugal" },
  { src: IMG.bal_uluwatu, alt: "Uluwatu Temple on a clifftop above the sea in Bali" },
];

/** Full-bleed travel-moments strip (Covilla gallery band). */
export function GalleryRow() {
  return (
    <section aria-label="Travel moments" className="w-full overflow-x-auto">
      <div className="flex min-w-max">
        {shots.map((s) => (
          <div
            key={s.src}
            className="relative aspect-[3/4] w-[46vw] shrink-0 sm:w-[30vw] lg:w-[16.666vw]"
          >
            <Image
              src={s.src}
              alt={s.alt}
              fill
              sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 17vw"
              className="object-cover"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
