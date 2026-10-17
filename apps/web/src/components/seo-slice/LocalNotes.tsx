import type { SlicePageModel } from "@/lib/seo-slice/page-model";

/**
 * "Local notes" (spec 0006 page template, AC-T14): each note's text exactly as
 * written (React escapes it, nothing else changes), signed by the team only.
 */
export function LocalNotes({ notes }: { notes: SlicePageModel["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="font-display text-[26px] font-medium text-ink">Local notes</h2>
      <ul className="mt-5 space-y-5">
        {notes.map((n) => (
          <li key={n.id} className="max-w-3xl">
            <p className="whitespace-pre-line text-[16px] leading-7 text-ink-soft">{n.text}</p>
            <p className="mt-1 text-[13px] text-muted">{n.signed}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
