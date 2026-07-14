import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import {
  BlogPersonaGrid,
  type BlogCard,
} from "@/components/covilla/BlogPersonaGrid";
import { getNavDestinations } from "@/data/destinations-helpers";
import { posts } from "@/data/blog";
import { personas } from "@/data/personas";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "The Folio — Travel notes & guides",
  description:
    "The Folio: original travel writing from Folio Voyage — city notes, planning tips, and the thinking behind our curation, filtered by how you travel.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: `The Folio · ${site.name}`,
    description:
      "Original travel writing from Folio Voyage — city notes, planning tips, and how we curate.",
    url: `${site.url}/blog`,
  },
};

export default function BlogIndexPage() {
  const nav = getNavDestinations();
  const featured = posts[0];
  const popular = posts.slice(1, 5);

  const cards: BlogCard[] = posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    image: p.image,
    imageAlt: p.imageAlt,
    displayDate: p.displayDate,
    category: p.category,
    personas: p.personas,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "The Folio",
    url: `${site.url}/blog`,
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      datePublished: p.date,
      url: `${site.url}/blog/${p.slug}`,
    })),
  };

  return (
    <>
      <CovillaHeader destinations={nav} transparent />
      <main>
        {/* Hero band */}
        <section className="relative flex min-h-[62vh] items-center overflow-hidden">
          <Image
            src={featured.image}
            alt={featured.imageAlt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-overlay/60" />
          <div className="container-page relative z-10 py-28 text-center text-white">
            <p className="eyebrow !text-white/70">The Folio</p>
            <h1 className="mx-auto mt-4 max-w-3xl font-display text-[40px] font-semibold leading-[1.08] text-white md:text-[60px]">
              Inspiration and tips for your next trip
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-8 text-white/85">
              Original writing from Folio Voyage — city notes, planning tips, and
              the thinking behind how we curate.
            </p>
          </div>
        </section>

        {/* Featured post + popular posts */}
        <section className="container-page py-16 md:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr] lg:gap-16">
            {/* Featured */}
            <Link href={`/blog/${featured.slug}`} className="group block">
              <div className="relative aspect-[16/11] overflow-hidden rounded-[10px]">
                <Image
                  src={featured.image}
                  alt={featured.imageAlt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-x-5 bottom-5 rounded-[8px] bg-white p-6 shadow-lg md:inset-x-8 md:bottom-8 md:max-w-md md:p-8">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                    {featured.displayDate} · {featured.category}
                  </p>
                  <h2 className="mt-2 font-display text-[24px] font-semibold leading-snug md:text-[28px]">
                    {featured.title}
                  </h2>
                  <p className="mt-3 text-[14px] leading-6 text-ink-soft">
                    {featured.excerpt}
                  </p>
                  <span className="mt-5 inline-block text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
                    Read more →
                  </span>
                </div>
              </div>
            </Link>

            {/* Popular posts list */}
            <div>
              <div className="flex items-center gap-5">
                <p className="eyebrow whitespace-nowrap">Popular posts</p>
                <span className="h-px flex-1 bg-line" />
              </div>
              <ul className="mt-8 space-y-6">
                {popular.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/blog/${p.slug}`}
                      className="group flex items-center gap-5"
                    >
                      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-[6px]">
                        <Image
                          src={p.image}
                          alt={p.imageAlt}
                          fill
                          sizes="96px"
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                          {p.displayDate}
                        </p>
                        <h3 className="mt-1 font-display text-[16px] font-medium leading-snug group-hover:text-accent">
                          {p.title}
                        </h3>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Browse the folio — persona-filtered grid */}
        <section className="border-t border-line bg-surface">
          <div className="container-page py-16 md:py-24">
            <BlogPersonaGrid cards={cards} personas={personas} />
          </div>
        </section>
      </main>
      <CovillaFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
