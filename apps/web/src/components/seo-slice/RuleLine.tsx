/** The rule line and the checked line (spec 0006 page template, AC-T12). */
export function RuleLine({ rule, checked }: { rule: string; checked: string }) {
  return (
    <div className="mt-4 max-w-3xl text-[14px] leading-6 text-muted">
      <p>{rule}</p>
      <p className="mt-1 font-medium text-ink-soft">{checked}</p>
    </div>
  );
}
