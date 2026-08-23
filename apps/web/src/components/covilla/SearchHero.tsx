import Link from "next/link";
import { Search } from "lucide-react";
import { site } from "@/lib/site";

/**
 * Search-forward homepage hero. Deliberately a plain content band (no photo,
 * no carousel) — the least visually opinionated hero available, so a future
 * visual pass is a skin change, not a rebuild. The search form is a native
 * GET to /search; landing there already fires the `search_performed`
 * analytics event (see SearchAnalytics), so this component adds no client JS
 * and no new PostHog capture.
 */
export function SearchHero({
  destinations,
}: {
  destinations: { slug: string; city: string; country: string }[];
}) {
  return (
    <section className="border-b border-line bg-surface">
      <div className="container-page py-16 md:py-24">
        <p className="eyebrow">{site.tagline}</p>
        <h1 className="mt-4 max-w-2xl text-[40px] font-semibold leading-[1.08] md:text-[60px]">
          Where do you want to go?
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-8 text-ink-soft">
          Search hand-picked experiences across our curated destinations, or
          jump straight into a city guide.
        </p>

        <form
          action="/search"
          method="GET"
          role="search"
          className="relative mt-9 max-w-xl"
        >
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            placeholder="Search experiences and destinations…"
            aria-label="Search experiences and destinations"
            className="w-full rounded-[3px] border border-line bg-white py-4 pl-11 pr-32 text-[15px] text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1.5 bottom-1.5 inline-flex items-center bg-accent px-6 text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-accent-ink"
          >
            Search
          </button>
        </form>

        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted">
            Popular:
          </span>
          {destinations.map((d) => (
            <Link
              key={d.slug}
              href={`/destinations/${d.slug}`}
              className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              {d.city}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
