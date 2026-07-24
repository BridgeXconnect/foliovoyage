import { IMG } from "./media";

/**
 * The Folio — Folio Voyage's blog. Original, researched, cited travel editorial
 * that doubles as SEO content and supports the affiliate application (real,
 * substantive writing, not placeholder posts).
 *
 * Voice: editorial / curatorial ("we recommend", "most travellers find") — the
 * publisher curating and recommending experiences. It deliberately makes NO
 * first-person "I went / we ate there" claims. Every time-sensitive fact
 * (hours, fares, ticket rules, seasons) traces to a cited source in `sources`;
 * these change, so posts also tell readers to confirm before travelling.
 *
 * E-E-A-T: each post carries an `author`, `date` (published) + `lastReviewed`
 * (rendered as byline + "Last reviewed"), structured headings, curated `pick`
 * callouts linking to the canonical destination guides, and a visible Sources
 * list — surfaced in BlogPosting JSON-LD (author, publisher, dateModified,
 * citation). Swap `FOLIO_AUTHOR` for a real named byline for the strongest
 * Experience/Expertise signal.
 */

export interface Author {
  name: string;
  bio: string;
  url: string;
}

export const FOLIO_AUTHOR: Author = {
  name: "Folio Voyage Editorial",
  bio: "The editors behind Folio Voyage — independent, originally-written and researched city guides, curating the tours and experiences worth your time.",
  url: "/legal/contact",
};

/** A structured content block. Rendered by components/covilla/BlogBody.tsx. */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "list"; items: string[] }
  /**
   * Curated recommendation callout — the "tours & experiences" element.
   * Mirrors the Experience affiliate seam: `href` points at the destination
   * guide today and can become a disclosed affiliate deep link later.
   */
  | { kind: "pick"; title: string; note: string; meta?: string; href?: string };

/** A cited source. Rendered as an external, verified link (rel="noopener"). */
export interface Source {
  label: string;
  url: string;
  publisher?: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  date: string; // ISO — first published
  displayDate: string;
  lastReviewed: string; // ISO — last editorial review
  category: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  readingTime: string;
  author?: Author;
  personas: string[];
  featuredDestination?: string;
  body: Block[];
  sources: Source[];
}

export const posts: BlogPost[] = [
  // ────────────────────────────────────────────────────────────────────────
  // City guides (high-intent, destination + activity content)
  // ────────────────────────────────────────────────────────────────────────
  {
    slug: "best-things-to-do-in-bangkok",
    title: "The best things to do in Bangkok",
    date: "2026-07-10",
    displayDate: "July 10, 2026",
    lastReviewed: "2026-07-14",
    category: "City guide",
    excerpt:
      "A curated, practical guide to Bangkok's best experiences: the temples, the river, the markets and the street food, with what each one costs, when to go, and how to string them together.",
    image: IMG.bkk_grand_palace,
    imageAlt:
      "Golden spires and ornate rooftops of Wat Phra Kaew inside the Grand Palace, Bangkok",
    readingTime: "8 min read",
    personas: ["weekend", "solo", "backpacker"],
    featuredDestination: "bangkok",
    body: [
      {
        kind: "p",
        text: "Bangkok stacks the old and the new on top of each other and hands you a plate. In a single day you can watch monks collect alms at dawn, tour gilded palaces by mid-morning, and eat some of the best food of your life on a plastic stool at midnight. This is our curated shortlist of the experiences worth building a trip around — with the practical detail, current as of mid-2026, to make each one work.",
      },
      {
        kind: "h2",
        text: "How many days you need",
      },
      {
        kind: "p",
        text: "Three full days is the sweet spot for a first visit: one for the old royal island of Rattanakosin and its temples, one for the river and markets, and one for a day trip to the ruins of Ayutthaya or a floating market. Add a fourth if you want time for a cooking class, a spa afternoon, or simply to slow down through the heat. Plan the temples for early morning, hide from the fierce afternoon sun, and let the city come alive again after dark.",
      },
      {
        kind: "h2",
        text: "The experiences worth your time",
      },
      {
        kind: "pick",
        title: "The Grand Palace & Wat Phra Kaew",
        note: "Bangkok's most dazzling complex and the home of the Emerald Buddha. It is open daily 08:30–15:30 and the 500-baht ticket also covers the Emerald Buddha temple; there is a strict dress code (shoulders and knees covered), with sarongs available to borrow at the gate. Go at opening to beat both the heat and the tour groups.",
        meta: "฿500 · Half day",
        href: "/destinations/bangkok",
      },
      {
        kind: "pick",
        title: "Wat Pho & the Reclining Buddha",
        note: "A 46-metre gold-leafed Buddha and the birthplace of Thai massage, a short walk south of the Grand Palace. Open daily from around 08:00, with a 300-baht foreigner entry (2026). Book a traditional massage at the temple's famous school afterwards — you are at the source.",
        meta: "฿300 · 2–3 hours",
        href: "/destinations/bangkok",
      },
      {
        kind: "pick",
        title: "Wat Arun at golden hour",
        note: "The Temple of Dawn is best at dusk, when its Khmer-style prang catches the low light and the river turns molten. Cross by the small ferry from Tha Tien pier, climb the steep central steps, then take a riverside drink on the far bank facing back at it.",
        meta: "฿ · 2 hours",
        href: "/destinations/bangkok",
      },
      {
        kind: "pick",
        title: "Yaowarat (Chinatown) after dark",
        note: "After sundown, Chinatown's main drag becomes an open-air kitchen: charcoal-grilled seafood, guay jub noodle soup, and mango sticky rice from stalls that have run for generations. The method is simple — walk it once to see where the locals are queuing, then double back and graze.",
        meta: "฿ · Evening",
        href: "/destinations/bangkok",
      },
      {
        kind: "pick",
        title: "Ayutthaya, the ancient capital",
        note: "Thailand's former royal capital, a UNESCO site of crumbling brick prangs and the famous stone Buddha head cradled in tree roots. An easy day trip north by train or minivan, best explored by rented bicycle in the cool of the morning.",
        meta: "฿฿ · Full day",
        href: "/destinations/bangkok",
      },
      {
        kind: "h2",
        text: "Getting around",
      },
      {
        kind: "p",
        text: "The river is the key to the old city, and the cheapest way to see it. The dedicated Chao Phraya Tourist Boat (blue flag) runs an all-day hop-on-hop-off pass between Sathorn and Phra Athit piers roughly every half hour, linking the Grand Palace, Wat Pho, Wat Arun and Chinatown. For modern Bangkok (the malls, rooftop bars and Sukhumvit) the BTS Skytrain and MRT metro are fast, air-conditioned and beat the notorious traffic. Metered taxis and ride-hailing apps fill the gaps; agree on the meter before you set off.",
      },
      {
        kind: "h2",
        text: "When to go",
      },
      {
        kind: "p",
        text: "The cool, dry season from November to February is the most comfortable window and the peak. March to May is intensely hot; June to October brings the monsoon, with short, heavy downpours rather than all-day rain and noticeably lower prices. Whenever you come, structure the day around the heat: temples and markets in the morning, shade in the afternoon, street food at night.",
      },
      {
        kind: "p",
        text: "For the full write-up, with every experience, neighbourhood notes on where to base yourself, and the best time to visit in detail, see our complete Bangkok guide. Booking links go live as our partner programs are approved; until then, treat this as an independent planning guide.",
      },
    ],
    sources: [
      {
        label: "The Grand Palace — official visitor information",
        url: "https://www.royalgrandpalace.th/en/schedules",
        publisher: "Bureau of the Royal Household",
      },
      {
        label: "Wat Pho — official ticketing",
        url: "https://www.watphobooking.com/",
        publisher: "Wat Pho",
      },
      {
        label: "Chao Phraya Tourist Boat — routes, piers & passes",
        url: "https://chaophrayatouristboat.com/",
        publisher: "Chao Phraya Tourist Boat",
      },
    ],
  },
  {
    slug: "best-things-to-do-in-kyoto",
    title: "The best things to do in Kyoto",
    date: "2026-07-08",
    displayDate: "July 8, 2026",
    lastReviewed: "2026-07-14",
    category: "City guide",
    excerpt:
      "Kyoto rewards the traveller who slows down. A curated guide to the temples, shrines, gardens and food worth your time in Japan's old capital — with hours, access and how to dodge the crowds.",
    image: IMG.kyo_fushimi,
    imageAlt:
      "A tunnel of vermilion torii gates ascending the hillside at Fushimi Inari shrine, Kyoto",
    readingTime: "8 min read",
    personas: ["luxury", "solo", "family"],
    featuredDestination: "kyoto",
    body: [
      {
        kind: "p",
        text: "For over a thousand years Kyoto was Japan's imperial capital, and it still feels like the country's cultural conscience — the place where tea ceremony, Zen gardens and the geisha districts were refined into something close to art. Its rewards are quiet ones, and they go to travellers who slow down, start early, and leave gaps in the day. Here is our curated shortlist of what is worth your time, and how to see it before the crowds arrive.",
      },
      {
        kind: "h2",
        text: "How many days you need",
      },
      {
        kind: "p",
        text: "Three days lets Kyoto breathe: one for the eastern Higashiyama temples, one for the western Arashiyama district and the Golden Pavilion, and one for a slower mix of gardens, markets and a day trip to nearby Nara. The city is compact, ringed by wooded hills and easy to cycle, but the headline sights sit on opposite sides of town — so the single most useful habit is booking the popular temples for opening time and building the day outward from there.",
      },
      {
        kind: "h2",
        text: "The experiences worth your time",
      },
      {
        kind: "pick",
        title: "Fushimi Inari's torii gates",
        note: "Thousands of vermilion torii tunnel up a sacred mountain in a seemingly endless procession. It is free and open 24 hours — which is its secret: come at dawn (it is a five-minute walk from JR Inari station) and climb past the crowded lower shrine to the near-empty upper trails. The full loop to the 233-metre summit takes two to three hours.",
        meta: "Free · 2–3 hours",
        href: "/destinations/kyoto",
      },
      {
        kind: "pick",
        title: "Kinkaku-ji, the Golden Pavilion",
        note: "A gold-leafed Zen temple mirrored in its own reflecting pond, and Kyoto's most photographed sight for good reason. Open 09:00–17:00 with a 500-yen entry; it is small but perfect, so pair it with the nearby raked rock garden at Ryōan-ji to make a morning of the north-west.",
        meta: "¥500 · 1–2 hours",
        href: "/destinations/kyoto",
      },
      {
        kind: "pick",
        title: "Arashiyama bamboo grove",
        note: "Towering green stalks filter the light along a path on Kyoto's western edge. It is free and always open, so go at first light before the crowds, then continue to Tenryū-ji's garden and the monkey park on the hill above the river. It is a ten-minute walk from Saga-Arashiyama station on the JR Sagano line.",
        meta: "Free · Half day",
        href: "/destinations/kyoto",
      },
      {
        kind: "pick",
        title: "Kiyomizu-dera & the Higashiyama lanes",
        note: "A vast wooden temple on stilts with a hillside view over the city, reached through the preserved slopes of Sannenzaka and Ninenzaka. It opens early (around 06:00) with a modest entry fee — do it first thing, then wander down the lantern-lit lanes for tea and craft shops.",
        meta: "¥400 · Half day",
        href: "/destinations/kyoto",
      },
      {
        kind: "pick",
        title: "A traditional tea ceremony",
        note: "Sit through the deliberate, meditative ritual of whisked matcha and seasonal sweets, guided by a host in a tatami room. It is the most direct way to feel the aesthetic that shaped the whole city — and a welcome, air-conditioned pause in the middle of a temple-heavy day.",
        meta: "¥¥ · 1–2 hours",
        href: "/destinations/kyoto",
      },
      {
        kind: "h2",
        text: "Getting around",
      },
      {
        kind: "p",
        text: "Kyoto runs on a mix of city buses, two subway lines and the JR and private railways that reach the outer sights. A rechargeable IC card (ICOCA or Suica) works on almost everything and saves fumbling for change. Distances in the centre are walkable and the city is famously flat and cyclable — renting a bike for a day is one of the nicest ways to link the eastern temples. For Fushimi Inari and Arashiyama, the train is faster than the bus.",
      },
      {
        kind: "h2",
        text: "When to go",
      },
      {
        kind: "p",
        text: "The two headline seasons are cherry blossom (typically late March to early April) and autumn colour (November) — both spectacular and both very crowded. If you can, travel the shoulder weeks on either edge, or simply commit to being at each temple for opening time; an hour's discipline in the morning is worth more than any secret spot. Summer is hot and humid; winter is crisp, quiet and underrated.",
      },
      {
        kind: "p",
        text: "For the complete picture, with all the experiences, where to base yourself, and the day trip to Nara, see our full Kyoto guide.",
      },
    ],
    sources: [
      {
        label: "Fushimi Inari Taisha — official tourism listing",
        url: "https://www.japan.travel/en/spot/1128/",
        publisher: "Japan National Tourism Organization",
      },
      {
        label: "Kinkaku-ji (Golden Pavilion) — access & hours",
        url: "https://www.shokoku-ji.jp/en/kinkakuji/",
        publisher: "Shokoku-ji",
      },
      {
        label: "Kiyomizu-dera Temple — visitor information",
        url: "https://www.kiyomizudera.or.jp/en/",
        publisher: "Kiyomizu-dera",
      },
      {
        label: "Kyoto travel guide",
        url: "https://www.japan-guide.com/e/e2158.html",
        publisher: "japan-guide.com",
      },
    ],
  },
  {
    slug: "best-things-to-do-in-rome",
    title: "The best things to do in Rome",
    date: "2026-07-05",
    displayDate: "July 5, 2026",
    lastReviewed: "2026-07-14",
    category: "City guide",
    excerpt:
      "Three thousand years of empire, art and appetite, layered street on street. A curated guide to Rome's essential experiences — what to book ahead, when to go, and where the Romans actually eat.",
    image: IMG.rom_colosseum,
    imageAlt: "The tiered arches and arena floor inside the Roman Colosseum",
    readingTime: "9 min read",
    personas: ["luxury", "family", "weekend"],
    featuredDestination: "rome",
    body: [
      {
        kind: "p",
        text: "No city wears its history so openly as Rome. Here an ancient temple becomes a church becomes a fountain becomes the backdrop to your morning coffee — nearly three thousand years stacked one layer on the next. The headline sights earn their fame, but Rome's real pleasure is the everyday texture between them. This curated guide covers the experiences worth your time, what you must book ahead, and how to eat like a Roman.",
      },
      {
        kind: "h2",
        text: "How many days you need",
      },
      {
        kind: "p",
        text: "Three days covers the essentials without exhausting you: ancient Rome (Colosseum, Forum, Palatine), Vatican City (the Museums and St Peter's), and a slower day for the Pantheon, the fountains and the trattorias of Trastevere. A fourth day buys the Borghese Gallery and time simply to get lost, which in Rome is where some of the best moments happen. The one rule that changes your trip: book the big sights ahead — Rome now runs on timed entry.",
      },
      {
        kind: "h2",
        text: "The experiences worth your time",
      },
      {
        kind: "pick",
        title: "Colosseum, Forum & Palatine",
        note: "The beating heart of ancient Rome — the great amphitheatre, the ruined Forum where the Republic was run, and the palace hill above. A single timed ticket covers all three; entry is at the slot you book, tickets are released about 30 days ahead and sell out fast, so reserve early. A guide brings the stones to life.",
        meta: "€€ · Half day",
        href: "/destinations/rome",
      },
      {
        kind: "pick",
        title: "Vatican Museums & the Sistine Chapel",
        note: "Miles of galleries building to Michelangelo's ceiling, then St Peter's Basilica next door. The Museums open 09:00–18:00 Monday to Saturday (last entry 16:00) and entry is strictly timed — book the earliest slot or an after-hours tour to see the frescoes without the shoulder-to-shoulder crush.",
        meta: "€€€ · Half day",
        href: "/destinations/rome",
      },
      {
        kind: "pick",
        title: "The Pantheon",
        note: "The best-preserved building of ancient Rome, its coffered concrete dome still the largest of its kind after two millennia, lit by a single open oculus. It now charges a small timed-entry fee — quietly astonishing, and worth timing for when the light falls straight through the roof.",
        meta: "€ · 1 hour",
        href: "/destinations/rome",
      },
      {
        kind: "pick",
        title: "Trevi Fountain & Baroque Rome",
        note: "Rome's grandest fountain, a theatrical wall of gods and sea-horses tucked into a small square. It is free and always open, which is the catch — come at dawn or late at night to see it without the crush, coin toss and all.",
        meta: "Free · 1 hour",
        href: "/destinations/rome",
      },
      {
        kind: "pick",
        title: "Borghese Gallery & gardens",
        note: "A jewel-box villa of Bernini sculptures and Caravaggio paintings set in Rome's loveliest park. Entry is by timed reservation only, and slots are strictly capped — reserve well ahead, then stroll the gardens afterwards.",
        meta: "€€ · 2–3 hours",
        href: "/destinations/rome",
      },
      {
        kind: "h2",
        text: "Where the Romans actually eat",
      },
      {
        kind: "p",
        text: "Rome has four classic pastas (cacio e pepe, carbonara, amatriciana and gricia) and the rule for eating them well is to leave the sights behind. A real carbonara has no cream, only guanciale (cured pork cheek), pecorino and raw egg yolk; a real cacio e pepe is little more than pecorino, pepper and starchy pasta water, and it is harder to do well than it looks. Head for the trattorias of Testaccio and Trastevere, where locals eat every day, rather than the tourist-priced tables beside the big monuments, and, as ever, follow the queue of Romans on their lunch break.",
      },
      {
        kind: "h2",
        text: "Getting around & when to go",
      },
      {
        kind: "p",
        text: "Rome's historic centre is dense and walkable — most of the essentials are within a long stroll of each other, and a lot of the city's best moments come from rounding a corner with no plan. Two metro lines and the buses cover the longer hops. For timing, the shoulder seasons of April–May and September–October are the sweet spot: warm days of 18–24°C, manageable crowds, and hotel rates well below the July–August peak. Avoid Easter week (around 29 March–5 April in 2026), which draws Vatican-bound pilgrim crowds and higher prices.",
      },
      {
        kind: "p",
        text: "See our full Rome guide for the complete list, neighbourhood notes on where to stay, and the best time to visit in more detail.",
      },
    ],
    sources: [
      {
        label: "Colosseum & Roman Forum — official tickets & timed entry",
        url: "https://www.coopculture.it/en/",
        publisher: "CoopCulture (official ticketing)",
      },
      {
        label: "Vatican Museums — official visitor information",
        url: "https://www.museivaticani.va/content/museivaticani/en.html",
        publisher: "Vatican Museums",
      },
      {
        label: "Traditional Roman food, district by district",
        url: "https://www.italia.it/en/lazio/rome/things-to-do/traditional-roman-food-districts-of-rome",
        publisher: "Italia.it (Italian National Tourist Board)",
      },
      {
        label: "Best time of year to visit Rome",
        url: "https://www.walksofitaly.com/blog/travel-tips/best-time-of-year-to-visit-rome",
        publisher: "Walks of Italy",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Evergreen "travel smarter" posts
  // ────────────────────────────────────────────────────────────────────────
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
    imageAlt:
      "Neon signs and crowds along Yaowarat Road in Bangkok's Chinatown at night",
    readingTime: "6 min read",
    personas: ["weekend", "solo"],
    featuredDestination: "bangkok",
    body: [
      {
        kind: "p",
        text: "Bangkok can overwhelm you in the first hour and then, if you get the rhythm right, win you over by the last. The whole trick for a first day is to work with the heat instead of against it: move early, disappear through the worst of the afternoon, and let the city come back to life after dark. Here is a well-paced route through the old city that does exactly that.",
      },
      {
        kind: "h2",
        text: "Morning — the old royal island",
      },
      {
        kind: "p",
        text: "Morning belongs to Rattanakosin, the historic royal island. The Grand Palace opens at 08:30 and is transformed by being early: the gilded courtyards are near-empty, the light is kind, and the heat hasn't arrived. Dress for it: shoulders and knees must be covered, it is enforced at the gate, and the sarong-rental queue is its own small penance. From there it is a short walk to Wat Pho and its 46-metre Reclining Buddha, the birthplace of Thai massage — a good place to book a massage once the sun is high.",
      },
      {
        kind: "h2",
        text: "Through the heat — get on the water",
      },
      {
        kind: "p",
        text: "By late morning the pavement turns hostile, so do what Bangkok has done for centuries and take to the river. The Chao Phraya Tourist Boat runs an all-day pass up and down the water, and it sets you up to cross by ferry to Wat Arun, the Temple of Dawn, which catches the late-afternoon light beautifully. Use the hottest hours the way locals do, slowly, indoors, over a long lunch, and save your energy for the evening.",
      },
      {
        kind: "h2",
        text: "After dark — Yaowarat",
      },
      {
        kind: "p",
        text: "As the temperature drops, head to Yaowarat, or Chinatown, where the main street becomes one long open-air kitchen. The method is simple: walk it once without stopping to see which stalls the locals are queuing at, then double back and graze your way down. End your first day here and you will have both the best meal of the trip and a real feel for the city's pulse.",
      },
      {
        kind: "pick",
        title: "Plan the week beyond day one",
        note: "The canals of Thonburi, the vast Chatuchak weekend market, and the day trip to the ruins of Ayutthaya all reward a longer stay. Our full Bangkok guide lays out the best of them, with notes on where to base yourself.",
        href: "/destinations/bangkok",
      },
      {
        kind: "p",
        text: "A note for planning: opening hours, ferry timetables and dress rules do change, so confirm the specifics before you go — the sources below are the ones to check.",
      },
    ],
    sources: [
      {
        label: "The Grand Palace — opening schedule & dress code",
        url: "https://www.royalgrandpalace.th/en/schedules",
        publisher: "Bureau of the Royal Household",
      },
      {
        label: "Chao Phraya Tourist Boat — routes & timetable",
        url: "https://chaophrayatouristboat.com/",
        publisher: "Chao Phraya Tourist Boat",
      },
      {
        label: "Wat Pho — official ticketing & hours",
        url: "https://www.watphobooking.com/",
        publisher: "Wat Pho",
      },
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
      "The single most reliable rule for eating well while travelling costs nothing and works almost everywhere. Here's why the queue, and who's in it, is your best guide, city by city.",
    image: IMG.han_eggcoffee,
    imageAlt:
      "A glass of Vietnamese egg coffee topped with whipped egg-yolk cream",
    readingTime: "5 min read",
    personas: ["backpacker", "solo"],
    featuredDestination: "hanoi",
    body: [
      {
        kind: "p",
        text: "If you keep one rule for eating well on the road, make it this: eat where the locals queue. It costs nothing, needs no app, and travels from a Hanoi pho cart to a Roman trattoria without translation. Here is why it works — and how to read a queue properly, with a few dishes worth crossing a city for.",
      },
      {
        kind: "h2",
        text: "Why the queue works",
      },
      {
        kind: "p",
        text: "A line of locals is a live, self-correcting review written by the people with the most to lose from a bad meal and the most alternatives within walking distance. It updates in real time and cannot be bought. A line of tourists tells you only that a place is famous — a different and much weaker signal, and often a lagging one. So read the line, not just its length: a cart mobbed by office workers at half past twelve on a weekday is telling you something a queue of tour groups at three in the afternoon is not.",
      },
      {
        kind: "h2",
        text: "A few worth queuing for",
      },
      {
        kind: "pick",
        title: "Egg coffee in Hanoi",
        note: "Hanoi's signature drink — strong Vietnamese coffee under a whipped, custardy egg-yolk cream, like tiramisu in a cup. It was invented in the 1940s by Nguyễn Văn Giảng, and his family's café, Giảng, has served it since 1946; it is warm, rich, and best drunk down a quiet Old Quarter alley.",
        href: "/destinations/hanoi",
      },
      {
        kind: "pick",
        title: "Cacio e pepe in Rome",
        note: "Minimalist Roman cooking at its best: pecorino, black pepper and starchy pasta water, and much harder to do well than it looks. Skip the tables beside the monuments and head for the trattorias of Testaccio and Trastevere, where Romans actually eat.",
        href: "/destinations/rome",
      },
      {
        kind: "pick",
        title: "A street-food crawl in Bangkok",
        note: "After dark, Chinatown's Yaowarat road becomes an open-air kitchen — charcoal-grilled seafood, noodle soups and mango sticky rice from stalls decades deep. Follow the longest local queues and graze.",
        href: "/destinations/bangkok",
      },
      {
        kind: "h2",
        text: "The corollary",
      },
      {
        kind: "p",
        text: "Being suspicious of the opposite signals matters just as much: laminated menus with photos, staff waving you in from the doorway, and prime real estate pressed against the big sight. Walk two streets back, follow the person on their lunch break, and you will eat better for less almost everywhere. Our city guides are built on exactly this instinct.",
      },
    ],
    sources: [
      {
        label: "Egg coffee — history and origin",
        url: "https://en.wikipedia.org/wiki/Egg_coffee",
        publisher: "Wikipedia",
      },
      {
        label: "Café Giảng — the birthplace of egg coffee",
        url: "https://cafegiang.vn/",
        publisher: "Café Giảng",
      },
      {
        label: "Traditional Roman food, district by district",
        url: "https://www.italia.it/en/lazio/rome/things-to-do/traditional-roman-food-districts-of-rome",
        publisher: "Italia.it (Italian National Tourist Board)",
      },
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
    imageAlt:
      "The wooden veranda of Kiyomizu-dera temple above autumn foliage in Kyoto",
    readingTime: "5 min read",
    personas: ["backpacker", "luxury"],
    featuredDestination: "kyoto",
    body: [
      {
        kind: "p",
        text: "Ask people who travel for a living when they go, and you will almost never hear \"peak season.\" The shoulder, the weeks just before the crowds arrive and just after they leave, is quietly the best window to be almost anywhere, and the reasons are not a vibe, they are mechanics.",
      },
      {
        kind: "h2",
        text: "The mechanics",
      },
      {
        kind: "p",
        text: "Three things move together off-peak. Prices for stays and experiences soften as demand drops — in Rome, for instance, hotel rates in the shoulder months typically run well below the July–August peak. The queues at the headline sights shrink, which changes not just your wait but the whole feel of a place. And the destination stops performing for a peak-season crowd and goes back to being itself. Kyoto's temples in the quiet weeks, or Rome's Forum in October, are a different, better visit than the same sights shoulder-to-shoulder in high summer.",
      },
      {
        kind: "h2",
        text: "Roughly when the shoulder falls",
      },
      {
        kind: "list",
        items: [
          "Rome & Lisbon — spring and autumn, broadly April–May and late September–October, dodging both the crowds and the August heat.",
          "Kyoto — the edges of its two peaks: the weeks around late-November colour and the run-up to spring blossom.",
          "Hanoi — October–November and March–April, either side of the summer rains.",
          "Bangkok — the cusp of the cool season and the wet, when the crowds thin and prices drop.",
        ],
      },
      {
        kind: "p",
        text: "Every Folio Voyage destination guide states the honest best time to go, so cross-check these windows against the specific city before you commit — and watch for local exceptions like Easter week in Rome (around 29 March–5 April in 2026), which pulls crowds and prices back up.",
      },
      {
        kind: "h2",
        text: "The trade-off",
      },
      {
        kind: "p",
        text: "The catch is weather variance — a rainy day is likelier. But light rain in Lisbon or a crisp grey morning in Hanoi is a small tax for having a place to yourself, and staying flexible is almost always cheaper than fighting the peak. More often than not, the best month to travel simply is not the one everyone else picks.",
      },
    ],
    sources: [
      {
        label: "Best time of year to visit Rome (crowds & prices)",
        url: "https://www.walksofitaly.com/blog/travel-tips/best-time-of-year-to-visit-rome",
        publisher: "Walks of Italy",
      },
      {
        label: "Kyoto travel guide — seasons",
        url: "https://www.japan-guide.com/e/e2158.html",
        publisher: "japan-guide.com",
      },
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
      {
        kind: "p",
        text: "Travellers agonise over which sights to see and barely think about where they will sleep — which is backwards. The neighbourhood you base yourself in shapes your mornings, your meals, your walk home, and your whole sense of a place far more than any single attraction on the list.",
      },
      {
        kind: "h2",
        text: "The rule",
      },
      {
        kind: "p",
        text: "Pick one neighbourhood that matches how you actually want to travel, and let the rest of the trip radiate out from it. Not the most central dot on the map — the one whose default day looks like the trip you want. Be honest about your own preferences: proximity to the noise and the food, or calm and good coffee; atmosphere, or flat streets near transit.",
      },
      {
        kind: "h2",
        text: "What it looks like in practice",
      },
      {
        kind: "list",
        items: [
          "Want to be in the thick of it? The old quarter — Alfama in Lisbon, Rattanakosin or Yaowarat in Bangkok, Rome's Centro Storico.",
          "Want calm and room to breathe? The leafy residential district one ride out — Tay Ho by Hanoi's West Lake, or Kyoto's Higashiyama slopes.",
          "Travelling with kids or a group? Flat, walkable and near transit beats atmospheric-but-vertical every time.",
        ],
      },
      {
        kind: "pick",
        title: "See the neighbourhood notes in every guide",
        note: "This is why every Folio Voyage city guide includes honest \"where to base yourself\" notes — not a list of hotels, but which neighbourhood suits which kind of traveller, and why. Lisbon's Alfama, Baixa and Belém are a good place to see the idea in action.",
        href: "/destinations/lisbon",
      },
      {
        kind: "p",
        text: "Pick your one neighbourhood before you pick anything else, and a city starts to feel a little like home instead of a checklist. In Lisbon, for example, basing yourself in flat, central Baixa puts Tram 28, the Alfama lanes and the train to Sintra all within easy reach — the kind of small logistical win that quietly improves every day of a trip.",
      },
    ],
    sources: [
      {
        label: "Lisbon Tram 28 — route and stops",
        url: "https://www.lisbonportugaltourism.com/transportation/tram-28-route-and-stops.html",
        publisher: "Lisbon Portugal Tourism",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Editorial-standards page (Trust cornerstone)
  // ────────────────────────────────────────────────────────────────────────
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
      {
        kind: "p",
        text: "Every travel site on earth calls itself \"curated.\" Almost none will tell you what the word costs them — what gets cut. Curation that never rejects anything is just a catalogue with better adjectives. So here, in the open, is the bar behind every guide on this site.",
      },
      {
        kind: "h2",
        text: "The bar: three tests",
      },
      {
        kind: "list",
        items: [
          "Worth the time — travel time is the scarcest thing you carry, and a mediocre \"top attraction\" that eats half a day is worse than a free afternoon. If we would not send a good friend, knowing their days are limited, it does not go in.",
          "Real — we weight the places, meals and walks that reward you for physically showing up over the ones that photograph better than they feel.",
          "Honest about the catch — every recommendation carries its trade-off in the same breath: the 11am crowd, the tourist-trap version two streets over, the cheaper way to do exactly the same thing.",
        ],
      },
      {
        kind: "h2",
        text: "How we research",
      },
      {
        kind: "p",
        text: "We write from research, not press releases: cross-checking the practical details (opening hours, fares, ticketing rules, the honest best time to go) against official and authoritative sources, and citing them so you can check for yourself. Facts like these change, so we date every post with a \"last reviewed\" line and tell you to confirm the time-sensitive specifics before you travel. Where we recommend a specific experience, it is because it clears the bar above, not because it is easy to link to.",
      },
      {
        kind: "h2",
        text: "The firewall",
      },
      {
        kind: "p",
        text: "This is what makes the rest worth trusting. Folio Voyage is reader-supported: when booking links go live, some will be affiliate links to partners like Viator and GetYourGuide that earn us a commission at no extra cost to you — the full detail is on our affiliate disclosure page. The rule is absolute: a commission never moves anything up a page or onto a guide. The editorial list is decided first and separately; the money attaches to it afterward, or not at all. If the two ever conflict, the guide wins.",
      },
      {
        kind: "p",
        text: "That is the whole method — worth the time, real, honest about the catch, researched, and independent of what we earn. It is the same bar every destination guide and every post in The Folio is held to.",
      },
    ],
    sources: [
      {
        label: "FTC Endorsement Guides: What People Are Asking",
        url: "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking",
        publisher: "U.S. Federal Trade Commission",
      },
    ],
  },
];

export function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}
