import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { ExperienceRowCard } from "@/components/covilla/ExperienceRowCard";
import { DestinationCard } from "@/components/DestinationCard";
import { getNavDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";
import { parseSearchState } from "@/lib/search-url";
import { runSearch, type SearchResult } from "@/lib/search-experiences";
import { SearchControls } from "./SearchControls";
import { SearchAnalytics } from "./SearchAnalytics";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const state = parseSearchState(await searchParams);
  const filtered =
    Boolean(state.q) ||
    state.priceBands.length > 0 ||
    state.categories.length > 0 ||
    state.durations.length > 0;
  const title = state.q ? `Search: ${state.q}` : "Search experiences";
  return {
    title,
    description:
      "Search and filter Folio Voyage's curated experiences and destinations by price, category, and duration.",
    alternates: { canonical: "/search" },
    // Filtered/query permutations are thin, near-duplicate pages — keep them out
    // of the index but let crawlers follow links out to canonical pages.
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: { title: `${title} · ${site.name}`, url: `${site.url}/search` },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const state = parseSearchState(sp);
  const nav = getNavDestinations();
  const outcome = runSearch(state);

  return (
    <>
      <CovillaHeader destinations={nav} />
      <main className="pt-20">
        <section className="border-b border-line bg-surface">
          <div className="container-page py-12 md:py-16">
            <p className="eyebrow">Find your experience</p>
            <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] md:text-[48px]">
              Search
            </h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-ink-soft">
              Search across every hand-picked experience and destination, then
              refine by price, category, and duration.
            </p>
          </div>
        </section>

        <section className="container-page grid gap-10 py-12 md:grid-cols-[280px_1fr] md:py-16">
          <aside className="md:sticky md:top-24 md:self-start">
            <SearchControls state={state} facets={outcome.facets} />
          </aside>

          <div>
            <p className="eyebrow mb-6" aria-live="polite">
              {outcome.total} {outcome.total === 1 ? "result" : "results"}
              {outcome.query ? ` for “${outcome.query}”` : ""}
            </p>

            {outcome.results.length === 0 ? (
              <EmptyState query={outcome.query} />
            ) : (
              <div className="space-y-6">
                {outcome.results.map((r) => (
                  <ResultCard key={resultKey(r)} result={r} />
                ))}
              </div>
            )}

            {outcome.totalPages > 1 ? (
              <Pagination
                page={outcome.page}
                totalPages={outcome.totalPages}
                searchParams={sp}
              />
            ) : null}
          </div>
        </section>
      </main>

      <CovillaFooter />
      <SearchAnalytics state={state} resultCount={outcome.total} />
    </>
  );
}

function resultKey(r: SearchResult): string {
  return r.type === "experience"
    ? `e:${r.destination.slug}:${r.experience.id}`
    : `d:${r.destination.slug}`;
}

function ResultCard({ result }: { result: SearchResult }) {
  if (result.type === "destination") {
    return <DestinationCard destination={result.destination} />;
  }
  return (
    <ExperienceRowCard
      experience={result.experience}
      destination={{
        slug: result.destination.slug,
        city: result.destination.city,
        country: result.destination.country,
      }}
    />
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-[3px] border border-dashed border-line bg-white/60 px-8 py-16 text-center">
      <SearchX size={32} className="mx-auto text-muted" aria-hidden />
      <p className="mt-4 text-[18px] font-medium text-ink">
        {query ? `No results for “${query}”` : "No results match those filters"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-ink-soft">
        Try a broader term or clear a filter. You can also browse every guide on
        the destinations page.
      </p>
      <Link
        href="/destinations"
        className="mt-6 inline-flex items-center rounded-[2px] border border-accent px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-white"
      >
        Browse destinations
      </Link>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: SP;
}) {
  const href = (p: number) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === "string") usp.set(k, v);
    }
    if (p > 1) usp.set("page", String(p));
    else usp.delete("page");
    const qs = usp.toString();
    return qs ? `/search?${qs}` : "/search";
  };
  return (
    <nav className="mt-10 flex items-center justify-between" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className="eyebrow hover:text-ink">
          ← Previous
        </Link>
      ) : (
        <span className="eyebrow opacity-40">← Previous</span>
      )}
      <span className="text-[13px] text-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className="eyebrow hover:text-ink">
          Next →
        </Link>
      ) : (
        <span className="eyebrow opacity-40">Next →</span>
      )}
    </nav>
  );
}
