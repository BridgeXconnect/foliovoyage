import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the shared workspace package (TypeScript source) as part of the app.
  transpilePackages: ["@folio/shared"],
  images: {
    // Marketing imagery is self-hosted under /public/images. The ST-5 vertical
    // slice serves a Wikimedia Commons hero from the seeded DB row, so allow
    // that host. When real Viator/GetYourGuide product imagery lands, add its
    // CDN host(s) here too.
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
    ],
  },
};

export default nextConfig;
