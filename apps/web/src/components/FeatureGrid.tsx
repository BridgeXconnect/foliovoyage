import { Compass, Sparkles, Wallet, HeartHandshake } from "lucide-react";

const features = [
  {
    icon: Compass,
    title: "Hands-on curation",
    body: "Considered recommendations, not an endless list to wade through.",
  },
  {
    icon: Sparkles,
    title: "Only what's worth it",
    body: "We cut the filler, so each experience we feature earns its place on the page.",
  },
  {
    icon: Wallet,
    title: "Value across budgets",
    body: "Curated doesn't mean costly. We surface standout experiences at every price band and flag genuine value.",
  },
  {
    icon: HeartHandshake,
    title: "Honest by design",
    body: "We're reader-supported and say so. Recommendations are editorial first — commissions never buy a ranking.",
  },
];

/** The "Folio difference" four-up feature row from the original homepage. */
export function FeatureGrid() {
  return (
    // gap-px over a hairline background renders clean 1px separators between
    // cards at every breakpoint without per-cell border bookkeeping.
    <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {features.map((f) => (
        <div
          key={f.title}
          className="flex min-h-[240px] flex-col gap-8 bg-white p-8"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-muted">
            <f.icon size={22} strokeWidth={1.6} />
          </span>
          <div>
            <h3 className="text-[20px] font-display font-medium">{f.title}</h3>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">{f.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
