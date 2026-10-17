import type { SlicePageModel } from "@/lib/seo-slice/page-model";
import { CardGrid } from "./PickCard";

/**
 * "How to choose" (spec 0006 page template, AC-T3): a sub heading per section,
 * or no sub headings when the page shows one list. Omitted with no picks.
 */
export function ChooseSections({ sections, pageSlug }: { sections: SlicePageModel["sections"]; pageSlug: string }) {
  if (sections.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="font-display text-[26px] font-medium text-ink">How to choose</h2>
      {sections.map((s, i) => (
        <div key={s.label ?? i} className="mt-8">
          {s.label && <h3 className="font-display text-[20px] font-medium text-ink">{s.label}</h3>}
          <CardGrid cards={s.cards} pageSlug={pageSlug} />
        </div>
      ))}
    </section>
  );
}
