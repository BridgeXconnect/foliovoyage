import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  // Compile the shared workspace package (TypeScript source) as part of the app.
  transpilePackages: ["@folio/shared"],
  images: {
    // Marketing imagery is self-hosted under /public/images. The ST-5 vertical
    // slice serves a Wikimedia Commons hero from the seeded DB row. ST-11's
    // DB-backed city pages surface real Viator product imagery, which Viator
    // serves from the TripAdvisor media CDN (several subdomains, e.g.
    // media-cdn / dynamic-media-cdn.tripadvisor.com) — allow the family.
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "**.tripadvisor.com" },
    ],
  },
};

export default nextConfig;
