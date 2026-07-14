# 06 — E-E-A-T-Aligned Blog Content (draft for review)

**Status:** Draft deliverable — not yet applied to `frontend/src/data/blog.ts`.
Review, fill the truthfulness placeholders, then integrate.

## Why this exists

Google's Search Quality Rater Guidelines weigh **E-E-A-T** — **E**xperience,
**E**xpertise, **A**uthoritativeness, **T**rustworthiness — heavily for
"Your Money or Your Life"-adjacent content, which travel-planning-for-money
(affiliate) content is. OTA reviewers (Viator/GetYourGuide) apply a similar
smell test: *is a real, knowledgeable person behind this?*

The current posts read well but are **anonymous, undated in-body, unsourced, and
written in a generic "we."** That leaves three of the four E-E-A-T pillars
unsignalled. This draft rewrites each post to carry all four — **without
fabricating anything**, which is the one rule E-E-A-T can't survive breaking.

### The honesty guardrail (read before integrating)

E-E-A-T rewards *genuine* experience and *real* authorship. Inventing a
credentialed author or a first-hand anecdote that didn't happen would raise the
Experience/Expertise score on paper while destroying Trust the moment a reviewer
probes it — the opposite of the goal. So every place this draft needs a real
fact, it's marked **`[ROY: …]`**. Fill those with the truth (you have genuine
first-hand knowledge of Bangkok especially), or cut the sentence. Don't ship the
brackets.

---

## Site-wide E-E-A-T scaffolding (do this once, benefits every post)

These are structural, not per-post, and they move the needle more than any prose
edit:

1. **Real author identity.** Add an `author` field to `BlogPost` (name, one-line
   bio, and ideally a `/about` or author page URL). A byline + bio is the single
   biggest Experience/Expertise/Authoritativeness signal you're missing.
   `[ROY: decide the author — you personally, a pen name you'll stand behind, or
   a small named "Folio Voyage editors" masthead with a real editor named.]`
2. **`Person`/`Organization` JSON-LD + `author` on `Article` JSON-LD.** The blog
   post pages currently emit no `Article` structured data (the destination pages
   have schema; blog posts don't). Add `Article` schema with `author`,
   `datePublished`, `dateModified`, and `publisher` (Folio Voyage +
   `Organization` with `sameAs` your real social profiles). This is both an
   E-E-A-T signal and a Technical-SEO gap flagged in the audit.
3. **Visible dates.** Render `displayDate` **and** a "Last reviewed" date in the
   post header. Freshness + review cadence is a Trust signal.
4. **An editorial-standards / "how we research" line** linking to the
   `how-we-choose-what-to-feature` post and the affiliate disclosure, in each
   post footer. Trust.
5. **Real outbound citations** where a claim is checkable (opening hours,
   UNESCO status, official sites). Linking *out* to authorities is an
   Authoritativeness signal, not a leak. Use `rel="noopener"` (not `nofollow` —
   these are editorial, not paid).
6. **Fix the fabricated testimonials** (see audit) before a reviewer contrasts
   "Booked Bangkok" social proof with a site that has no booking flow — it
   undermines the same Trust these posts are trying to build.

Suggested `BlogPost` shape additions:

```ts
author: {
  name: string;          // real or a byline you stand behind
  bio: string;           // one line, credentials/first-hand basis
  url?: string;          // /about or author page
};
lastReviewed?: string;   // ISO — surfaced as "Last reviewed"
sources?: { label: string; url: string }[];  // outbound citations
```

---

## Post 1 — How we choose what to feature

**Category:** Behind the folio · **Slug:** `how-we-choose-what-to-feature`
**E-E-A-T role:** This is your cornerstone Trust page — the "editorial standards"
document Google and OTA reviewers look for. Strengthen it the most.

**Suggested byline:** `[ROY: real author]` — *Founder / Editor, Folio Voyage*
**Suggested bio:** `[ROY: e.g. "I've spent X years travelling independently
across Southeast Asia and Europe and started Folio Voyage to write the guide I
kept wishing existed."]`

**Excerpt (sharpened):**
> Curation only means something if you can see the rules. Here is the exact bar
> an experience has to clear before it earns a place on a Folio Voyage guide —
> and the firewall between what we recommend and what we earn.

**Body:**

> Every travel site on earth calls itself "curated." Almost none will tell you
> what the word costs them — what gets *cut*. Curation that never rejects
> anything is just a catalogue with better adjectives. So here, in the open, is
> the bar and the method behind every guide on this site.

> **The bar: worth the time, real, and honest about the catch.**

> *Worth the time.* Travel time is the scarcest currency you carry, and a
> mediocre "top attraction" that eats half a day is worse than a free afternoon.
> The test is simple and personal: would we send a close friend here, knowing
> their trip is short? If the honest answer is "only if they've already seen the
> better thing," it doesn't make the guide. `[ROY: optional — name one
> genuinely famous sight you deliberately leave off a guide, and why. A specific
> "we cut this" example is the strongest possible proof the filter is real.]`

> *Real.* We weight places, meals, and walks that reward you for physically
> showing up over the ones that photograph better than they feel. The
> tree-root Buddha at Ayutthaya, the first bite of a custard tart still warm
> from the oven in Belém, the screech of Tram 28 taking a corner it has no
> business taking — these reward presence. A viewpoint that's identical to its
> own postcard does not.

> *Honest about the catch.* Every recommendation carries its trade-off in the
> same breath: the 11 a.m. crowd, the tourist-trap version two streets over, the
> cheaper way to do the same thing. A guide that only tells you what's good is
> selling; a guide that tells you the catch is helping.

> **The firewall: how we make money, and what it does *not* buy.**

> Folio Voyage is reader-supported. When affiliate booking links go live, some
> links to partners like Viator and GetYourGuide will earn us a commission at no
> extra cost to you — the full detail is in our
> [affiliate disclosure](/legal/disclosure). Here's the part that matters for
> trust: **commission never moves anything up a page, onto a guide, or into a
> "recommended."** The editorial list is decided first and separately; the
> money attaches to it afterward, or not at all. If those two things ever
> conflict, the guide wins. That rule is the whole business — break it once and
> the site is worthless.

> **How we research.** `[ROY: one or two true sentences on your actual process —
> first-hand visits, time on the ground, local sources, how often you re-check.
> Even "much of this comes from living in and around these cities" is a powerful
> Experience signal if it's true.]`

**Trust footer (all posts):**
> Written independently and reviewed on `[lastReviewed]`. We update guides when
> the facts change. Questions about how we earn or curate?
> [Read our disclosure](/legal/disclosure) or [get in touch](/legal/contact).

**Internal links:** disclosure, contact, `/destinations`.
**Outbound citation candidates:** FTC Endorsement Guides (backs the "firewall"
claim). `[ROY: confirm before linking.]`

---

## Post 2 — Your first 24 hours in Bangkok

**Category:** City guide · **Slug:** `bangkok-first-24-hours`
**E-E-A-T role:** Your strongest **Experience** post, because you actually know
Bangkok. Lean all the way into first-hand, specific, local detail — this is
where the site can outclass generic AI-spun travel blogs. Per the project notes,
Bangkok is yours to refine, so treat the `[ROY: …]` prompts here as the point,
not the exception.

**Suggested byline:** `[ROY: real author]` — *writing from first-hand time in
Bangkok*
**Suggested bio:** `[ROY: your genuine connection to the city — how long, how
often, what you know that a guidebook doesn't.]`

**Excerpt (sharpened):**
> Land, beat the jet lag, and see the best of the old city in one well-paced day
> — temples in the cool morning, the river through the heat, Chinatown after
> dark. Timed the way someone who knows the city would actually do it.

**Body:**

> Bangkok overwhelms newcomers in the first hour and then, if you get the rhythm
> right, wins them over by the last. The whole trick for day one is to stop
> fighting the heat and start using it: move early, disappear through the worst
> of the afternoon, and let the city bring you back to life after dark.

> **Dawn to late morning — the old royal island.** Start in Rattanakosin. The
> Grand Palace and Wat Pho open early `[ROY: confirm current opening times —
> Grand Palace is typically 08:30; state it precisely and cite the official
> site so this reads as checked, not guessed]`, and they are transformed by
> being early: the gilded courtyards are near-empty, the light is kind, and the
> heat hasn't arrived. Cover shoulders and knees — it's enforced at the gate,
> and the sarong-rental queue is its own small penance. `[ROY: one true
> insider line here — the entrance most people miss, the ticket trick, where to
> get the first good coffee nearby. This is the sentence a real local has and a
> scraper doesn't.]`

> **Through the heat — get on the water.** By late morning the pavement turns
> hostile, so do what Bangkokians have done for centuries and take to the river.
> The Chao Phraya express boat is the cheapest, best-moving way through the city
> `[ROY: name the line/pier you'd actually use — e.g. the orange-flag boat, and
> the pier for Wat Arun]`, and it drops you at the foot of Wat Arun for the
> crossing. Climb the steep central prang if it's open, then use the hottest
> hours the way the city does — slowly, indoors, ideally over lunch. `[ROY: your
> genuine lunch pick near the river, with the dish. Specificity = expertise.]`

> **After dark — Yaowarat.** As the temperature drops, Chinatown's main drag
> turns into one long open-air kitchen. The method is simple: walk it once
> without stopping to see what's busy, then double back to the stalls with the
> longest local queues. `[ROY: two or three dishes/stalls you'd actually send a
> friend to — the guay jub, the specific char-grill cart, the mango sticky rice
> stand. Real names beat "try the street food."]` End the night here and you'll
> have your first great meal of the trip and, more importantly, the city's
> pulse.

> **If you have a second morning,** point it at the water again — a long-tail
> into the Thonburi khlongs shows you the Bangkok the roads never reach. See the
> full [Bangkok guide](/destinations/bangkok) for the week beyond day one.

**Internal links:** `/destinations/bangkok` (primary), individual experiences if
you deep-link them later.
**Outbound citation candidates:** official Grand Palace site / BMTA river-boat
info for opening times and fares. `[ROY: link the real ones you rely on.]`

---

## Post 3 — In praise of shoulder-season travel

**Category:** Travel smarter · **Slug:** `shoulder-season-travel`
**E-E-A-T role:** **Expertise + Authoritativeness.** This is a claim-driven post
("cheaper, quieter, better") — back the claims with specifics and, ideally, one
real data point, and it stops reading like an opinion and starts reading like
someone who knows.

**Suggested byline:** `[ROY: real author]`
**Excerpt (sharpened):**
> The weeks either side of peak are the quiet sweet spot — smaller crowds,
> better light, lower prices, and cities that feel like themselves again. Here's
> when the shoulder actually falls, city by city.

**Body:**

> Ask people who travel for a living when they go, and you'll almost never hear
> "peak season." The shoulder — the weeks just before the crowds arrive and just
> after they leave — is quietly the best window to be almost anywhere, and the
> reasons aren't vibes, they're mechanics.

> **The mechanics.** Three things move together off-peak. Accommodation and
> experience prices soften as demand drops `[ROY: if you can cite even one
> concrete example — "a riverside room in Lisbon runs roughly X% less in October
> than August" — do; a single real number lifts the whole post's authority.
> Otherwise keep it qualitative and honest]`. The queues at headline sights
> shrink, which changes not just your wait but your whole experience of a place —
> Kyoto's temples in late November or Rome's Forum in October are a genuinely
> different, better visit than the same sights shoulder-to-shoulder in high
> summer. And the destination stops performing for a peak-season audience and
> goes back to being itself.

> **When the shoulder actually falls** (the useful part most posts skip):
> - **Kyoto** — the ragged edges of the two peaks: early December after the
>   maples, or the weeks before cherry blossom. See the
>   [Kyoto guide](/destinations/kyoto).
> - **Rome / Lisbon** — spring and autumn, roughly April–May and
>   late September–October, dodge both the crowds and the August heat.
> - **Hanoi** — October–November and March–April, either side of the summer
>   rains. `[ROY: sanity-check these against your own experience and the
>   destination guides' "best time" fields so the post and the guides agree.]`

> **The honest trade-off.** You're buying lower prices and smaller crowds with a
> little more weather risk — a rainy day is likelier. But a light rain in Lisbon
> or a crisp grey morning in Hanoi is a small tax for having the place to
> yourself, and flexibility is almost always cheaper than fighting the peak.

> Every Folio Voyage destination guide states the honest best-time-to-go for
> exactly this reason — and more often than not, it isn't the month everyone
> else is travelling.

**Internal links:** the destination guides named (Kyoto, Rome, Lisbon, Hanoi).
**Authoritativeness lift:** the city-by-city "when the shoulder falls" list is
the concrete expertise that generic versions of this post never include — keep
it accurate and it does the heavy lifting.

---

## Post 4 — Eat where the locals queue

**Category:** Food & drink · **Slug:** `eat-where-the-locals-queue`
**E-E-A-T role:** **Experience.** Short and strong already; the upgrade is
turning the general rule into named, first-hand proof.

**Suggested byline:** `[ROY: real author]`
**Excerpt (unchanged — it's good):** keep current.

**Body:**

> If you keep one rule for eating well on the road, make it this: **eat where the
> locals queue.** It costs nothing, needs no app, and travels from a Hanoi pho
> cart to a Roman trattoria without translation.

> **Why the queue works.** A line of *locals* is a live, self-correcting review
> written by the people with the most to lose from a bad meal and the most
> alternatives within walking distance. It updates in real time and can't be
> bought. A line of *tourists* tells you only that a place is famous — a
> different and much weaker signal, and often a lagging one.

> **Read the line, not just its length.** Who's in it at what time? A cart mobbed
> by office workers at 12:30 on a Tuesday is telling you something a queue of
> lanyard-wearing tour groups at 3 p.m. is not. `[ROY: one true first-hand
> example makes this — the specific Hanoi corner where the pho line is all
> locals at 7 a.m., the Roman spot two streets off the piazza. Name it. This is
> the line that proves you've actually done this.]`

> **The corollary.** Be actively suspicious of the opposite signals: laminated
> menus with photos, staff waving you in from the doorway, and prime real estate
> pressed against the big sight. Walk two streets back, follow the person on
> their lunch break, and you'll eat better for less almost everywhere. Our
> [Hanoi](/destinations/hanoi) and [Rome](/destinations/rome) guides are built
> on exactly this instinct.

**Internal links:** Hanoi, Rome (both food-heavy guides).

---

## Post 5 — The one-neighbourhood rule

**Category:** Travel smarter · **Slug:** `one-neighbourhood-rule`
**E-E-A-T role:** **Expertise.** Ties directly to the "where to base yourself"
sections already in your destination guides — make that link explicit so the
blog and the product reinforce each other's authority.

**Suggested byline:** `[ROY: real author]`
**Excerpt (sharpened):**
> Where you sleep shapes a trip more than which sights you tick off. A simple
> rule for picking a base that makes a city feel like home instead of a
> checklist.

**Body:**

> Travellers agonise over which sights to see and barely think about where
> they'll sleep — which is backwards. The neighbourhood you base yourself in
> shapes your mornings, your meals, your walk home, and your whole sense of a
> place far more than any single attraction on the list.

> **The rule:** pick *one* neighbourhood that matches how you actually want to
> travel, and let the rest of the trip radiate out from it. Not the most
> central on the map — the one whose *default day* looks like the trip you want.

> **What "matches how you travel" means in practice.** Want to be in the thick
> of it, steps from the noise and the food? The old quarter — Alfama in Lisbon,
> Rattanakosin or Yaowarat in Bangkok. Want calm, good coffee, and room to
> breathe, trading a little convenience for it? The leafy residential district
> one ride out — Tay Ho by Hanoi's West Lake, Kyoto's Higashiyama slopes.
> Travelling with kids or a crowd changes the answer again: flat, walkable, and
> near transit beats atmospheric-but-vertical every time. `[ROY: your own base
> in a city you know well, and why it worked — one true example turns the rule
> from advice into experience.]`

> This is why every Folio Voyage city guide includes honest **"where to base
> yourself"** notes — not a list of hotels, but which neighbourhood suits which
> kind of traveller and why. Start with the
> [Lisbon](/destinations/lisbon) or [Bangkok](/destinations/bangkok) guide and
> pick your one neighbourhood before you pick anything else.

**Internal links:** Lisbon, Bangkok (and any guide with neighbourhood notes — all
of them have `neighbourhoods`).

---

## Integration checklist

- [ ] `[ROY: …]` placeholders resolved with true facts or cut.
- [ ] Decide + add real `author` (name, bio, url) — site-wide.
- [ ] Add `Article` + `author`/`publisher` JSON-LD to blog post pages
      (also closes the audit's blog-schema gap).
- [ ] Surface `displayDate` + "Last reviewed" in the post header.
- [ ] Add the shared Trust footer (disclosure + contact) to the post template.
- [ ] Verify opening times / prices before publishing any citation.
- [ ] Re-check each post's "best time" claims against the destination guides so
      the two never contradict.
- [ ] Resolve the fabricated-testimonials issue (see audit) so on-site social
      proof doesn't undercut these posts' trust signals.
