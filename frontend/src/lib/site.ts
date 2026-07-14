/**
 * Central site configuration.
 *
 * `url` resolution order (all server-side; `site.url` is only consumed in
 * Server Components — metadata, sitemap, robots, JSON-LD):
 *   1. NEXT_PUBLIC_SITE_URL      — the canonical custom domain. Set this in
 *      Vercel → Project Settings → Environment Variables (Production) to your
 *      real domain, e.g. https://foliovoyage.com. This is the intended value.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's stable *.vercel.app domain,
 *      injected automatically by Vercel. A safety net so a forgotten env var can
 *      never ship localhost canonical/OG/sitemap URLs to production.
 *   3. http://localhost:3000     — local development fallback only.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

export const site = {
  name: "Folio Voyage",
  tagline: "A curated travel folio",
  description:
    "Folio Voyage is a hand-picked travel folio — original city guides and vetted tours and experiences across the world's most rewarding destinations.",
  url: resolveSiteUrl(),
  email: "hello@foliovoyage.com",
  partnersEmail: "partners@foliovoyage.com",
} as const;

export type Site = typeof site;
