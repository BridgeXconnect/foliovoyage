import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "./Reveal";
import { posts } from "@/data/blog";

/** "The Folio" blog band (adapted from Covilla's journal): featured post + list. */
export function BlogSection() {
  const [featured, ...rest] = posts;
  const list = rest.slice(0, 4);

  return (
    <section className="border-t border-line bg-surface">
      <div className="container-page py-24 md:py-32">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">The Folio</p>
            <h2 className="mt-4 text-[32px] font-semibold leading-[1.1] md:text-[46px]">
              Notes from the road
            </h2>
          </div>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
          >
            All posts <ArrowUpRight size={15} />
          </Link>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_1fr]">
          {/* Featured */}
          <Reveal>
            <Link
              href={`/blog/${featured.slug}`}
              className="group block overflow-hidden rounded-[3px] border border-line bg-white"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image
                  src={featured.image}
                  alt={featured.imageAlt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </div>
              <div className="p-8">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                  {featured.displayDate} · {featured.category}
                </p>
                <h3 className="mt-3 font-display text-[26px] font-semibold leading-tight md:text-[30px]">
                  {featured.title}
                </h3>
                <p className="mt-3 max-w-xl text-[15px] leading-7 text-ink-soft">
                  {featured.excerpt}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-accent">
                  Read more <ArrowUpRight size={15} />
                </span>
              </div>
            </Link>
          </Reveal>

          {/* Popular posts list */}
          <div>
            <p className="eyebrow">Popular posts</p>
            <ul className="mt-6 space-y-5">
              {list.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group flex gap-5 border-b border-line pb-5"
                  >
                    <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-[3px]">
                      <Image
                        src={p.image}
                        alt={p.imageAlt}
                        fill
                        sizes="80px"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
                        {p.displayDate}
                      </p>
                      <h4 className="mt-1 font-display text-[17px] font-medium leading-snug text-ink transition-colors group-hover:text-accent">
                        {p.title}
                      </h4>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
