import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CovillaHeader } from "@/components/covilla/CovillaHeader";
import { CovillaFooter } from "@/components/covilla/CovillaFooter";
import { PromiseBand } from "@/components/covilla/PromiseBand";
import {
  getNavDestinations,
  getDestination,
} from "@/data/destinations-helpers";
import { posts, getPost, FOLIO_AUTHOR } from "@/data/blog";
import { getPersona } from "@/data/personas";
import { site } from "@/lib/site";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.excerpt,
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: {
      type: "article",
      title: `${p.title} · ${site.name}`,
      description: p.excerpt,
      url: `${site.url}/blog/${p.slug}`,
      images: [{ url: p.image, alt: p.imageAlt }],
      publishedTime: p.date,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) notFound();

  const nav = getNavDestinations();
  const more = posts.filter((x) => x.slug !== p.slug).slice(0, 3);
  const featured = p.featuredDestination
    ? getDestination(p.featuredDestination)
    : undefined;
  const personaTags = p.personas
    .map((id) => getPersona(id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const [lead, ...rest] = p.body;

  const author = p.author ?? FOLIO_AUTHOR;
  const reviewedDisplay = new Date(p.lastReviewed).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title,
    description: p.excerpt,
    datePublished: p.date,
    dateModified: p.lastReviewed,
    image: `${site.url}${p.image}`,
    url: `${site.url}/blog/${p.slug}`,
    mainEntityOfPage: `${site.url}/blog/${p.slug}`,
    author: {
      "@type": "Organization",
      name: author.name,
      description: author.bio,
      url: `${site.url}${author.url}`,
    },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: site.url,
      logo: { "@type": "ImageObject", url: `${site.url}/icon.svg` },
    },
  };

  return (
    <>
      <CovillaHeader destinations={nav} transparent />
      <main>
        {/* Full-bleed title hero */}
        <section className="relative flex min-h-[70vh] items-center overflow-hidden">
          <Image
            src={p.image}
            alt={p.imageAlt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-overlay/60" />
          <div className="container-page relative z-10 py-28 text-center text-white">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/70">
              {p.displayDate} · {p.category} · {p.readingTime}
            </p>
            <h1 className="mx-auto mt-4 max-w-3xl font-display text-[38px] font-semibold leading-[1.08] text-white md:text-[58px]">
              {p.title}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[13px] text-white/75">
              <span className="text-white/90">By </span>
              <Link
                href={author.url}
                className="font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white"
              >
                {author.name}
              </Link>
              <span className="mx-2" aria-hidden>
                ·
              </span>
              Last reviewed {reviewedDisplay}
            </p>
          </div>
        </section>

        {/* Content block: sticky featured card + article body */}
        <section className="container-page py-16 md:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.6fr] lg:gap-16">
            {/* Featured sidebar */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              {featured && (
                <Link
                  href={`/destinations/${featured.slug}`}
                  className="group block overflow-hidden rounded-[10px] border border-line bg-white"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <Image
                      src={featured.heroImage}
                      alt={featured.heroImageAlt}
                      fill
                      sizes="(max-width: 1024px) 100vw, 30vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-ink">
                      Featured guide
                    </span>
                  </div>
                  <div className="p-6">
                    <h2 className="font-display text-[20px] font-semibold">
                      {featured.city}
                    </h2>
                    <p className="mt-1 text-[13px] text-muted">
                      {featured.country}
                    </p>
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                          Rates from
                        </p>
                        <p className="text-[15px] font-medium text-ink">
                          ${featured.fromPrice.toLocaleString("en-US")}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                        Explore <ArrowUpRight size={14} />
                      </span>
                    </div>
                  </div>
                </Link>
              )}

              {personaTags.length > 0 && (
                <div className="mt-8">
                  <p className="eyebrow">Good for</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {personaTags.map((t) => (
                      <li
                        key={t.id}
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-soft"
                      >
                        {t.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>

            {/* Article body */}
            <article>
              <p className="text-[19px] leading-8 text-ink">{lead}</p>

              <blockquote className="my-9 rounded-[8px] bg-surface p-7 text-[18px] leading-8 text-ink-soft md:p-9">
                “{p.excerpt}”
              </blockquote>

              <div className="space-y-6 text-[18px] leading-8 text-ink-soft">
                {rest.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>

              {/* Author / trust box — E-E-A-T authorship signal */}
              <div className="mt-12 rounded-[10px] border border-line bg-surface p-6">
                <p className="eyebrow">About the author</p>
                <p className="mt-2 text-[15px] font-medium text-ink">
                  {author.name}
                </p>
                <p className="mt-1 text-[14px] leading-6 text-ink-soft">
                  {author.bio}
                </p>
                <p className="mt-4 text-[13px] leading-6 text-muted">
                  Written independently and last reviewed {reviewedDisplay}.
                  Folio Voyage is reader-supported — see our{" "}
                  <Link href="/legal/disclosure" className="text-accent underline">
                    affiliate disclosure
                  </Link>{" "}
                  or{" "}
                  <Link href="/legal/contact" className="text-accent underline">
                    get in touch
                  </Link>
                  .
                </p>
              </div>
            </article>
          </div>
        </section>

        <PromiseBand />

        {/* Keep reading */}
        <section className="border-t border-line bg-surface">
          <div className="container-page py-16">
            <div className="flex items-center gap-5">
              <p className="eyebrow whitespace-nowrap">Keep reading</p>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-8 grid gap-8 sm:grid-cols-3">
              {more.map((m) => (
                <Link
                  key={m.slug}
                  href={`/blog/${m.slug}`}
                  className="group flex flex-col overflow-hidden rounded-[8px] border border-line bg-white"
                >
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <Image
                      src={m.image}
                      alt={m.imageAlt}
                      fill
                      sizes="(max-width: 640px) 100vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-5">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
                      {m.displayDate}
                    </p>
                    <h3 className="mt-1 font-display text-[17px] font-medium leading-snug group-hover:text-accent">
                      {m.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
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
