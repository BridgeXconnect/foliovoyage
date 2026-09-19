# Content Engine Strategy: From Idea to Findable Page

> **This is a research and planning document, not an implementation plan.** It has no code tasks on purpose. Nothing here changes `schema.prisma`, opens a PR, edits Linear, or deploys. Each section ends in a recommendation you can accept, change, or skip, plus the decisions that are yours to make.

**Goal:** Work out what it takes for an idea to become a published, findable page on this stack, from first principles, before any tool is chosen. Then compare the real options for each stage against your actual constraints (solo operator, cost conscious, schema minimalism, a Viator catalogue of about 30,000 tours) and say where the answer is clear and where it is your call.

**Architecture of this document:** Section 0 re reads the repo record and shows what the product bible and specs already say and do not say. Sections 1 to 10 are the sub problems, in the order an idea travels: opportunity, competition, page type and brief, generation, storage, delivery, internal links, technical markup, index scope, feedback. Each section lists two to four real options, weighs them against the constraints, and ends in a recommendation. Section 11 reconciles this work with the BRI-200, BRI-201 and BRI-202 research. Section 12 is the decision register: the forks only you can settle.

## How to read the tags

Every factual statement carries a tag.

- **[V]** means verified. Either against this repo (cited as a path, and a line where useful), against Linear read in this session, or against an external page I fetched and read in this session (linked).
- **[V, search summary]** means the fact reached me only as a search result summary, not from the primary page. Treat it as likely true, and re check it before you spend money on it.
- **[I]** means inference, judgment or recommendation. It might be well reasoned, but I did not verify it directly. Numbers I computed from verified prices are tagged [I] and name their inputs.

Where a Linear ticket or a spec says something that no longer holds, the text says **Correction** in bold.

## What I touched while researching (full disclosure)

- **Repo, read only.** `docs/01`, `docs/02`, `docs/03`, `docs/06` to `docs/10`, `docs/13`, `apps/web` routes and data, `apps/api/prisma/schema.prisma`, the import module listing, and both `AGENTS.md` files. [V]
- **Linear, read only.** BRI-114, 118, 120, 140, 142, 143, 152, 153, 154, 200, 201, 202, plus keyword searches for R2, SEO and catalogue tickets. I changed nothing. [V]
- **A sibling worktree, read only.** The BRI-200/201/202 research document is not committed. It exists as an untracked file at `.claude/worktrees/tour-image-gallery-capture-6b7fa4/docs/superpowers/plans/2026-09-19-content-engine-research.md` on branch `stewie/content-engine-research-2dc773`. I read it so this document can reconcile with it. I did not copy or edit it. [V]
- **Production database.** Not queried in this session. Every catalogue number here (30,132 tours, fill rates, the 773 duplicate titles) is quoted from that research document, which ran the queries on 2026-09-19. [V that the document says so, I that they are still current]
- **The web.** Search and page fetches only. No accounts, no sign ups, no API keys used, nothing purchased. [V]
- **Files written.** This document only. [V]

## Headline findings

1. **Your suspicion was right: the specs only scratched the surface.** Across `docs/01`, `docs/02` and `docs/03`, the word "keyword" appears once, "Search Console" and "editorial calendar" never, and there is no method for finding demand, reading a results page, briefing a page, linking pages, or measuring what worked. What they do contain is a useful page type list (section 0.1). [V]
2. **The real strategic question is not "which tool", it is "which pages are allowed to be indexed".** At about 30,000 tours the catalogue can produce far more pages than Google will reward. Google's August 2026 spam update hit a site with 1.5 million indexed URLs at site level, even though some of its content was human written. [V, gsqi case study] Thin tour pages can therefore drag down the hub pages that should earn the traffic. Sections 3 and 9 build on this. [I for the consequence]
3. **Per tour AI copy (BRI-154) is a conversion and completeness tool, not the SEO engine.** The pages that can rank for a demand shaped query are hubs (city, category, attraction), and they need Atlas owned value that no ticket covers yet: aggregated facts and curation, plus a small amount of hand written voice. Hub copy is a gap in the current backlog. [I, with the gap itself [V]]
4. **Keyword data is cheap. Time is the cost.** A first pass over the six live cities costs well under $10 on a pay per call API (section 1.4). No subscription is justified. [I, from [V] prices]
5. **You do not need a CMS today.** Machine written tour copy belongs in Postgres. Human written guides fit as files in the repo until volume or contributors change. The one CMS that fits a solo operator if that changes is Sanity. [I, with the limits behind it [V]]
6. **Two constraints surfaced that no ticket mentions.** Vercel's Hobby plan is for non commercial use only, so an affiliate site needs Pro at launch. [V] Viator requires its reviews to be rendered not indexable by search engines, which matters for any copy or markup built from them. [V]
7. **Several open questions can only be answered by Viator.** Nothing I found says whether AI derived copy from product content is permitted. It is in the decision register (F5). [V that I found nothing, I for the risk]

---

## Section 0: Requirements from the repo record

### 0.1 What the specs cover and do not cover

| Topic | Where | What it says | What is missing |
| --- | --- | --- | --- |
| Business goal | `docs/01` lines 41 to 43 | BG-1 is 25,000 organic sessions a month, BG-2 is the first $1,000 of commission, BG-3 is 50,000 plus tours and 100 plus cities [V] | No link from a traffic goal to a page count, a keyword set, or a timeline [V that none exists] |
| SEO architecture | `docs/02` §11, lines 388 to 398 | Clean URLs, programmatic pages from structured data, JSON-LD types, on page rules, sharded sitemap, `robots.txt` disallowing `/go/*`, and a quality gate before indexing [V] | No demand method, no results page analysis, no page brief, no internal linking rules beyond the phrase "topical internal linking", no measurement [V] |
| Page type list | `docs/02` line 391 | "Things to do in {city}", "{category} in {city}", "Best {tag} in {city}", "Best time to visit {city}", plus collections [V] | No check that anyone searches for these, and no priority order [V that none exists] |
| Quality gate | `docs/02` line 397, ST-30 (BRI-142) | Minimum words, unique summary, at least one image, at least three experiences, else `noindex` [V] | Not built. The BRI-200/201/202 research shows it needs to read BRI-200's outcome [V] |
| AI content | `docs/02` §12, line 406, ST-42 | "Human approval before publish", drafts until promoted [V] | **Correction.** BRI-154 and BRI-120 superseded this on 2026-09-19 with automated, gated publishing. `docs/02` was not updated [V] |
| CMS | `docs/02` §13.1, line 413, FR-CMS-1 and 2 | Guides as markdown with SEO fields, states `draft`, `in_review`, `scheduled`, `published`, `updated`, `archived`, publish triggers cache invalidation and sitemap regeneration [V] | No tool choice, no volume estimate, no statement of who authors. FR-CMS-1's tour approval half is gone with BRI-150, which is canceled [V] |
| Admin | `docs/02` §13.2, line 416 | A planned `admin.<domain>` dashboard, noindex, auth gated [V] | Not built. It matters because a CMS would duplicate it (section 5) [I] |
| Rendering | `docs/02` line 453 | "SSG for stable pages (revalidate on publish)" [V] | No detail on how that works for a database backed catalogue of 30,000 pages [V that none exists] |
| Information architecture | `docs/01` lines 162 to 163 | `/collections` and `/guides` routes exist in the plan [V] | Both are placeholder pages today (section 0.2) [V] |
| E-E-A-T | `docs/06`, `docs/08`, `docs/09` | Voice rules, the honesty guardrail, "vetted" not "written by hand" [V] | Written for six hand authored destinations. Nothing says how the voice carries into machine written copy except BRI-154's grounding rule [V] |

### 0.2 What the repo does today

| Fact | Source |
| --- | --- |
| Six destinations are hand authored in one 42 KB file (`bangkok`, `kyoto`, `lisbon`, `rome`, `hanoi`, `bali`) and are the canonical `/destinations/:slug` pages | `apps/web/src/data/destinations.ts` [V] |
| Those pages are fully static: `generateStaticParams` plus `dynamicParams = false`, with no `revalidate` anywhere in `apps/web/src` | `destinations/[slug]/page.tsx` lines 24 to 28, and a grep of `apps/web/src` [V] |
| The DB backed path `/destinations/:country/:city` only 308 redirects to the canonical page. It renders nothing | `apps/web/AGENTS.md`, FR-DEST-6 in `docs/02` line 92 [V] |
| FR-DEST-6 says provider title and description "are never the canonical public copy". The 30,000 imported tours therefore have no editorial layer yet, which is the gap BRI-154 fills | `docs/02` line 92 [V for the text, I for the reading] |
| `/guides` is a "coming soon" page | `apps/web/src/app/guides/page.tsx` [V] |
| The sitemap lists static routes, the six destinations and static experience pages, all with `lastModified: now`. No DB pages | `apps/web/src/app/sitemap.ts` [V] |
| `robots.ts` is `force-dynamic` and disallows everything while the pre launch gate password is set | `apps/web/src/app/robots.ts` [V] |
| Next.js is `^15.5.20` | `apps/web/package.json` [V] |
| Production holds about 30,132 tours and 30,137 Experiences. Only 2,317 tours (7.7%) carry gallery, inclusions and cancellation data | The BRI-200/201/202 research, section 1.1 [V that it says so] |
| `Experience` has no slug, no AI summary and no SEO fields. The schema convention is to resist growing it | `apps/api/prisma/schema.prisma`, `docs/02` §1.3 [V] |
| Viator's `/attractions/search` is not referenced anywhere in the repo. Tag name resolution through `/products/tags` appears only in comments as a deferred follow up. Tags are stored as raw numeric ids | A grep of `apps/api/src`, `apps/web/src` and `apps/web/scripts` (one comment hit in `normalizer.ts` line 118), and `schema.prisma` lines 226 to 228 [V] |

### 0.3 Constraints that shape every decision

- **Solo operator.** You author, review and decide. Claude Code agents write and edit files alongside you. There is no editorial team. [I, from your stated setup and the BRI-154 decision that you do not want to curate individual tours]
- **Cost consciousness.** The R2 archive already grew to about 32 GB with no lifecycle rule (BRI-196), the dev and prod buckets were shared (BRI-194), and a Render bandwidth overrun forced a platform move (BRI-177). [V] Recurring subscriptions need a strong reason.
- **Schema minimalism.** Every new column or table is a standing cost. Prefer derived values and files over new tables. [V that this is the convention, I for how it applies here]
- **No deploy without your go ahead.** Everything here is design. [V, `AGENTS.md`]
- **Viator is the only provider and the terms matter.** See sections 4 and 8. [V]
- **Google policy.** AI generated content is not banned. Scaled content without added value is. See section 3. [V]

### 0.4 The requirement in one paragraph

The engine has to find queries that real people type and that Atlas can serve better than an aggregator page, decide which page types answer them, produce pages that carry value beyond Viator's own text, store and version that content cheaply, put it live on Next.js and Vercel without rebuilding the site, connect the pages to each other, mark them up correctly, let only the pages that deserve it into Google's index, and then learn from traffic and clicks which pages to make next. [I]

---

## Section 1: Opportunity, keyword and intent discovery

### 1.1 What is actually needed

A ranked list of candidate pages, each with a target query, an intent class (browse, compare, book), and rough demand. Your page type list (section 0.1) already gives the query shapes. What is missing is which cities, categories and attractions have demand, and which are worth a page. [I]

**Your catalogue is a demand map in disguise.** Viator's API exposes, per destination, attractions with product counts, ratings and reviews, and a tag taxonomy with parent and child tags. Viator names attraction pages as an intended use: "a page that just promotes tours of the Colosseum". [V: <https://partnerresources.viator.com/travel-commerce/technical-guide/>, read through a page summary] Attraction and tag data must be cached and refreshed weekly. [V, same page] So supply side candidates are free. What the catalogue cannot tell you is search demand. [I]

### 1.2 The options

**Option A. No keyword vendor, derive candidates from Viator only.** Pull attractions and tags per curated city, and rank by product count and rating.
- Pros: free, and already tied to what you can sell. [I]
- Cons: it measures supply, not demand. A city may have 40 attractions and only 3 that people search for. [I]

**Option B. Google's own sources.** Two free ones.
- *Keyword Planner through the Google Ads API.* It returns keyword ideas and historical metrics and needs Basic access. It is rate limited more tightly than other services, and historical metrics refresh monthly, so Google says to cache results. [V: <https://developers.google.com/google-ads/api/docs/keyword-planning/overview>] It needs an Ads account with a payment method on file but no ad spend. [V, search summary] Whether an account with no spend gets exact volumes or only bucketed ranges was not confirmed. [I, verify with one call]
- *Search Console API.* It returns queries, clicks, impressions and position for a property you own. It returns at most 25,000 rows per request and 50,000 rows per day per search type. [V: <https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data>] It shows nothing until the site is live and indexed, so it feeds section 10, not this stage. [I]

**Option C. A pay per call keyword API (DataForSEO).** Labs endpoints (ideas, suggestions, related keywords, bulk keyword difficulty, search intent, ranked keywords) cost $0.012 per task plus $0.00012 per item, about $132 per million items. An optional clickstream flag doubles the cost. [V: <https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api>] The page did not state a minimum deposit, so check before paying. [I]

**Option D. A subscription suite with an API (Semrush, Ahrefs).**
- Semrush: API access sits on a plan costing about $455 to $549 a month, plus API units bought separately at a price Semrush does not publish. [V, search summary]
- Ahrefs: I could not confirm API pricing. The API docs home mentions free test queries and an Enterprise plan, which suggests full access is tied to Enterprise. [V that the page says so, I for the reading]
- Fit: built for teams doing manual research in a dashboard. A monthly floor of that size buys little for a keyword set this small. [I]

### 1.3 Comparison against your constraints

| Option | Money | Your time | Answers "is there demand" | Verdict |
| --- | --- | --- | --- | --- |
| A. Viator only | $0 | Low | No | Use for candidates, not for validation [I] |
| B. Keyword Planner | $0 | Medium (Ads account, developer token, approval) | Yes, if volumes are exact [I] | Good free backup, more setup than it saves [I] |
| C. DataForSEO | Cents per run | Low (one HTTP call per batch) | Yes | Best fit [I] |
| D. Semrush or Ahrefs | $455 a month or more | Low | Yes | Not justified at this scale [I] |

### 1.4 What it costs to do this properly

Candidates: about 150 per city (query patterns from section 0.1 crossed with the top attractions and tags). Prices from 1.2. [I, arithmetic]

| Job | Volume | Cost |
| --- | --- | --- |
| Volume, difficulty and intent for the six live cities | 6 x 150 = 900 keywords, one task | $0.012 + 900 x $0.00012 = about $0.12 |
| The same for a future 100 cities | 30,000 keywords, 30 tasks of 1,000 | about $4 |
| Live results pages for the head queries (see section 2) | 300 pages at $0.0006 standard or $0.002 live | $0.18 to $0.60 |

### 1.5 Recommendation

**A clear answer: use Option A to build the candidate list, then Option C to validate it in one batch, and skip Option D.** Cap the spend at a monthly figure you set (F4 suggests $25). Treat Search Console as the long run source once the site is indexed. Keep Keyword Planner as a free fallback only if the DataForSEO deposit terms bother you. [I]

One extra use: **the same candidate list can rank which cities to add next**, since catalogue expansion is on hold (BRI-202). Demand times catalogue depth is a better order than taste alone. [I]

Decision point: F4 (budget ceiling) is yours, but the cost is small enough that it is a formality.

---

## Section 2: Results page and competitive landscape

### 2.1 What is actually needed

For each target query, an answer to: who ranks, what type of page are they, and is there a gap Atlas can fill? The risk is a page type whose results are all large marketplaces. [I]

### 2.2 What I could and could not establish

- Viator, GetYourGuide and Klook aggregate hundreds of thousands of experiences, and Viator is owned by Tripadvisor. [V, search summary] That says these sites are large. It does not say how they fill the results for "things to do in {city}". **I could not verify the actual composition of those results pages.** Practitioner writing on small travel affiliate sites against these giants was thin and mostly promotional. [V that I searched and found little, I for the limit]
- Google's own guidance says affiliate content earns its place through "original product reviews, rigorous testing and ratings, navigation of products or categories, and product comparisons". [V: <https://developers.google.com/search/docs/essentials/spam-policies>, paraphrased] That points at comparison and navigation pages, which Atlas already has in some form (ST-18 compare). [I]

### 2.3 The options

**Option A. Read the results by hand for a handful of queries.** Free, small, and you learn the texture. [I]

**Option B. Pull results pages through a SERP API and classify the domains.** At $0.0006 per standard result page and $0.002 live, 50 head queries for each of the six cities is 300 pages, so $0.18 to $0.60. [V for prices: <https://dataforseo.com/pricing/google-serp/google-organic-serp-api>, I for the total] Classify each domain as marketplace, big publisher, forum, or small site, and count how many of the top ten are small sites. [I]

**Option C. Skip it and publish everything.** Fast, and the exact pattern Google penalizes at scale (section 3). [I]

### 2.4 Recommendation

**The method is a clear answer. The result is unknown, and it decides section 3.** Do Option B once per city cohort, as a one off experiment with a fixed written rule, for example "pursue a query family only if at least 3 of the top 10 results are small sites". The threshold is a judgment call, so write it down before looking at the data. [I] Keep A as a spot check. Never skip this stage. It is the cheapest step in the whole plan and the only one that can tell you a page type is not worth making. [I]

---

## Section 3: Page types, briefs, and the "value beyond Viator" test

### 3.1 What Google actually asks for

- Scaled content abuse is generating many pages mainly to manipulate rankings. It names generative AI used "to generate many pages without adding value for users". It also covers scraping and reshaping other sources without meaningful enhancement. [V: <https://developers.google.com/search/docs/essentials/spam-policies>]
- Thin affiliation is republishing merchant descriptions and reviews without original value. [V, same page]
- AI generated content is not banned. Google asks for accuracy, quality and relevance, and suggests explaining how automation was used. [V: <https://developers.google.com/search/docs/fundamentals/using-gen-ai-content>]
- Enforcement is at site level. The August 2026 update (announced 2026-08-18, complete by 2026-08-21) cut a site with 1.5 million indexed URLs, about 85% programmatic, despite some human content. Programmatic pages with 100% AI text lost 200,000 or more query rankings, and Amazon affiliate sites built from scraped data with links lost 14,000 queries. Sites that combined several violations fared worst. [V: <https://www.gsqi.com/marketing-blog/august-2026-google-spam-update-case-studies/>, one practitioner's case studies]
- What survives is programmatic pages with a real dataset behind them and one clear intent each. [V, search summary of practitioner posts] That describes hub pages built from structured data better than it describes 30,000 rewritten tour pages. [I]

### 3.2 The page types and where value comes from

| Page type | Example | Where it comes from | Where the value beyond Viator comes from [I] |
| --- | --- | --- | --- |
| Destination hub | `/destinations/rome` | Hand authored today (six cities) | Neighbourhoods, best time, voice, curated picks |
| Category hub | "Food tours in Rome" | Data plus a short intro | Ranking logic, aggregated facts (price range, duration range, share with free cancellation), tag based "best for" |
| Attraction hub | "Colosseum tours" | New Viator attractions data plus catalogue | Comparison of options at that attraction, timing and queue advice |
| Experience detail | One tour | Tour data plus BRI-154 copy | Structured facts, inclusions, honest summary. Lowest SEO ceiling |
| Compare | Two to four tours (ST-18) | Built | Side by side facts |
| Guide, collection | "3 days in Kyoto" | Human authored (BRI-152) | Judgment and voice |

Atlas owned value has three sources, and none of them is an LLM rewriting Viator's fields: (1) **curation and ranking**, meaning why these eight tours out of nine hundred, (2) **aggregated facts computed across tours**, meaning numbers no single Viator listing shows, and (3) **voice and judgment** in `docs/08`. [I]

### 3.3 Briefs

A brief for a page is a short structured record: target query, intent class, questions the page must answer, required data blocks, what Atlas adds, and links out. [I]

- **Programmatic page types: one brief per page type, not per page.** The template is the brief, with parameters (city, category). This is the only approach that works at hundreds or thousands of pages. [I]
- **Top hubs and guides: a per page brief**, written by you or drafted by an agent from the section 2 results analysis. This is small, dozens not thousands. [I]

### 3.4 Recommendation

**Clear answer for programmatic pages:** template briefs per page type, built only for page types that pass section 2. **A genuine fork for hubs and guides:** how many you write by hand (F1) decides the per page brief effort and the storage choice in section 5. Also, the "how much value beyond Viator's text" question in BRI-200's decision 4 is answered structurally here: put the value in hubs and computed facts, and keep per tour copy modest. [I]

---

## Section 4: Grounded generation (cross reference only)

BRI-154, BRI-200 and BRI-201 cover the gate, generate and eval slice, and the BRI-200/201/202 research sets out options. I do not repeat them. This section records only what this research adds or changes. [V that those tickets exist]

1. **Hub page copy is not covered by any ticket I read.** BRI-154 is about `ai_summary` on tours and grounds it on tour fields. A city or category intro is grounded on aggregates (counts, ranges, top rated), a different input and a different check. [V that the tickets stop at tours, I that hub copy needs its own story]
2. **Batch generation fits the timing.** Nothing here is latency sensitive, and the research document prices the Batch API at half the standard rate. [V, per that document] Run generation as its own job after the nightly import finishes, not inside it. The import has a silent 15 to 20 minute finalize phase, and re triggering it mid gap kills the run (project memory, 2026-09-05). [V that the note exists, not re verified today]
3. **Viator reviews must not be indexable.** Viator's rules say reviews must be shown complete, with their source named, and "rendered non indexable by search engines". [V: <https://partnerresources.viator.com/travel-commerce/technical-guide/>, page summary] BRI-201's grounding lists `reviewsBySource`. Copy that restates review content in indexable text may sit outside that rule. Ask Viator (F5). [I]
4. **Viator also says product option titles and descriptions must always display to customers.** [V, same page] `docs/07` says never to replace them with original copy on the canonical card. Both can hold if provider text stays visible in a detail block while Atlas copy sits above it. Confirm the pattern with Viator. [I]
5. **Nothing I found says whether AI derived copy from product content is allowed.** Viator's public partner pages describe what content is available, not what derivative use is allowed. [V that I found no statement, I for the risk] It belongs in F5.

The rest of this section: nothing to add. The sequencing is in section 11.

---

## Section 5: Where content lives, versions and gets edited (the CMS question)

### 5.1 What is actually needed

There are three different kinds of content, and one tool will not fit all three. [I]

| Kind | Volume | Who writes | Edited after publish? |
| --- | --- | --- | --- |
| Per tour AI copy | About 30,000 | Machine, no per item review (BRI-154) | Regenerated, never hand edited |
| Hub copy and computed facts | Hundreds | Machine plus you | Sometimes |
| Guides and collections (BRI-152) | Tens, maybe low hundreds | You, with agents | Yes, with drafts and scheduling (FR-CMS-2) |

### 5.2 The options

**Option A. Extend Postgres, no CMS.** Copy and provenance live as columns or a small related table, the API serves them, the web app reads them. This is what BRI-154 assumed. Schema changes are not made here. [V that BRI-154 assumes it]
- Fits per tour copy exactly: generated, versioned by prompt and grounding hash, regenerated. There is no editor. [I]
- Fits hubs if computed facts are derived at read time and only the human intro is stored. [I]
- Fits guides poorly: long form text, drafts, scheduling and a browser editor would all be custom work. [I]

**Option B. Postgres for machine copy, plus files in the repo for human copy (MDX or markdown).** Guides and hub intros sit in a folder with front matter fields (title, slug, description, `publishAt`). Drafts are branches or a `status` field. This matches the spec: `docs/02` §13.1 already says guides are markdown with SEO fields. [V for the spec, I for the fit]
- Zero new infrastructure and zero recurring cost. [I]
- You and the agents already work in git, so the "editing tool" is one you have. [I]
- Scheduling is a `publishAt` date compared at render time and a revalidation. [I]
- Cons: no browser editor, no visual preview for a non technical contributor, no built in review states. [I]

**Option C. Sanity (hosted).** Free plan: up to 20 seats, 10,000 documents, 250,000 API requests and 1 million CDN requests a month. Growth: $15 per seat a month, 25,000 documents, scheduled drafts, comments and tasks. Extra quota costs $299 a month. [V: <https://www.sanity.io/pricing>]
- **Per tour copy cannot live here.** 30,000 documents exceed both the free and Growth document limits. [V for the limits, I for the conclusion]
- Fits guides and hub copy well: hosted, no database to run, an editor UI. [I]
- Cons: a second system with its own schema and API, a monthly cost once you pass the free tier, and content outside your database. [I]

**Option D. Payload (self hosted, inside the Next app).** MIT licensed, installs into a Next.js app, runs on Postgres through Drizzle. [V, search summary]
- Cons: a second ORM and migration system on the same Neon database as Prisma, and a second admin surface next to the planned `admin.<domain>`. That is the maintenance profile of a small team. [I]

**Option E. Directus over Postgres.** It sits on a SQL database, and this could give an editor UI without a new store. Not verified that it can wrap a Prisma managed schema without conflict. [I]
- **The licence is unclear.** Search summaries say BSL 1.1, free under $5 million revenue. Directus's own page says its core tier is free but names a different licence than the one the summaries gave. [V that the two sources disagree, and I did not resolve which is current] Re check before considering it.

**Option F. Strapi.** MIT community edition, a separate Node service with its own database. [V, search summary] An extra Railway service and cost for a problem you do not have. [I]

**Option G. Contentful.** One secondary source puts the entry price at $300 a month and calls it hard to recommend for new projects. [V, search summary] Not considered further. [I]

**A category you may not have had in mind: git based CMS layers (Keystatic, TinaCMS).** They give Option B a browser editor. Keystatic has no native scheduling, no review flow and no draft state apart from git, and TinaCMS's editorial workflow needs its paid plans. [V, search summary] Useful only if you want a browser UI for your own writing. [I]

### 5.3 Comparison against your constraints

| Constraint | A. Postgres | B. Postgres plus files | C. Sanity | D. Payload |
| --- | --- | --- | --- | --- |
| Solo operator, low maintenance | Good | Best | Good (hosted) | Worse (two ORMs) |
| Cost | $0 | $0 | $0 free tier, then per seat and quota | $0 licence, more infra time |
| Schema minimalism | Grows schema | Grows schema less | Off the schema entirely | Adds a second schema |
| Handles 30,000 tour copies | Yes | Yes | **No** | Yes |
| Handles guides with drafts and scheduling | Custom work | Simple (dates and branches) | Yes, with scheduled drafts on Growth | Yes |
| Duplicates the planned admin | No | No | Partly | Yes |

[I, built from the [V] facts above]

### 5.4 Recommendation

**Default: Option B.** Per tour and hub machine copy in Postgres, human authored guides and hub intros as files. Do not adopt a CMS now. [I]

**A genuine fork (F1)** on what you intend to write yourself. Revisit and move guides to Sanity if any of these becomes true:
- You want to write or edit long form copy in a browser, not in your editor.
- A second contributor who does not use git arrives.
- The count passes roughly 100 pieces and you need real review states. [I, the numbers are a judgment]

Sanity is the option to reach for then, on the free tier first, because it needs no database work. Payload and Strapi both add operating work a solo operator should avoid. [I] Note the spec's workflow states (`draft`, `in_review`, `scheduled`, `published`, `updated`, `archived`) can shrink to `draft`, `scheduled`, `published` for a one person team. [I]

---

## Section 6: From approved to live, on Next.js and Vercel

### 6.1 What is actually needed

New or changed content appears on the live page within minutes, without rebuilding the site, and without paying for rendering 30,000 pages at once. [I]

### 6.2 How this works now, and how it can work

- Today: fully static, no `revalidate`, `dynamicParams = false`. That is fine for six cities and impossible for 30,000 pages. [V for the current state, I for the second half]
- Next.js supports what is needed. With `generateStaticParams` returning some ids, a request for another valid id is rendered on demand and cached. `dynamicParams = false` blocks that, so it would need to change for DB backed pages. [V: <https://nextjs.org/docs/app/guides/incremental-static-regeneration>]
- `revalidate = N` marks a page stale after N seconds. The next request still gets the old page while a fresh one builds in the background. [V, same page] The docs recommend a long interval, such as one hour, and on demand revalidation when you need precision. [V, same page]
- `revalidatePath` and `revalidateTag` invalidate on demand, called from a Server Action or route handler. Regeneration happens on the next request. [V, same page]
- If regeneration throws, Next.js keeps serving the last good page and retries on the next request. [V, same page] That protects you when the Railway API is down at render time. [I]
- Page data read through the ORM (not `fetch`) needs `unstable_cache` with tags. [V, same page]
- ISR needs the Node runtime and is not available in a static export. [V, same page]
- **The docs I read are version 16.3.5 and the repo is on `^15.5.20`.** The documented `revalidateTag(tag, 'max')` two argument form may not exist in 15. [V for both versions, I for the difference] Check against the installed version before designing around it.

### 6.3 Cost on Vercel

| Item | Value | Source |
| --- | --- | --- |
| Pro ISR pricing | $0.40 per million reads, $4 per million writes | [V, search summary] |
| Cost of rendering all 30,000 pages once | 30,000 writes, about $0.12 | [I, arithmetic] |
| Hobby ISR allowance | 1 million reads, 200,000 writes a month | [V, search summary] |
| Hobby plan terms | Restricted to non commercial, personal use | [V: <https://vercel.com/docs/plans/hobby>] |
| Pro plan | $20 per developer seat a month, with usage credit | [V, search summary; the Hobby page confirms the $20 seat price] |

**The Hobby plan is non commercial only.** An affiliate site earning commission is commercial. Launch needs Pro. [V for the terms, I for the classification] Your memory note already says Hobby cannot auth gate production. That is a second reason. This is F3.

### 6.4 The publish path

1. The generation job or an edit sets content live (a status change, a stored copy, or a merged file). [I]
2. The API calls a small secured route on the web app naming a tag (city, category or experience). [I] A shared secret between the two apps already exists as a pattern. `INTERNAL_CLICK_SECRET` must hold the same value in both. [V, `AGENTS.md`] A new secret would need to be added to Doppler. That is a setup step, not made here. [I]
3. The next request renders and caches the page. A daily `revalidate` remains as a safety net. [I]
4. The sitemap reflects the change (section 8). [I]

### 6.5 Recommendation

**Clear answer: ISR with on demand tag revalidation, plus a long time based safety net.** Keep the six static destinations as they are. Move only DB backed page types to ISR. Prerender a small set at build (top hubs) and let the rest render on first request. [I] The one open item is the plan tier (F3).

---

## Section 7: Internal linking and content relationships

### 7.1 What is actually needed

Every indexable page reachable within a few clicks of a hub, hubs linking down to their children, children linking up, and neighbours linking sideways, all without hand maintaining links across thousands of pages. [I]

### 7.2 What the practitioner writing says, and how much to trust it

Hub and spoke is the standard shape: hubs link to every child, children link back, and related children link to each other. Programmatic sites use rule driven links, keep depth under about five clicks, and give category pages more inbound links than item pages. [V, search summary of practitioner posts, mostly SEO agency blogs of low authority] Treat the numbers (link counts per tier) as heuristics, not rules. [I]

### 7.3 Options

**Option A. Rules from data you already have.** Same city and same tag, same category by rating, "other destinations" (already built), compare links (ST-18). Deterministic, no LLM, no new tables. [I]

**Option B. Rules plus geography.** "Nearby" tours by distance. Geo coordinates are filled for only 2.3% of tours (697 of 30,132), so distance cannot be a primary signal. [V for the fill rate, per the BRI-200/201/202 research, I for the conclusion]

**Option C. LLM chosen contextual links inside body copy.** Costly to check, hard to test, and it adds hallucination risk to link targets. [I]

### 7.4 Recommendation

**Clear answer: Option A.** Generate links from relationships in the data at render time. Use Option C only for hand authored guides and collections, where you or an agent place links on purpose. Revisit geography after the geo backfill. [I]

---

## Section 8: Structured data, sitemaps and technical SEO

BRI-140 (structured data), BRI-143 (sitemaps and robots) and BRI-142 (quality gate) exist. I do not duplicate them. This section records how this research connects. [V that they exist]

1. **Sitemap size.** One sitemap holds at most 50,000 URLs, and `generateSitemaps` splits them. [V: <https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps>] Thirty thousand tour pages plus hubs fit today but a growing catalogue will not. `docs/02` line 257 and line 396 already say "sharded". [V] Build for shards from the start. [I]
2. **The sitemap should list only indexable URLs.** That makes it read the same index decision as the page's robots meta (section 9). [I] FR-DEST-6 already says the sitemap lists only the canonical form. [V]
3. **`lastModified` is `now` on every entry today.** [V] Use the real content update time. A sitemap whose dates always say "just now" gives crawlers no signal. [I]
4. **`AggregateRating` is in the JSON-LD list** in `docs/02` line 393. [V] The ratings Atlas holds are Viator and Tripadvisor aggregates, not Atlas's own. Whether that markup is appropriate on a page showing third party ratings was not verified in this session. Confirm against Google's review snippet policy before BRI-140 ships it. [I]
5. **Reviews and indexing.** Viator's rule that reviews be not indexable (section 4) applies to markup and body text. [V for the rule, I for the scope]
6. **Robots.** `/go/*` is already disallowed. [V, `docs/02` line 396 and `robots.ts`] Keep pages you noindex crawlable. A blocked page never shows its `noindex` to Google, and removal can take months. [V, per the BRI-200/201/202 research citing Google's block indexing page]
7. **Core Web Vitals (ST-32).** Nothing here changes that. [I]

---

## Section 9: Index scope and staged rollout

### 9.1 Why this is its own problem

Section 3.1 says enforcement is at site level. The site is pre launch and gated, so nothing is indexed yet. That is the cheapest possible moment to decide what gets indexed. [V for the state, I for the reading]

BRI-200 decision 1 asks what happens to ineligible tours. This section is the SEO side of that question. [V that the decision exists]

### 9.2 Options

**Option A. Index everything that passes the quality gate at launch.** Simplest. It puts every tour page in Google's view together with the hubs. [I]

**Option B. Index hubs plus eligible tours, keep the rest `noindex, follow`, and open up in cohorts.** Ineligible tours stay live for users and for internal links but stay out of the index. Batches of 50 to 200 pages, two to four weeks of monitoring between them, are the practitioner numbers. [V, search summary of practitioner posts] Cohort size for a 30,000 page catalogue is a judgment. [I]

**Option C. Index hubs only.** Tours never enter the index. Tours exist as booking targets. [I]

### 9.3 What to watch

The Search Console status "Crawled, currently not indexed" and "Discovered, currently not indexed" are the earliest quality signals. Practitioners read them as Google's doubt about site quality. [V, search summary] Use them as the gate for opening the next cohort. [I]

### 9.4 Recommendation

**Option B, with hubs first.** Noindex is slow to take effect (section 8), so start restrictive and open up. Opening a gate is fast. Closing one is not. [I] This needs BRI-142 to read BRI-200's stored outcome. [V that the research doc recommends that link]

**A genuine fork (F2):** how many cohorts you are willing to wait for before traffic matters, against how much site level risk you accept for early traffic. That is a timeline and risk appetite call.

---

## Section 10: The feedback loop

BRI-153 exists. I record only the connections. [V that it exists]

### 10.1 What is actually needed

A weekly answer to: which pages get impressions, which get clicks, which earn commission, which were crawled and not indexed, and which are decaying, joined back to page type so section 1's next candidate list improves. [I]

### 10.2 Sources

| Source | Gives | Limits |
| --- | --- | --- |
| Search Console API | Queries, clicks, impressions, position per page | 25,000 rows per request, 50,000 per day per search type, data 2 to 3 days late [V] |
| Search Console bulk export to BigQuery | Daily tables of the same data | Export free, storage and queries billed at small rates [V, search summary]. Needs a Google Cloud project with billing |
| `AffiliateClick` ledger (`/go/:slug/:id`) | Server side click count per experience | Clicks, not commission [V] |
| PostHog | Client side behaviour, `experience_booking_clicked` | Complements the ledger, does not replace it [V, `apps/web/AGENTS.md`] |
| Viator campaign parameter | The existing links carry `&campaign=<slug>-card`, so commission can be split by campaign if Viator's reporting shows it | Reporting depth not verified [V for the parameter, I for the use] |

### 10.3 Recommendation

**Clear answer, but nothing to build until the site is indexed.** When it is: a weekly job pulls Search Console by page and query into a small store, joins to city and page type, and emits three lists: striking distance queries (position 4 to 20, high impressions), indexed pages with zero clicks, and decayed pages. Those lists feed section 1 and the cohort gate in section 9. [I for the design, V for the data limits] The store can be a table or BigQuery. Given schema minimalism, BigQuery avoids growing Postgres, at the price of a Google Cloud project. Decide when the job is built, not now. [I]

Do now: confirm a Search Console property will exist for the production domain, and tag affiliate links per page type so revenue can be traced later. [I]

---

## Section 11: Reconciliation with BRI-200, BRI-201 and BRI-202

| Topic | The BRI-200/201/202 research says | This research adds or changes | Action |
| --- | --- | --- | --- |
| **Generation timing and triggers** | Regenerate on a grounding hash, not `source_hash`, and generation follows the eligibility gate | Trigger is: gate passes and the grounding hash differs from the stored one. Run as a separate batch job after the nightly import, not inside it. On success call tag revalidation (section 6). [I] | Design BRI-154's trigger from BRI-200's stored outcome, with the job and revalidation described here |
| **Ineligible tours** | Options A to D, recommends B (a stored outcome BRI-142 reads) | Index scope is the lever between "live" and "gone": ineligible tours can stay live and stay `noindex` (section 9) | Treat BRI-200 decision 1 and F2 as one decision |
| **BRI-142 overlaps BRI-200** | Different gates at different stages, linked one way | BRI-142's "at least three experiences" is a page rule that fits hubs, not single tours. Add cohort rollout and Search Console status as its release control | Clarify BRI-142's scope to name page types |
| **"Value beyond Viator's text"** (BRI-200 decision 4) | A risk appetite call | Answered structurally: the value is in hubs, computed facts and voice (section 3.2). Per tour copy stays modest | Ask hub copy to be a story under BRI-120 |
| **The recrawl decision** | About 92% of tours lack Task 1 to 3 data. Pay for a full recrawl, or gate on rating and reviews first | If a recrawl is paid for, capture everything needed once: tag names and attractions are also unfetched today (section 0.2) | Bundle these into the recrawl decision so it happens once |
| **BRI-146 duplicates** | 773 excess rows share a title | Duplicate pages inside one site compete with each other. Feed the canonical choice into the index decision | Treat the canonical choice as an input to section 9 |
| **Doc 02 §12 and FR-CMS-1** | Fix before building | Also fix FR-CMS-1's tour approval half, §13.1's workflow states (now only for human content), and docs/08's "substantively human edited" rule | Edit doc 02 first, as `AGENTS.md` requires |
| **Reviews as grounding** | `reviewsBySource` (Task 4) is unbuilt | Viator requires reviews not indexable and shown in full with their source (section 4) | Ask Viator before Task 4 feeds any copy (F5) |
| **Catalogue expansion on hold** (BRI-202) | Nothing urgent until the content engine exists | Expansion order can come from section 1's demand times depth ranking | Revisit when expansion resumes |

---

## Section 12: Decision register (the forks only you can settle)

| # | Decision | Why it is yours | My default | What it changes |
| --- | --- | --- | --- | --- |
| **F1** | How much you will hand write (guides, collections, hub intros) | Only you know your time and intent | Tens of pieces, files in the repo (Option B, section 5) | Storage choice, per page briefs, whether Sanity is ever needed |
| **F2** | Index scope at launch, and how long you will wait for cohorts (also BRI-200 decision 1) | A risk and timeline call | Hubs first, eligible tours in cohorts, ineligible tours `noindex` | The time to first traffic, and site level risk |
| **F3** | Vercel plan at launch | Budget and timeline | Pro ($20 per developer seat a month), because Hobby is non commercial | Whether launch is possible without breaching Vercel's terms |
| **F4** | Keyword data budget ceiling | Budget | Pay per call, cap about $25 a month, no subscription | Nothing material, the first pass costs under $10 |
| **F5** | Three questions for Viator partner support (as the account holder): may AI derived copy be built from product content, may copy restate review content when reviews must be not indexable, and how must provider titles and descriptions display next to original copy | Only the account holder can ask | Ask before generation ships | Whether BRI-154 and Task 4's copy design is allowed |
| **F6** | Whether to add cities in the order demand suggests | Taste against data | Demand times catalogue depth | The order of catalogue expansion |

---

## Sub problem verdicts

| Sub problem | Verdict |
| --- | --- |
| 1. Opportunity and keyword discovery | **Clear answer.** Viator derived candidates, DataForSEO validation, skip subscriptions |
| 2. Results page landscape | **Clear method, unknown result.** A cheap experiment decides which page types to pursue |
| 3. Page types and briefs | **Clear for programmatic pages, fork for hubs and guides (F1)** |
| 4. Grounded generation | **Already scoped.** Two gaps (hub copy, Viator policy, F5) |
| 5. Storage and CMS | **Genuine fork (F1)** with a default of no CMS |
| 6. Approved to live | **Clear answer** (ISR plus tag revalidation). Plan tier is F3 |
| 7. Internal linking | **Clear answer** (rules from data) |
| 8. Structured data and technical | **Clear**, with one open question on rating markup |
| 9. Index scope and rollout | **Genuine fork (F2)** |
| 10. Feedback loop | **Clear answer**, nothing to build until indexed |

## Suggested sequencing

Recommended order, research and decisions first. [I]

1. Fix the design inputs (`docs/02` §11 to §13 wording, and BRI-154's regeneration key), as the other research also says.
2. Send the Viator questions (F5), since the reply takes time and shapes generation.
3. Run the two cheap experiments: keyword validation (section 1.4) and results page classification (section 2.4). Decide the page types.
4. Decide F1, F2 and F3.
5. Then BRI-200 rules, BRI-154 with BRI-201's deterministic layer, and BRI-142 reading BRI-200's outcome.
6. Then ISR delivery, sitemap shards and links from data.
7. Search Console and the weekly loop once pages are indexed.

## Suggested ticket and doc corrections (not applied)

- **BRI-114 (EP-9):** add index scope as a story, and note ST-29 depends on section 2's result.
- **BRI-118 (EP-13):** note the default is no CMS, with the triggers in section 5.4.
- **BRI-152:** note the default is files in the repo.
- **BRI-140:** add the rating markup question. **BRI-143:** lastmod from real dates, indexable URLs only.
- **BRI-142:** name the page types it covers.
- **BRI-153:** name Search Console as a source.
- **Candidate stories not yet filed:** hub copy generation, a keyword and results page pass, an index cohort control, attractions ingestion.
- **`docs/02`:** §12, FR-CMS-1, §13.1 and docs/08's human edit rule.

## Out of scope

- Any code, schema, migration, PR, Linear change, or deploy.
- Choosing prompts, tone, or the brand voice.
- Resolving Viator API policy questions beyond listing them (see `docs/13-viator-api-audit.md`).
- Buying any tool, creating any account, or calling any paid API.

## Self Review

**Spec coverage:**
- Requirements from the repo record: section 0, with a table of what the specs do and do not cover. ✅
- Every named sub problem has a section, and the derived ones (page types and briefs, index scope) are added. ✅
- Broad survey before narrowing: keyword (four categories, section 1), CMS (seven options plus git based layers, section 5). ✅
- Comparison against actual constraints, per decision: sections 1.3, 5.3. ✅
- Forks flagged, not silently chosen: section 12. ✅
- Cross reference to BRI-200, BRI-201, BRI-202 without duplicating: section 4 and section 11. ✅

**Tag audit:** Every factual statement carries [V] or [I], and search summaries are marked. ✅

**Placeholder scan:** No unresolved language. The items I could not settle are named as limits below.

**Known limits of the evidence:**
- Results page composition for "things to do in {city}" was not verified. Section 2 exists because of it.
- Ahrefs API pricing was not confirmed. Semrush, Directus, Payload, Strapi, Contentful and Keystatic facts came from search summaries.
- Directus's licence conflicts between sources.
- Whether Keyword Planner returns exact volumes without ad spend was not verified.
- Nothing I found states Viator's position on AI derived copy.
- The Vercel ISR prices came from a search summary, the Hobby terms from the primary page.
- Practitioner claims on cohort size and link counts are heuristics from low authority sources.
- I did not verify the installed Next.js API against version 16 docs.
- Catalogue numbers are from another document, not re queried.
