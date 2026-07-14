import { IMG } from "./media";

/**
 * The Folio — Folio Voyage's blog. Original, substantive travel editorial that
 * doubles as SEO content and supports the affiliate application (real writing,
 * not placeholder posts).
 *
 * E-E-A-T note: each post carries an `author`, a `date` (published) and a
 * `lastReviewed` date, surfaced as a visible byline + "Last reviewed" line and
 * as BlogPosting JSON-LD (author + publisher + datePublished/dateModified).
 * The author below is an honest editorial identity — replace `FOLIO_AUTHOR`
 * with a real named byline (e.g. Roy) for the strongest Experience/Expertise
 * signal. Bodies deliberately stay within what can be stated truthfully; add
 * first-hand specifics (Roy's Bangkok local detail especially) over time.
 */

export interface Author {
  name: string;
  /** One-line basis for authority — kept truthful. */
  bio: string;
  /** A real on-site page for the byline to link to. */
  url: string;
}

/**
 * Honest default author. This is the editorial team, not a fabricated
 * individual with invented credentials. Swap for a real personal byline when
 * ready — that is the single biggest E-E-A-T lift available here.
 */
export const FOLIO_AUTHOR: Author = {
  name: "Folio Voyage Editorial",
  bio: "The editors behind Folio Voyage — independent, originally-written city guides grounded in time spent in each destination.",
  url: "/legal/contact",
};

export interface BlogPost {
  slug: string;
  title: string;
  date: string; // ISO — first published
  displayDate: string;
  /** ISO — last editorial review (freshness/trust signal). */
  lastReviewed: string;
  category: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  readingTime: string;
  /** Defaults to FOLIO_AUTHOR at the call site when omitted. */
  author?: Author;
  /** Persona ids (see data/personas.ts) this post is most useful for. */
  personas: string[];
  /** Destination slug surfaced as the "featured" sidebar card on the post. */
  featuredDestination?: string;
  body: string[];
}

export const posts: BlogPost[] = [
  {
    slug: "how-we-choose-what-to-feature",
    title: "How we choose what to feature",
    date: "2026-06-28",
    displayDate: "June 28, 2026",
    lastReviewed: "2026-07-14",
    category: "Behind the folio",
    excerpt:
      "Curation only means something if you can see the rules. Here's the exact bar an experience has to clear to earn a place on a Folio Voyage guide — and the firewall between what we recommend and what we earn.",
    image: IMG.lis_alfama,
    imageAlt: "A tiled, cobbled street in the Alfama district of Lisbon",
    readingTime: "4 min read",
    personas: ["luxury", "backpacker"],
    featuredDestination: "lisbon",
    body: [
      "Every travel site on earth calls itself \"curated.\" Almost none will tell you what the word costs them — what gets cut. Curation that never rejects anything is just a catalogue with better adjectives. So here, in the open, is the bar behind every guide on this site.",
      "The bar is three tests. First, worth the time: travel time is the scarcest thing you carry on a trip, and a mediocre \"top attraction\" that eats half a day is worse than a free afternoon. The check is simple and personal — if we wouldn't send a good friend, knowing their days are limited, it doesn't go in.",
      "Second, real: we weight the places, meals, and walks that reward you for physically showing up over the ones that photograph better than they feel. And third, honest about the catch: every recommendation carries its trade-off in the same breath — the 11am crowd, the tourist-trap version two streets over, the cheaper way to do exactly the same thing.",
      "Then there is the firewall, which is what makes the rest worth trusting. Folio Voyage is reader-supported: when booking links go live, some will be affiliate links to partners like Viator and GetYourGuide that earn us a commission at no extra cost to you — the full detail is on our affiliate disclosure page. The rule is absolute: a commission never moves anything up a page or onto a guide. The editorial list is decided first and separately; the money attaches to it afterward, or not at all. If the two ever conflict, the guide wins.",
      "That is the whole method — worth the time, real, honest about the catch, and independent of what we earn. It is the same bar every destination guide and every post in The Folio is held to.",
    ],
  },
  {
    slug: "bangkok-first-24-hours",
    title: "Your first 24 hours in Bangkok",
    date: "2026-06-21",
    displayDate: "June 21, 2026",
    lastReviewed: "2026-07-14",
    category: "City guide",
    excerpt:
      "Land, beat the jet lag, and see the best of the old city in one well-paced day — temples in the cool morning, the river through the heat, Chinatown after dark.",
    image: IMG.bkk_yaowarat,
    imageAlt: "Neon signs and crowds along Yaowarat Road in Bangkok's Chinatown at night",
    readingTime: "6 min read",
    personas: ["weekend", "solo"],
    featuredDestination: "bangkok",
    body: [
      "Bangkok can overwhelm you in the first hour and then, if you get the rhythm right, win you over by the last. The whole trick for a first day is to work with the heat instead of against it: move early, disappear through the worst of the afternoon, and let the city come back to life after dark.",
      "Morning belongs to the old royal island of Rattanakosin. The Grand Palace and Wat Pho open early and are transformed by being early — the gilded courtyards are near-empty, the light is kind, and the heat hasn't arrived. Cover your shoulders and knees; it's enforced at the gate, and the sarong-rental queue is its own small penance.",
      "By late morning the pavement turns hostile, so do what Bangkok has done for centuries and take to the water. The Chao Phraya express boat is the cheapest, best-moving way through the city, and it sets you up to cross to Wat Arun for the late-afternoon light. Use the hottest hours the way locals do — slowly, indoors, over a long lunch.",
      "After dark, head to Yaowarat — Chinatown — where the main street becomes one long open-air kitchen. The method is simple: walk it once without stopping to see which stalls the locals are queuing at, then double back and graze your way down. End your first day here and you'll have both the best meal of the trip and a real feel for the city's pulse.",
      "That's a first day. For the week beyond it — the khlong canals, the markets, and the day trips out to Ayutthaya — see our full Bangkok guide, linked alongside this post.",
    ],
  },
  {
    slug: "shoulder-season-travel",
    title: "In praise of shoulder-season travel",
    date: "2026-06-14",
    displayDate: "June 14, 2026",
    lastReviewed: "2026-07-14",
    category: "Travel smarter",
    excerpt:
      "The weeks either side of peak are the quiet sweet spot — smaller crowds, better light, lower prices, and cities that feel like themselves again. Here's roughly when the shoulder falls, city by city.",
    image: IMG.kyo_kiyomizu,
    imageAlt: "The wooden veranda of Kiyomizu-dera temple above autumn foliage in Kyoto",
    readingTime: "5 min read",
    personas: ["backpacker", "luxury"],
    featuredDestination: "kyoto",
    body: [
      "Ask people who travel for a living when they go, and you'll almost never hear \"peak season.\" The shoulder — the weeks just before the crowds arrive and just after they leave — is quietly the best window to be almost anywhere, and the reasons aren't a vibe, they're mechanics.",
      "Three things move together off-peak. Prices for stays and experiences soften as demand drops. The queues at the headline sights shrink, which changes not just your wait but the whole feel of a place — Kyoto's temples in late autumn or Rome's Forum in October are a genuinely different, better visit than the same sights shoulder-to-shoulder in high summer. And the destination stops performing for a peak-season crowd and goes back to being itself.",
      "Roughly when the shoulder falls, for the cities we cover: Kyoto rewards the edges of its two peaks — the weeks around late-November colour and the run-up to spring blossom. Rome and Lisbon are at their best in spring and autumn, broadly April–May and late September–October, dodging both the crowds and the August heat. Hanoi's kindest windows are October–November and March–April, either side of the summer rains. Every destination guide states the honest best time to go for exactly this reason.",
      "The trade-off is weather variance — a rainy day is likelier. But light rain in Lisbon or a crisp grey morning in Hanoi is a small tax for having a place to yourself, and staying flexible is almost always cheaper than fighting the peak. More often than not, the best month to travel simply isn't the one everyone else picks.",
    ],
  },
  {
    slug: "eat-where-the-locals-queue",
    title: "Eat where the locals queue",
    date: "2026-06-07",
    displayDate: "June 7, 2026",
    lastReviewed: "2026-07-14",
    category: "Food & drink",
    excerpt:
      "The single most reliable rule for eating well while travelling costs nothing and works almost everywhere. Here's why the queue — and who's in it — is your best guide.",
    image: IMG.han_eggcoffee,
    imageAlt: "A glass of Vietnamese egg coffee topped with whipped egg-yolk cream",
    readingTime: "3 min read",
    personas: ["backpacker", "solo"],
    featuredDestination: "hanoi",
    body: [
      "If you keep one rule for eating well on the road, make it this: eat where the locals queue. It costs nothing, needs no app, and travels from a Hanoi pho cart to a Roman trattoria without translation.",
      "Here's why it works. A line of locals is a live, self-correcting review written by the people with the most to lose from a bad meal and the most alternatives within walking distance. It updates in real time and can't be bought. A line of tourists tells you only that a place is famous — a different and much weaker signal, and often a lagging one.",
      "So read the line, not just its length. A cart mobbed by office workers at half past twelve on a weekday is telling you something a queue of tour groups at three in the afternoon is not. Notice who is actually in it, and at what hour.",
      "The corollary matters just as much: be actively suspicious of the opposite signals — laminated menus with photos, staff waving you in from the doorway, and prime real estate pressed against the big sight. Walk two streets back, follow the person on their lunch break, and you'll eat better for less almost everywhere. Our Hanoi and Rome guides are built on exactly this instinct.",
    ],
  },
  {
    slug: "one-neighbourhood-rule",
    title: "The one-neighbourhood rule",
    date: "2026-05-30",
    displayDate: "May 30, 2026",
    lastReviewed: "2026-07-14",
    category: "Travel smarter",
    excerpt:
      "Where you sleep shapes a trip more than which sights you tick off. A simple rule for choosing a base that makes a city feel like home instead of a checklist.",
    image: IMG.lis_tram,
    imageAlt: "A yellow vintage tram climbing a narrow street in Lisbon",
    readingTime: "4 min read",
    personas: ["family", "weekend"],
    featuredDestination: "lisbon",
    body: [
      "Travellers agonise over which sights to see and barely think about where they'll sleep — which is backwards. The neighbourhood you base yourself in shapes your mornings, your meals, your walk home, and your whole sense of a place far more than any single attraction on the list.",
      "The rule is simple: pick one neighbourhood that matches how you actually want to travel, and let the rest of the trip radiate out from it. Not the most central dot on the map — the one whose default day looks like the trip you want.",
      "In practice that means being honest about your own preferences. Want to be in the thick of it, steps from the noise and the food? The old quarter — Alfama in Lisbon, the old town in Bangkok. Want calm, good coffee, and room to breathe, trading a little convenience for it? The leafy residential district one ride out, like Hanoi's West Lake. Travelling with kids or a group changes the answer again: flat, walkable, and near transit beats atmospheric-but-vertical every time.",
      "This is why every Folio Voyage city guide includes honest \"where to base yourself\" notes — not a list of hotels, but which neighbourhood suits which kind of traveller, and why. Pick your one neighbourhood before you pick anything else, and a city starts to feel a little like home instead of a checklist.",
    ],
  },
];

export function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}
