# 04 — MVP Scaffold Brief for Claude Code

**Run this from:** `/Users/roymkhabela/Bon voyage ` (note the trailing space in the folder name — quote it in any shell commands: `cd "/Users/roymkhabela/Bon voyage "`)

## Context — read before doing anything

This directory is the root of the real project. It currently contains:
- `docs/01-product-bible.md`, `docs/02-system-architecture-specification.md`, `docs/03-engineering-specification.md`, `docs/README.md` — the full long-term product/architecture/engineering plan for "Atlas," a map-first travel affiliate discovery platform.
- `Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md` — the archival umbrella spec those three derive from.

**Read all three living docs in `docs/` for full context before starting.** But this task is a deliberately narrow slice of that plan, not the full build. Where this brief and those docs disagree on scope, **this brief wins for this task** — it exists specifically to keep you from over-building toward the full milestone set prematurely.

## Why this task exists

Roy needs to apply to the Viator and GetYourGuide affiliate programs. Both are manually reviewed, and reviewers reject thin-content or placeholder/coming-soon sites — they want to see a real, substantive travel content site covering destinations and activities. Nothing like that exists yet. This task builds it.

Once approved, real Viator/GetYourGuide product data will replace the hand-curated placeholder content built here. **Build the placeholder content and structure so that swap is trivial later — this is the real foundation, not a throwaway.**

## What to scaffold

Inside this directory, create a `frontend/` subfolder containing a **Next.js (App Router, TypeScript, Tailwind v4)** app. Final structure:

```
Bon voyage /
├── docs/                  (already exists — do not modify)
├── Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md   (already exists)
└── frontend/              (new — this is what you're building)
```

### 1. Design system — carry it over faithfully, first

Before writing any UI code, inspect this **separate, existing project** (read-only reference — do not modify or import from it directly, it's a different rendering model):

```
/Users/roymkhabela/Tour Curator Site/frontend
```

Specifically:
- `src/styles/default_theme.css`, `globals.css`, `index.css` — design tokens (colors, spacing, radii, etc.)
- `postcss.config.mjs` + its Tailwind v4 Vite plugin setup — reproduce the equivalent config using Next.js's own Tailwind v4 setup
- `index.html` — font pairing: **Fraunces** (display/serif), **Inter**, **Poppins**, via Google Fonts. Preserve this pairing exactly.
- `src/app/HomePage.tsx`, `MobileHome.tsx`, `ResponsiveShell.tsx` — the actual layout/visual patterns (hero treatment, responsive breakpoint behavior, card styling)

Reproduce the *look and feel* faithfully — same brand, same design language — but rebuild components properly as Next.js Server/Client Components rather than lifting the old CSR code wholesale. Libraries worth carrying the same visual vocabulary from: MUI, Radix UI primitives, `lucide-react`, `motion`, `embla-carousel-react`, `react-responsive-masonry`. All work fine in Next.js — use `"use client"` only where actually needed (carousels, motion, interactive dropdowns); everything else stays a Server Component.

### 2. Pages to build

- **Homepage** — presents the site as a real, working travel-discovery product. Not a "notify me" capture page.
- **3–5 destination pages**, starting with **Bangkok** (Roy has direct local knowledge — treat him as a content source; ask him for input on neighborhoods/experiences rather than inventing them), then 2–4 more popular destinations of your choice.
- Each destination page: genuine, substantive, originally-written editorial intro + **6–12 hand-curated "Experience" cards** (title, short description, image, category/intent tag, price band). These are placeholder content — no live affiliate link yet. CTA can read "Coming soon" or be visually present but non-functional. Do not fake a working booking link.
- **Legal pages**: Privacy, Terms, **Disclosure**, Contact — port the content/intent from the old project's `src/app/legal/` folder. The Disclosure page matters for affiliate compliance and must be linked from every page with a CTA.

### 3. Technical SEO (cheap now, expensive to retrofit later)

- Real SSR/SSG rendering (this is the whole reason we're not using the old Vite SPA)
- Unique `<title>` / meta description / OG tags per page
- Single `h1` per page, semantic HTML
- Minimal JSON-LD (`TouristAttraction` or `ItemList`) on destination pages
- Real `sitemap.xml` and `robots.txt`
- **No `noindex, nofollow`** anywhere on these pages — the old site had this set globally; these pages must be crawlable.

## Explicitly out of scope for this task

No map. No search/autocomplete. No auth. No CMS/admin. No live OTA import pipeline. No NestJS backend. No database — hardcode the placeholder content directly in the app (local TS objects, JSON, or MDX; your choice) for now. These arrive later, in the full milestone sequence, once past affiliate approval.

## Definition of done

- `frontend/` runs locally (`next dev`) and is deployable to Vercel.
- 3–5 destination pages live, SSR-rendered, real original content, indexable.
- Visual design consistent with the Figma-derived original at `Tour Curator Site/frontend`.
- Legal/Disclosure pages present and linked from every CTA-bearing page.
- Experience cards structured so dropping in a real affiliate URL later is a one-line prop change, not a rebuild.
- The reference project at `Tour Curator Site/frontend` is untouched.

## Traceability (context, not a constraint)

This task is effectively **ST-1 (project scaffold) + ST-5 (first vertical slice)** from `docs/03-engineering-specification.md`, extended from one hardcoded page to several, partially satisfying **FR-DEST-1/2/3** and **FR-SEO-1** from `docs/02-system-architecture-specification.md`. It intentionally stops well short of the rest of M0–M1.

## Content bar

Destination copy must be genuinely substantive and original — not templated filler. This isn't just an affiliate-review requirement; it's the same bar the project's own later SEO quality gate (`docs/03-engineering-specification.md`, ST-30 — min words, unique summary, real images, ≥3 experiences) will apply. Clearing that bar now means this content doesn't need to be redone later.
