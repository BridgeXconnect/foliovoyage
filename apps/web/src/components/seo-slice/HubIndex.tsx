import type { SlicePageModel } from "@/lib/seo-slice/page-model";
import { CardGrid } from "./PickCard";

/**
 * The hub's category index (spec 0006 page template, AC-T3): per listed page,
 * its H1 as a link, the one line fact and its two hub picks, then the counts
 * caption.
 */
export function HubIndex({
  pages,
  caption,
  pageSlug,
}: {
  pages: SlicePageModel["hubPages"];
  caption: string;
  pageSlug: string;
}) {
  if (pages.length === 0) return null;
  return (
    <div className="mt-12">
      {pages.map((p) => (
        <section key={p.slug} className="mt-10 first:mt-0">
          <h2 className="font-display text-[24px] font-medium text-ink">
            <a href={p.href} className="hover:text-accent">
              {p.h1}
            </a>
          </h2>
          <p className="mt-1 text-[14px] text-muted">{p.fact}</p>
          <CardGrid cards={p.cards} pageSlug={pageSlug} />
        </section>
      ))}
      <p className="mt-8 text-[13px] leading-5 text-muted">{caption}</p>
    </div>
  );
}
