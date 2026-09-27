# Folio Voyage — Discovery, Combinatorial Content & the Three-Engine Vision

**Status: planning document, not a spec.** This captures an ideation
session in full, unfiltered — the point is nothing juicy gets lost
before this goes into a real `/architect` pass later. Where an idea
contradicts an earlier one, both are kept, flagged as open threads at
the end, not silently resolved here.

---

## 0. The thesis, stated plainly

Affiliate marketing is a numbers game. Winning it against giants means
maximizing surface area — not more listicles, but content and
discovery surfaces a single writer or a single OTA structurally cannot
produce. The advantage isn't any one page or feature; it's that
**marginal cost trends toward zero for combinatorial content while it
stays flat (or rises) for human-authored competitors.** Every new
signal — a new city, a new supplier, vision data, real user behavior —
multiplies against everything that already exists, rather than adding
to it linearly.

The moat is three things, none of them scrapable by a competitor even
if they scrape your prices: **proprietary structured data, the
generation engine built on it, and eventually proprietary behavioral
data** (what real people saved, hovered, shared).

---

## 1. Three engines, one dataset

Not three products — three surfaces, deliberately separated, all
downstream of the same catalogue and generation architecture:

| Engine | Wins | Conversion logic | Infra priority |
|---|---|---|---|
| **Written** (hub/detail/guide pages) | SERP, backlinks, authority | Factual, bottom-of-funnel — someone already has intent | Fast, static-leaning, crawlable. Every script is a tax against ranking. |
| **Canvas** (infinite pan/zoom discovery) | Pinterest, pure browse/discovery | Emotional, top-of-funnel — turns "not planning a trip" into "might be" | Not measured for organic ranking — the one place free to be visually expensive |
| **Itinerary widget** (personal boards) | High-intent personal conversion | Passive saving → active planning is the real conversion moment | Sits alongside the canvas, but its own logic |

Instagram's Feed/Explore split is the working analogy: same underlying
content pool, two completely different consumption modes, kept
deliberately apart so neither has to compromise for the other.

**Why keep them separate, concretely:** the written side is measured
on Core Web Vitals and can't afford canvas-grade JS weight. The canvas
isn't measured that way at all — which means it's the *only* surface
where genuinely heavy, playful, editorial design is free to exist
without threatening the SEO investment everything else depends on.

---

## 2. The canvas

### 2.1 Mechanism
True 2D pan-and-zoom (not a masonry scroll — visually similar
references exist, e.g. skiper-ui's skiper73 component, currently
locked behind a paid tier; the actual build approach is a later
decision, not blocking the idea).

### 2.2 Position encodes taxonomy — the core mechanic
Not a mirror of the site's link structure sitting next to it — **the
canvas position *is* the taxonomy**, experienced spatially instead of
through clicks.
- **Zoom level = hierarchy depth.** Zoomed out: regions. Zoom into a
  region: cities cluster. Zoom into a city: neighborhoods/categories
  separate. Zoom further: individual tours.
- **Search drops you at a coordinate, not just "a section."** Searching
  "Bangkok temples" is genuinely flying to a specific zoom depth and
  coordinate — the same address a hub page would have, visited by
  arriving instead of clicking a breadcrumb.
- **Any coordinate is a shareable URL** — "look at this view of
  Bangkok's food scene," the same way people share a specific map pin.
- **Mini-map HUD**, video-game style, in a corner: shows current
  position relative to the whole canvas, doubles as fast-travel (click
  anywhere on it to jump). Since position = taxonomy, this is
  effectively a live spatial sitemap.

### 2.3 Editorial freedom — because it isn't the indexable layer
The canvas can break every normal web-layout rule on purpose:
- Varied aspect ratios *carry meaning*, not just rhythm — tall
  portrait for a multi-day trek, wide landscape for a coastal day trip,
  near-square for a food tour. Nobody consciously notices the rule; it
  still reads as curated rather than a database dump.
- Pull-quote tiles: no image, one striking generated line in huge
  serif type on paper texture.
- Stat tiles: a single number ("since 1782"), massive, nothing else.
- Tiles overlapping slightly, rotated, torn-edge/polaroid treatments —
  physically impossible in a scroll layout, natural in 2D space.
- Text in the gutters between tiles: a generated one-liner, rotated
  90°, barely visible until someone looks for it — a reward for
  attention, not a headline.
- This is the same inspiration that originally seeded the globe idea,
  now realized as "an infinite HTML newspaper."

### 2.4 Interaction details
- **Hover reveals a generated one-liner as a caption** (reusing
  `aiSummary` fragments, at zero new content cost).
- **Hover on one tile very slightly desaturates every other tile** — a
  spotlight effect that costs little and makes the grid feel responsive
  to the specific viewer.
- **Time-dimension scrubber**, reusing `seasonality.csv` data already
  pulled: drag toward spring, Kyoto's tiles shift toward blossom-pink;
  toward autumn, toward maple-red. Same tiles, different visual skin
  driven by real seasonal data, not new content.
- **Ambient presence**: a faint, no-login "14 people exploring Kyoto
  right now" marker — cheap to build, makes the canvas feel like a
  place rather than a database.

### 2.5 Adjacent verticals live as *geography*, not sections
This is the scaling unlock for hotels, cruises, etc.: they don't get
their own tab, they get woven into the same map.
- A cruise is a literal winding path across a region, ports as stops.
- A hotel tile sits physically among the tour tiles for its own
  neighborhood, because that's where it actually belongs.
- Same instinct that made the map the original moat, extended past
  tours.

### 2.6 Distribution value of the canvas itself
- Screen-recordable "satisfying UI" content — a real, current
  short-form format, genuinely novel in travel.
- **Embeddable canvas widget** for other travel blogs/sites — "Powered
  by Folio Voyage," Spotify-embed style. Give away something genuinely
  cool, get a permanent traffic tap back.

### 2.7 Ads — a genuinely spatial-only ad product
- **Sponsored tiles**, visually native — same aspect-ratio-carries-
  meaning design language as organic tiles, not a banner.
- **Sold "territory"**, not just tiles — a hotel brand sponsors an
  entire zone, their tiles clustering around a neighborhood's organic
  content. You cannot sell "a region of a scrolling feed" — this is
  spatial-only inventory, novel enough to command a premium.
- **Distinct hover behavior keeps revenue streams honest**: organic
  tile hover → own detail page/own affiliate link; sponsored tile hover
  → advertiser's landing page. Ad revenue additive, not cannibalizing
  affiliate revenue.
- **Seasonal skin-shift doubles as an ad slot** — a sunscreen brand's
  tile brightening in the summer-shifted grade, a coat brand's warming
  toward winter — reusing the same time-mechanic already designed for
  organic content.

### 2.8 Open branch, not yet explored
Named/invented district identities for canvas zones (separate from
literal geographic naming) — raised as a direction, never developed.
Worth a real pass later.

---

## 3. Pinterest integration

- **Pins are templated composites, not raw photos** — the tour's photo
  with the generated one-liner baked in as text overlay. Pinterest's
  own data favors text-overlay pins; the copy already generated for
  BRI-154 is already pin-caption-shaped (short, concrete, specific).
- **Rich Pins via meta tags** (product/article schema) — once set up
  once, any tour page becomes a live, auto-updating pin (price,
  availability pulled straight from the page) with near-zero ongoing
  work.
- **Boards are auto-generated from BRI-152's curation output**, not
  built by hand — the same deterministic-curation-with-stated-reasoning
  logic, a different distribution exit. A scheduled job pushes new pins
  into matching boards as new tours become eligible.
- **Posting timing tied to `seasonality.csv`** — push "cherry blossom
  season in Kyoto" hard in the weeks before it actually spikes, using
  real data already pulled during BRI-206's extension.
- **On-site save mechanic mimics Pinterest's**, no login required — a
  satisfying save animation, building a private board silently through
  browsing behavior, long before any real Pinterest integration is
  touched.
- **Deep-links from real Pinterest pins land inside the canvas at the
  exact coordinate that inspired the pin** — not a generic detail page.
  Removes the "jarring handoff" problem and most of the original
  indexability worry, since the canvas isn't the thing being asked to
  rank.

---

## 4. The itinerary widget — "board becomes itinerary"

### 4.1 What it actually is
Not a new system — **BRI-152's curation engine, pointed at a personal
save-pool instead of the global catalogue.** Same "deterministic logic,
stated as reasoning" pattern, new input source.

### 4.2 Day-clustering logic
- Full-day tours claim their own day.
- Half-day tours pair with something in the opposite time slot.
- An evening tour pairs with a lighter, geographically-close daytime
  activity.
- **It states its reasoning** ("Day 2 pairs these two because they're a
  10-minute walk apart") — same trust mechanic as everything else,
  and cheap to generate since it's grounded in coordinates/durations
  already on hand.

### 4.3 Hotels anchor, they don't compete for a day slot
A hotel tile pins as "home base" at the top of the widget — and becomes
the point the recommendation logic measures distance *from*.

### 4.4 Gaps are the conversion surface, not a flaw
An empty day isn't blank — it's "you've got space Tuesday morning,
here's what's nearby your hotel that matches what you've saved." The
widget selling more than the canvas ever did, because it now knows real
constraints (location, timing, this person's actual taste) a cold hub
page never has.

### 4.5 A bespoke, personalized summary paragraph
Once assembled, generate a short summary for the itinerary *itself*
("Your 3 days in Madrid: Prado in the morning, a tapas crawl at night,
a day trip to Toledo") — reusing the exact generation engine BRI-154
and BRI-152 already run, just pointed at a one-person audience instead
of the public.
- **Emphasis should adapt to what was actually saved** — a board that's
  80% food-related tiles should read food-forward in its framing. A new
  grounding input (personal taste signal) nobody's built yet.

### 4.6 Booking as a guided sequence
"Let's book Day 1 first" — surfaced one affiliate link at a time, in
use order, rather than dumping several open tabs and hoping all of them
convert.

### 4.7 Real dates make it practically useful
If real travel dates are entered, cross-check real eligibility/
seasonality data already in the system — "this one doesn't run in
December" — catching a genuine planning problem, not just arranging
pretty tiles.

### 4.8 Named, shareable boards close the loop
A finished "3 days in Madrid" board is shareable exactly like the
Pinterest board idea — a friend opens it read-only, and their clicks
inside start their own new exploration thread. Not a dead end after
booking — another distribution seed.

### 4.9 Boards are written content, not just a personal feature
This might be the single biggest idea from the whole session: a named
board is a genuinely new *species* of guide page — **seeded by real
behavior, not a keyword guess.** Every guide built so far, however
clever the curation logic, starts from "what would someone plausibly
want" — a hypothesis. A board a real person actually assembled by
saving what they were genuinely drawn to is ground truth. Made public
and crawlable, this produces hundreds of validated variations on "3
days in Madrid," at zero incremental content cost.

**Required guardrails before this is a straightforward win:**
- **Default private, opt-in public** — a half-formed trip plan isn't
  content until the owner says it is.
- **A uniqueness gate before indexing**, mirroring BRI-200's shape —
  don't index every board, only ones different enough to be worth a
  distinct URL. Otherwise: a thousand near-identical boards competing
  with each other instead of complementing the catalogue.
- **The generated summary paragraph is the crawlable asset, not the raw
  tile arrangement** — same "aggregate reasoning, not raw data"
  principle already governing hub pages.

### 4.10 Sequencing note
The itinerary/board mechanic doesn't strictly need the full 2D canvas
to exist first — saving and clustering only needs *some* collection
mechanism. Could pilot independently if the canvas build runs long.

---

## 5. Evolving the generation engine itself

- **Vision grounding.** A structured captioning pass over every tour's
  photo set — setting, notable objects, crowd density, lighting/time-
  of-day, dominant colors — feeding the same grounding-hash/prompt-
  input pipeline BRI-154 already has. Not a rebuild, an additive field.
  - Surfaces facts no text-only competitor has access to (a rooftop
    view Viator's own copy never mentions).
  - Makes the canvas's seasonal color-shift *true* rather than a
    styled lookup-table hack.
  - Solves a real itinerary-trust gap: two tours tagged identically
    ("outdoor") but visually very different (manicured vs. rugged) —
    invisible to text metadata, obvious on sight.
  - Completes the "vary the opening" fix from task 10 properly — that
    fix stopped the model always leading with duration, but it still
    can't lead with anything visual because it's never been able to
    see. Vision grounding is what actually finishes that job.
  - **Needs its own calibration pass before production** — is the
    extracted metadata actually accurate on a real, varied photo
    sample, or does it hallucinate confidently on ambiguous images?
    Same discipline that caught the Cloudflare pricing gap and the BYOK
    bug — cheap to prototype, not free to skip verifying.
- **Relational grounding.** Feed the same proximity/distance data the
  itinerary widget computes back into tour-level generation — "a
  10-minute walk from X" is a new class of fact only available because
  the catalogue exists as a whole, not tour by tour.
- **Behavioral feedback loop.** Which openings get saved more, which
  tiles get hovered longest, which one-liners travel furthest on
  Pinterest — real signal about which kind of specific fact resonates,
  feeding back into prompt tuning. The engine improves using data the
  visual side produces as a byproduct, not a separate research effort.

---

## 6. The written side at combinatorial scale

### 6.1 Why this isn't "more listicles"
The SEO research pull felt hollow because it was answering "which of a
small, fixed set of page types should we build" — the wrong unit of
scale. The real answer: **the page-type list itself should keep
growing as new data axes appear**, because a combinatorial engine
doesn't cap out the way a keyword list does.

### 6.2 The split that makes scale economical — the actual answer to
"is there still copy to write"
Yes, there's still copy — but combinatorial scale only works if
computation and generation stay cleanly separated:

- **Layer 1 — computed, deterministic, free.** Which tours match a
  filter, real aggregate numbers (price range, average rating, top
  pick). Pure database work, same discipline as the eligibility gate.
- **Layer 2 — generated, but the *pattern* is reused, not rebuilt per
  combination.** The prose frame (how a persona page opens, how a
  superlative page states its winner) is written and refined once per
  *pattern*, and combination-specific data slots in at generation time
  — mail-merge, not bespoke writing per page. The number of things
  needing real LLM design attention scales with how many *patterns*
  exist (small, hand-designed), not with the combinatorial explosion of
  city × category × persona × season (which is what actually produces
  the thousands of pages).

This is the original content-engine "brief" concept, made concrete:
the brief's "required data blocks" = Layer 1; "what Atlas adds" =
Layer 2.

| Page type | Layer 1 (computed) | Layer 2 (generated) |
|---|---|---|
| Superlative ("best value tour, every city") | Winning tour, real price/rating | One sentence of why, reusing the tour's own copy |
| Persona/budget cuts | A filter over existing fields | Near-template framing ("real small-group data") |
| Weather/season pages | The matching tour set | One evergreen paragraph per city, regenerated rarely |
| Cross-city thematic | Needs vision-tag data to find candidates | One real synthesis paragraph per theme |
| Personal itinerary summary | Saved tiles, proximity, dates | The most bespoke case — genuinely personal input |

### 6.3 Page-type catalog generated this session (not exhaustive, not prioritized except where noted)
- **Neighborhood micro-guides** — one level narrower than a city hub
  ("Old Quarter, Hanoi"), easier to rank, more specific-feeling.
- **Comparison pages** — two tours, facts side by side, a stated pick
  ("Grand Palace tour vs. Wat Pho tour"). Cheap: reuses existing data,
  no new research.
- **Weather-contingent pages** — "what to do in Bangkok when it's
  raining." Almost nobody targets this directly.
- **Budget-tier pages** — "free things to do in Rome," "splurge
  experiences in Bali." A filter, not new generation logic.
- **Festival/event pages** — Loi Krathong, cherry blossom season,
  Semana Santa. High emotional pull, genuinely seasonal.
- **"Surprise me" page** — one random eligible tour, freshly picked.
  Zero SEO value by design — pure delight, cheap, screenshot-shareable.
- **"First time in X" pages** — reassuring, onboarding tone, distinct
  from an exhaustive things-to-do hub.
- **Cross-city thematic pages** — "best rooftop bars across SE Asia" —
  requires aggregating across cities, only possible at this data scale.
- **Multi-city sequence guides** — "Bangkok to Hanoi in 10 days" — the
  itinerary-widget logic, run as a public template instead of a
  personal board.
- **Persona cuts** — "tours for people who hate crowds" (real
  group-size data), solo-traveler-friendly, honeymoon-tagged.
- **Computed superlative pages** — "highest-rated experience under
  $30" — a competitor without this structured dataset can't produce
  these credibly; you can, because the number is real.
- **Cross-supplier comparison pages** (once a second OTA is
  integrated) — "this Klook tour vs. this Viator tour, same activity."
  No single OTA would ever build this against itself — a structural
  advantage unique to an aggregator.

### 6.4 Research-informed priority (from the real BRI-206 extension)
- **Destination hubs before category hubs.** Real competitor traffic
  data: city-hub URLs pull far more traffic per page than category-hub
  URLs across the OTAs measured, despite the SERP-openness test barely
  discriminating between them (98.5% of pairs open — not a useful
  prioritization signal on its own).
- **`best_time` content as a subsection of destination hubs, not a
  standalone page type** — its own SERP signal is borderline (drops to
  ~53% open under a broader review; several results start organic
  ranking at position 3+, meaning ads/AI Overviews eat real click
  share even on "open" queries).
- **AI Overview presence is a live, ongoing risk to monitor** (present
  on ~9 in 10 things-to-do/best-time SERPs) — doesn't reverse the
  destination-hub priority call, since competitor traffic numbers
  already reflect a world where those Overviews exist, but it caps the
  realistic ceiling and belongs in BRI-207's index-scope thinking.
- **Real architectural consequence:** a destination hub with a
  `best_time` subsection needs **mixed-cadence regeneration internally**
  — the aggregated tour-fact core should regenerate rarely (same
  amplification-risk reasoning as the original hub-hash design), while
  a seasonal subsection needs to refresh on a different, shorter
  cadence. One hash can't govern the whole document.

---

## 7. Scaling axes — deliberately sequenced last, each genuinely new in kind

- **More cities** — linear, the most obvious multiplier.
- **More suppliers** — not additive; enables a wholly new capability
  (cross-supplier comparison) no single OTA can honestly build.
- **Adjacent verticals** (hotels, cruises) — not new pages, new
  *geography and slots* inside pages/canvas that already exist.
- **Real behavioral data** (saves, hovers, pin-travel) — the one input
  source structurally impossible for a competitor to copy, since it's
  generated by real people using your product, not scraped from public
  pages.
- **Emergent pattern discovery** (speculative, later-stage) — once
  enough behavioral data exists, the system could notice a real
  co-save/co-book pattern that maps to no predefined page type, and
  generate a page for it — a genuinely different category of thing
  than "a big content engine," closer to a system that finds its own
  opportunities. Needs real usage data that doesn't exist yet; not
  actionable now.

---

## 8. Rough dependency order (for later real sequencing, not a commitment)

1. **Foundation, already built:** BRI-154, the eligibility gate, the
   grounding-hash discipline.
2. **Vision grounding — start in parallel now.** Gates nothing, but
   persona cuts, cross-city themes, canvas color-truth, and itinerary
   trust all get meaningfully better once it exists.
3. **BRI-205, reframed** from "hub pages" to "the combinatorial content
   engine" — the real design question is the Layer 1/Layer 2 split and
   how many distinct Layer-2 patterns are actually needed. Destination
   hubs first, per the real research.
4. **BRI-152, reframed** to serve two paths on one engine: public
   guides (SEO-facing) and personal, possibly-shareable itinerary
   boards — not two separate features.
5. **The written engine matures first** — Pinterest pins and canvas
   captions are both just styled `aiSummary`/guide fragments; richer
   written content directly enriches both other engines.
6. **Canvas + Pinterest sync** — a parallel, independent frontend
   track, deliberately decoupled from the written side's SEO
   constraints.
7. **Itinerary widget could pilot before the full canvas exists** — it
   only needs *some* save/cluster mechanism, not necessarily full 2D
   pan-and-zoom, if the canvas build runs long.
8. **Scaling axes** — deliberately last; each needs the core proven
   first, and the emergent-pattern idea specifically needs real usage
   data that doesn't exist yet.

---

## 9. Open threads — raised, not resolved

- Named/invented district identities for canvas zones — direction
  only, never developed.
- Exact build approach for true 2D pan-and-zoom (the referenced
  component is paid-tier-locked) — a later technical decision.
- How aggressively to pursue cross-supplier comparison pages before a
  second OTA integration is even underway — sequencing question, not
  resolved here.
- Ad sales mechanics for "sponsored territory" — the concept is here,
  the actual pricing/sales motion is not.
- Whether vision grounding's calibration pass should happen before or
  in parallel with BRI-205's `/architect` session — leaning parallel,
  not decided.
