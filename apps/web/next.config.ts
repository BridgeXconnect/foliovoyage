import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the shared workspace package (TypeScript source) as part of the app.
  transpilePackages: ["@folio/shared"],
  // Placeholder imagery is self-hosted under /public/images, so no remote image
  // hosts are needed. When real Viator/GetYourGuide product imagery lands,
  // add its CDN host(s) to images.remotePatterns here.
};

export default nextConfig;
