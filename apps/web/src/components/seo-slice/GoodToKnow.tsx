import type { SlicePageModel } from "@/lib/seo-slice/page-model";

/**
 * "Good to know" (spec 0006 page template, AC-T14): each source fact, a link to
 * its source named by host, and the date it was checked. The only external
 * links on a slice page (AC-T9).
 */
export function GoodToKnow({ facts }: { facts: SlicePageModel["goodToKnow"] }) {
  if (facts.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="font-display text-[26px] font-medium text-ink">Good to know</h2>
      <ul className="mt-5 max-w-3xl space-y-4">
        {facts.map((f, i) => (
          <li key={i} className="text-[16px] leading-7 text-ink-soft">
            {f.fact}{" "}
            <a href={f.url} rel="noopener noreferrer" target="_blank" className="text-accent hover:text-accent-ink">
              {f.host}
            </a>
            <span className="text-[13px] text-muted">, {f.checked}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
