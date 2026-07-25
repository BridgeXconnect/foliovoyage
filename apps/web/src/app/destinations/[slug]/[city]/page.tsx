import { notFound, permanentRedirect } from "next/navigation";

import { getDestinationSlugs } from "@/data/destinations-helpers";

/**
 * Legacy DB-backed destination alias at /destinations/:country/:city
 * (e.g. /destinations/thailand/bangkok) — BRI-166.
 *
 * The canonical destination surface is the short, editorial `/destinations/:slug`
 * page (Atlas-owned copy, SSG, indexed — see `../page.tsx`). This 3-level
 * country/city shape is the ST-11 ingest path (BRI-164); to give visitors and
 * search engines **one** canonical surface (and keep affiliate analytics from
 * splitting), it is kept only as a permanent alias that **308-redirects** to the
 * canonical short URL.
 *
 * Ownership (docs/02 §1.3, docs/07 "match, don't overwrite"): the canonical page
 * renders Atlas editorial copy, never the provider's title/description that the
 * ST-11 linker seeds onto DB Experiences. The DB read layer (`fetchDestination`
 * in `@/lib/api`, `DbExperienceCard`) is intentionally retained — a follow-up
 * (BRI-168) surfaces the ingested Tour's price/image/affiliateUrl **on the
 * canonical editorial cards**, not on this duplicate URL.
 *
 * The `:city` param is already the canonical city slug (the DB city slug equals
 * the static destination slug), so the redirect target is `/destinations/:city`.
 * A `:city` with no canonical page 404s rather than redirecting into a dead URL.
 */
export default async function LegacyCountryCityRedirect({
  params,
}: {
  params: Promise<{ slug: string; city: string }>;
}) {
  const { city } = await params;
  if (!getDestinationSlugs().includes(city)) notFound();
  permanentRedirect(`/destinations/${city}`);
}
