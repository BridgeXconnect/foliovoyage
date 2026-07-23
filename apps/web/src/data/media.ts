/**
 * Placeholder imagery is self-hosted under /public/images/<key>.jpg
 * (downloaded from Wikimedia Commons by scripts/download-images.mjs, with
 * credits captured in credits.json). Serving locally keeps the site fast and
 * free of any runtime dependency on third-party image hosts.
 *
 * `IMG.<key>` resolves to the local path for that subject; when real provider
 * imagery arrives, swap these paths (or point back at a CDN) in one place.
 */
export const IMG: Record<string, string> = new Proxy(
  {},
  {
    get: (_target, prop: string) => `/images/${prop}.jpg`,
  },
);

export const HOME_HERO = {
  src: "/images/home_hero.jpg",
  alt: "Whitewashed cliffside houses above the caldera at sunset in Oia, Santorini",
};
