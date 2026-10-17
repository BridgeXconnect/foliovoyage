/** The stat strip and its caption (spec 0006 page template, AC-T13). Empty renders nothing. */
export function StatStrip({ lines, caption }: { lines: string[]; caption: string }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="At a glance" className="mt-8 border-y border-line py-5">
      <ul className="grid gap-3 sm:grid-cols-3">
        {lines.map((line, i) => (
          <li key={i} className="text-[15px] font-medium leading-6 text-ink">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-5 text-muted">{caption}</p>
    </section>
  );
}
