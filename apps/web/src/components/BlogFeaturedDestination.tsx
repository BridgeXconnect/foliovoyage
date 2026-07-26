"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import posthog from "posthog-js";

type FeaturedDestination = {
  slug: string;
  city: string;
  country: string;
  heroImage: string;
  heroImageAlt: string;
  fromPrice: number;
};

export function BlogFeaturedDestination({
  featured,
  blogSlug,
}: {
  featured: FeaturedDestination;
  blogSlug: string;
}) {
  return (
    <Link
      href={`/destinations/${featured.slug}`}
      onClick={() =>
        posthog.capture("blog_featured_destination_clicked", {
          destination_slug: featured.slug,
          city: featured.city,
          country: featured.country,
          blog_slug: blogSlug,
        })
      }
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
        <h2 className="font-display text-[20px] font-semibold">{featured.city}</h2>
        <p className="mt-1 text-[13px] text-muted">{featured.country}</p>
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
  );
}
