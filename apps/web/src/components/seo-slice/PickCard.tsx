import Image from "next/image";
import type { SliceCard } from "@/lib/seo-slice/page-model";

/**
 * One pick (spec 0006 pick card, AC-C1, AC-C2): the Viator cover image, the
 * provider's title verbatim, the band label and up to three inclusions, with
 * one "See on Viator" link. Nothing else: no price, availability,
 * cancellation, rating or review data.
 *
 * Row 22 adds the click event (AC-C7) and the `p` campaign check in the `/go`
 * route (AC-C3 to AC-C6). Until then the link already carries `?p={slug}`,
 * which `/go/tours` ignores.
 */
export function PickCard({ card, pageSlug }: { card: SliceCard; pageSlug: string }) {
  const href = `/go/tours/${encodeURIComponent(card.experienceId)}?p=${encodeURIComponent(pageSlug)}`;
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-white">
      <div className="relative aspect-[4/3] overflow-hidden bg-surface">
        <Image
          src={card.imageUrl}
          alt={card.imageAlt}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[12px] font-medium text-muted">{card.bandLabel}</p>
        <h3 className="mt-2 font-display text-[18px] font-medium leading-snug text-ink">{card.title}</h3>
        {card.inclusions.length > 0 && (
          <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-[14px] leading-6 text-ink-soft">
            {card.inclusions.map((inc, i) => (
              <li key={i}>{inc}</li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <a
            href={href}
            target="_blank"
            rel="sponsored nofollow"
            className="inline-flex items-center text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
          >
            See on Viator
          </a>
        </div>
      </div>
    </article>
  );
}

export function CardGrid({ cards, pageSlug }: { cards: SliceCard[]; pageSlug: string }) {
  return (
    <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <PickCard key={c.experienceId} card={c} pageSlug={pageSlug} />
      ))}
    </div>
  );
}
