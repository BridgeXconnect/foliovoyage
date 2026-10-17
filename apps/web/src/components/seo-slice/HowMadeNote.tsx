/** "How this page was made" (spec 0006 page template, AC-T4) and the computed on date. */
export function HowMadeNote({ note, computedOn }: { note: string; computedOn: string }) {
  return (
    <section className="mt-14 border-t border-line pt-8">
      <h2 className="font-display text-[20px] font-medium text-ink">How this page was made</h2>
      <p className="mt-3 max-w-3xl text-[15px] leading-7 text-ink-soft">{note}</p>
      <p className="mt-3 text-[13px] text-muted">{computedOn}</p>
    </section>
  );
}
