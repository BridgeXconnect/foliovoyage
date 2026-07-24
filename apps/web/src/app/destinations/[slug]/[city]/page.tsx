import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchDestination } from "@/lib/api";

/**
 * ST-5 / BRI-100 — first vertical slice: a server-rendered destination page at
 * /destinations/:country/:city (e.g. /destinations/france/paris).
 *
 * Data is fetched server-side from the NestJS API (which reads one seeded
 * Postgres row) — nothing here is hardcoded. This route shares the parent
 * `[slug]` dynamic segment with the marketing city guides at
 * /destinations/:slug; here that first segment is the country slug.
 *
 * `no-store` fetching keeps the route dynamic, so it renders per request and is
 * never prerendered against an API that may be offline at build time.
 */
export const dynamic = "force-dynamic";

type Params = { slug: string; city: string };

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

export default async function DestinationBySlugPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug: country, city } = await params;
  const destination = await fetchDestination(country, city);
  if (!destination) notFound();

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
        <ul className="mt-6 space-y-6">
          {destination.experiences.map((experience) => (
            <li
              key={experience.id}
              className="border-b border-line pb-6 last:border-b-0"
            >
              <h3 className="font-display text-lg font-medium text-ink">
                {experience.title}
              </h3>
              <p className="mt-1 text-ink-soft">{experience.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
