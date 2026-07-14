/**
 * Central site configuration.
 *
 * `url` resolution order (all server-side; `site.url` is only consumed in
 * Server Components — metadata, sitemap, robots, JSON-LD):
 *   1. NEXT_PUBLIC_SITE_URL      — the canonical custom domain. Set this in
 *      Vercel → Project Settings → Environment Variables (Production) to your
 *      real domain. This is the intended value.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's stable *.vercel.app domain,
 *      injected automatically by Vercel. A safety net so a forgotten env var can
 *      never ship localhost canonical/OG/sitemap URLs to production.
 *   3. http://localhost:3000     — local development fallback only.
 *
 * The resolved value is then normalised to the PRIMARY host. Production is
 * served on www.foliovoyage.com — Vercel 308-redirects the apex
 * (foliovoyage.com) to www — so canonical / OG / sitemap / robots URLs must use
 * the www host. Otherwise they point at a URL that itself redirects, which is a
 * weak SEO signal (a canonical should be the final, non-redirecting URL). This
 * forces www for our apex regardless of how the env var is written, and leaves
 * *.vercel.app and localhost untouched.
 */
const APEX_HOST = "foliovoyage.com";
const PRIMARY_HOST = "www.foliovoyage.com";

function normalisePrimaryHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === APEX_HOST) u.hostname = PRIMARY_HOST;
    return u.origin;
  } catch {
    return rawUrl.replace(/\/$/, "");
  }
}

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return normalisePrimaryHost(explicit);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return normalisePrimaryHost(`https://${vercel}`);

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
