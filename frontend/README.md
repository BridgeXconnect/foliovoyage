# Folio Voyage — frontend

A map-first travel discovery product ("Atlas" in the planning docs), here scaffolded
as its first substantive, indexable content slice: a real travel-content site built to
pass Viator / GetYourGuide affiliate review. See `../docs/04-mvp-scaffold-brief.md` for
the task brief and `../docs/` for the full product/architecture/engineering plan.

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS v4** (CSS-first config in `src/app/globals.css`)
- **next/font** — Fraunces (display serif wordmark) / Poppins (headings) / Inter (body)
- `lucide-react` icons; `clsx` + `tailwind-merge` for class composition

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (all pages SSG-prerendered)
npm start          # serve the production build
```

Deployable to Vercel as-is. Set `NEXT_PUBLIC_SITE_URL` to the real domain in
production so metadata, canonical URLs, `sitemap.xml`, and `robots.txt` resolve
correctly (see `.env.example`).

## Structure

```
src/
├── app/
│   ├── page.tsx                     Homepage (product landing)
│   ├── destinations/page.tsx        Destination index
│   ├── destinations/[slug]/page.tsx Destination guide — SSG, per-page metadata + JSON-LD
│   ├── legal/{privacy,terms,disclosure,contact}/  Legal pages
│   ├── image-credits/page.tsx       CC attribution for placeholder imagery (noindex)
│   ├── sitemap.ts · robots.ts       SEO infra
│   ├── layout.tsx · globals.css     Root layout, fonts, design tokens
│   └── icon.svg                     Favicon
├── components/                      Header, footer, cards, feature grid, CTA banner
├── data/
│   ├── types.ts                     Content model (Destination, Experience)
│   ├── destinations.ts              Hand-written editorial + curated experiences (6 cities)
│   ├── media.ts                     Maps image keys → /public/images/<key>.jpg
│   └── credits.json                 Generated image attribution
└── lib/                             Site config + cn() helper
scripts/                            One-off Wikimedia image resolver/downloader (see below)
```

## The affiliate-swap seam (important)

Placeholder experiences render a non-functional **"Booking coming soon"** state. No
fake booking links are ever shown. When Viator / GetYourGuide are approved, add
`affiliateUrl` (and `provider`) to an `Experience` in `src/data/destinations.ts`:

```ts
{
  id: "grand-palace-wat-phra-kaew",
  title: "The Grand Palace & Wat Phra Kaew",
  // ...
  affiliateUrl: "https://www.viator.com/...?pid=YOUR_AFFILIATE_ID",
  provider: "Viator",
}
```

That one change flips the card CTA to a live, disclosed `rel="sponsored nofollow"`
booking link (`src/components/ExperienceCard.tsx`). The whole content layer is
structured so the eventual swap from hand-curated to real OTA product data is a data
change, not a rebuild.

## Content

Six destinations — **Bangkok, Kyoto, Lisbon, Rome, Hanoi, Bali** — each with an
original editorial intro and 8 hand-written experience cards. Bangkok is drafted from
Roy's local knowledge and is the first to refine.

## Placeholder imagery

Photography is self-hosted in `public/images/` (downloaded from Wikimedia Commons,
credited in `src/data/credits.json` and on `/image-credits`). The `scripts/` folder
holds the one-off resolver/downloader used to fetch them; not part of the runtime.
Replace with licensed provider imagery before launch.
