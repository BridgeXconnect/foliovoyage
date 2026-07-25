import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DbExperienceCard } from "@/components/DbExperienceCard";
import { fetchDestination } from "@/lib/api";

/**
 * DB-backed destination page at /destinations/:country/:city
 * (e.g. /destinations/thailand/bangkok) — ST-5 / BRI-100, extended for
 * ST-11 / BRI-164.
 *
 * Data is fetched server-side from the NestJS API (which reads Postgres) —
 * nothing here is hardcoded. For an imported city this renders the DB's
 * **published** Experiences (draft ones stay hidden), paginated, each with its
 * linked Tour's image + price and a "coming soon" CTA placeholder. This route
 * shares the parent `[slug]` segment with the static marketing guides at
 * /destinations/:slug; here that first segment is the country slug, and the
 * static hand-written guides are untouched by this change.
 *
 * `no-store` fetching keeps the route dynamic, so it renders per request and is
 * never prerendered against an API that may be offline at build time.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

type Params = { slug: string; city: string };
type Search = { page?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug: country, city } = await params;
  const destination = await fetchDestination(country, city);
  if (!destination) return { title: "Destination not found" };

  return {
    title: `${destination.city}, ${destination.country} — Things to do`,
    description: `Curated experiences in ${destination.city}, ${destination.country}.`,
  };
}

/** Parse a 1-based page from the query string, defaulting to 1. */
function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

export default async function DestinationBySlugPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { slug: country, city } = await params;
  const page = parsePage((await searchParams).page);

  const destination = await fetchDestination(country, city, {
    page,
    pageSize: PAGE_SIZE,
  });
  if (!destination) notFound();

  const { pagination } = destination;
  const basePath = `/destinations/${country}/${city}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link href="/destinations" className="hover:text-ink">
          Destinations
        </Link>
        <span className="px-2" aria-hidden>
          /
        </span>
        <span>{destination.country}</span>
      </nav>

      <h1 className="font-display text-4xl font-semibold text-ink md:text-5xl">
        {destination.city}
      </h1>
      <p className="mt-2 text-lg text-muted">{destination.country}</p>

      {/* Hero */}
      <div className="relative mt-8 aspect-[16/9] w-full overflow-hidden rounded-xl bg-surface">
        <Image
          src={destination.heroImageUrl}
          alt={destination.heroImageAlt}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover"
        />
      </div>

      {/* Experiences */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          Things to do in {destination.city}
        </h2>

        {destination.experiences.length === 0 ? (
          <p className="mt-6 text-ink-soft">
            No published experiences here yet — check back soon.
          </p>
        ) : (
          <>
            <ul className="mt-6 space-y-6">
              {destination.experiences.map((experience) => (
                <li key={experience.id}>
                  <DbExperienceCard experience={experience} />
                </li>
              ))}
            </ul>

            {pagination.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-between border-t border-line pt-6 text-sm"
              >
                {page > 1 ? (
                  <Link
                    href={`${basePath}?page=${page - 1}`}
                    className="text-accent hover:underline"
                    rel="prev"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="text-muted" aria-disabled>
                    ← Previous
                  </span>
                )}

                <span className="text-muted">
                  Page {pagination.page} of {pagination.totalPages}
                </span>

                {page < pagination.totalPages ? (
                  <Link
                    href={`${basePath}?page=${page + 1}`}
                    className="text-accent hover:underline"
                    rel="next"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="text-muted" aria-disabled>
                    Next →
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
