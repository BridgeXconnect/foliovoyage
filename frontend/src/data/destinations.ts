import type { Destination } from "./types";
import { IMG } from "./media";

/**
 * Hand-written placeholder editorial. Every intro paragraph and experience
 * blurb is original. Images point at resolved Wikimedia Commons thumbnails
 * (see media.ts). When Viator / GetYourGuide are approved, each experience
 * gains `affiliateUrl` + `provider` and its CTA goes live — no other change.
 *
 * Bangkok is drafted from local knowledge and is the destination Roy will
 * refine first.
 */
export const destinations: Destination[] = [
  {
    slug: "bangkok",
    city: "Bangkok",
    country: "Thailand",
    tagline:
      "Gilded temples, canal-side markets, and the best street food on earth — all at once.",
    heroImage: IMG.bkk_hero,
    heroImageAlt:
      "The prang spires of Wat Arun rising above the Chao Phraya River in Bangkok",
    intro: [
      "Bangkok rewards travellers who lean into its contradictions. In a single day you can watch saffron-robed monks collect alms at dawn, thread through the incense and gold of the Grand Palace by mid-morning, and end up on a plastic stool in Chinatown at midnight eating some of the best food of your life. The city doesn't ask you to choose between old and new — it stacks them on top of each other and hands you a plate.",
      "The river is the key to understanding it. For centuries the Chao Phraya and its network of khlongs (canals) were the roads, and the oldest, most rewarding sights still cluster along the water in Rattanakosin, the royal island. Hop the public express boat rather than sitting in a taxi and the geography of the city suddenly makes sense — temples, flower markets, and the old town all strung along the same brown, busy artery.",
      "Come hungry and come curious. Bangkok is one of the few great cities where the cheapest meal is often the best one, where a wrong turn down a soi leads somewhere better than where you were going, and where the heat forces a slower, smarter rhythm on you whether you like it or not. Plan the temples for morning, hide from the afternoon sun, and let the city come alive again after dark.",
    ],
    knownFor: [
      "Street food",
      "Buddhist temples",
      "Chao Phraya River",
      "Night markets",
      "Rooftop bars",
      "Day trips",
    ],
    bestTime: "November–February (cool, dry season)",
    fromPrice: 890,
    neighbourhoods: [
      {
        name: "Rattanakosin (Old Town)",
        note: "The royal island and the historic heart — Grand Palace, Wat Pho, and Wat Arun are all within walking (and short ferry) distance. Best for first-timers who want the big sights on their doorstep.",
      },
      {
        name: "Yaowarat (Chinatown)",
        note: "Dense, neon, and endlessly edible. Come in the evening for the street-food frenzy; stay if you want to be in the middle of the noise and closest to the old town.",
      },
      {
        name: "Sukhumvit",
        note: "Modern Bangkok — Skytrain stations, malls, rooftop bars, and international dining. Well connected and easy; where to base yourself if you value convenience over old-town charm.",
      },
      {
        name: "Thonburi & the river",
        note: "The quieter west bank, laced with canals. Boutique riverside stays here trade nightlife for sunset views of Wat Arun and an easy ferry hop to the sights.",
      },
    ],
    lat: 13.7563,
    lng: 100.5018,
    experiences: [
      {
        id: "grand-palace-wat-phra-kaew",
        title: "The Grand Palace & Wat Phra Kaew",
        description:
          "Bangkok's most dazzling complex, home to the Emerald Buddha and a maze of gilded halls and mirror-tiled spires. Go early to beat the heat and the crowds, and dress respectfully — shoulders and knees covered.",
        image: IMG.bkk_grand_palace,
        imageAlt:
          "Golden spires and ornate rooftops of Wat Phra Kaew inside the Grand Palace, Bangkok",
        category: "Culture & History",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "wat-pho-reclining-buddha",
        title: "Wat Pho & the Reclining Buddha",
        description:
          "A 46-metre gold-leafed Buddha, mother-of-pearl feet and all, plus the country's oldest massage school. Book a traditional Thai massage here afterwards — it's the birthplace of the practice.",
        image: IMG.bkk_wat_pho,
        imageAlt: "The vast golden Reclining Buddha inside Wat Pho, Bangkok",
        category: "Culture & History",
        priceBand: "$",
        duration: "2–3 hours",
      },
      {
        id: "wat-arun-sunset",
        title: "Wat Arun at golden hour",
        description:
          "The Temple of Dawn is best at dusk, when the Khmer-style prang catches the low light and the river turns molten. Climb the steep central steps, then cross by ferry for a riverside drink facing back at it.",
        image: IMG.bkk_wat_arun,
        imageAlt:
          "Wat Arun's tall central prang decorated with porcelain, lit at sunset beside the river",
        category: "Landmarks",
        priceBand: "$",
        duration: "2 hours",
      },
      {
        id: "chao-phraya-canal-boat",
        title: "Chao Phraya & khlong long-tail cruise",
        description:
          "Trade the traffic for the water. A long-tail boat weaves off the main river into Thonburi's canals, past stilt houses, riverside temples, and a way of life the roads never see.",
        image: IMG.bkk_chao_phraya,
        imageAlt:
          "A long-tail boat on the Chao Phraya River with Bangkok temples behind",
        category: "Water & Coast",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "yaowarat-street-food",
        title: "Yaowarat (Chinatown) street-food crawl",
        description:
          "After dark, Chinatown's main drag becomes an open-air kitchen: charcoal-grilled seafood, guay jub noodle soup, mango sticky rice, and stalls that have run for generations. Come hungry and graze your way down the street.",
        image: IMG.bkk_yaowarat,
        imageAlt:
          "Crowds and glowing neon signs along Yaowarat Road in Bangkok's Chinatown at night",
        category: "Food & Drink",
        priceBand: "$",
        duration: "Evening",
      },
      {
        id: "chatuchak-market",
        title: "Chatuchak Weekend Market",
        description:
          "One of the world's largest markets — 15,000 stalls of vintage clothing, ceramics, plants, art, and food, sprawled across 27 sections. Go early on a Saturday, wear light clothes, and simply let yourself get lost.",
        image: IMG.bkk_chatuchak,
        imageAlt:
          "Busy covered aisles of stalls at Chatuchak Weekend Market, Bangkok",
        category: "Neighbourhoods",
        priceBand: "$",
        duration: "Half day",
      },
      {
        id: "damnoen-saduak-floating-market",
        title: "Floating market day trip",
        description:
          "An early start gets you to the canals southwest of the city, where vendors paddle sampans laden with fruit, noodles, and coconut ice cream. Touristy, yes — but photogenic and genuinely fun if you go at opening time.",
        image: IMG.bkk_floating,
        imageAlt:
          "Wooden boats loaded with fruit and produce at a floating market near Bangkok",
        category: "Day Trips",
        priceBand: "$$",
        duration: "Full day",
      },
      {
        id: "ayutthaya-temples",
        title: "Ayutthaya ancient capital",
        description:
          "Thailand's former royal capital, a UNESCO site of crumbling brick prangs and the famous Buddha head cradled in tree roots. An easy day trip north by train or minivan, best explored by bicycle in the cool of morning.",
        image: IMG.bkk_ayutthaya,
        imageAlt:
          "A stone Buddha head entwined in the roots of a bodhi tree at Wat Mahathat, Ayutthaya",
        category: "Day Trips",
        priceBand: "$$",
        duration: "Full day",
      },
    ],
  },

  {
    slug: "kyoto",
    city: "Kyoto",
    country: "Japan",
    tagline:
      "A thousand years of temples, tea, and craft — Japan's old capital, best taken slowly.",
    heroImage: IMG.kyo_hero,
    heroImageAlt:
      "The wooden stage of Kiyomizu-dera temple above autumn foliage in Kyoto",
    intro: [
      "For over a thousand years Kyoto was the imperial capital of Japan, and it still feels like the country's cultural conscience — the place where tea ceremony, Zen gardens, kaiseki cuisine, and the geisha districts were refined into something close to art. Spared the worst of wartime bombing, it kept its temples, its wooden machiya townhouses, and an unhurried sense of ritual that the rest of modern Japan often moves too fast to notice.",
      "The rewards here are quiet ones. A raked gravel garden you sit with rather than walk through; a bowl of matcha whisked to a precise froth; a lantern-lit lane in Gion where, if you're lucky and respectful, a geiko hurries to an evening appointment. Kyoto asks for patience and pays it back — the travellers who slow down, book the popular temples for opening time, and leave gaps in the day come away with the most.",
      "It's also compact and cyclable, ringed by wooded hills and threaded by the Kamo River, with day trips to Nara and Arashiyama within easy reach. Spring cherry blossom and autumn maples are spectacular but crowded; come in the shoulder seasons, or simply start each day early, and the old capital reveals itself.",
    ],
    knownFor: [
      "Temples & shrines",
      "Zen gardens",
      "Geisha districts",
      "Matcha & tea",
      "Cherry blossom",
      "Autumn maples",
    ],
    bestTime: "April (blossom) & November (autumn colour)",
    fromPrice: 1750,
    neighbourhoods: [
      {
        name: "Higashiyama",
        note: "The most atmospheric quarter — preserved lanes climbing to Kiyomizu-dera, lined with tea houses and craft shops. Stay here to be steps from the classic Kyoto.",
      },
      {
        name: "Gion",
        note: "The famous geisha district and Kyoto's night-time heart, with Pontocho's lantern-lit dining alley nearby. Atmospheric, central, and lovely after dark.",
      },
      {
        name: "Downtown (Kawaramachi)",
        note: "Kyoto's shopping and dining core around Nishiki Market — the most convenient base for transit and restaurants.",
      },
    ],
    lat: 35.0116,
    lng: 135.7681,
    experiences: [
      {
        id: "fushimi-inari",
        title: "Fushimi Inari's torii gates",
        description:
          "Thousands of vermilion torii tunnel up a sacred mountain in an unforgettable procession. Climb past the crowded lower shrine to the quiet upper trails at dawn — it's free, open 24 hours, and best before 8am.",
        image: IMG.kyo_fushimi,
        imageAlt:
          "A tunnel of vermilion torii gates ascending the hillside at Fushimi Inari shrine, Kyoto",
        category: "Culture & History",
        priceBand: "$",
        duration: "2–3 hours",
      },
      {
        id: "kinkakuji",
        title: "Kinkaku-ji, the Golden Pavilion",
        description:
          "A gold-leafed Zen temple mirrored in its own reflecting pond — Kyoto's most photographed sight for good reason. Small but perfect; pair it with the nearby raked garden at Ryoan-ji.",
        image: IMG.kyo_kinkakuji,
        imageAlt:
          "The gold-covered Kinkaku-ji pavilion reflected in a still pond, Kyoto",
        category: "Landmarks",
        priceBand: "$",
        duration: "1–2 hours",
      },
      {
        id: "arashiyama-bamboo",
        title: "Arashiyama bamboo grove",
        description:
          "Towering green stalks filter the light along a path on Kyoto's western edge. Go at opening time, then continue to Tenryu-ji's garden and the monkey park on the hill above the river.",
        image: IMG.kyo_arashiyama,
        imageAlt:
          "Sunlight filtering through the tall stalks of the Arashiyama bamboo grove, Kyoto",
        category: "Nature & Outdoors",
        priceBand: "$",
        duration: "Half day",
      },
      {
        id: "gion-geisha-district",
        title: "Gion after dark",
        description:
          "Wander the preserved wooden lanes of Kyoto's geisha quarter at dusk, when lanterns glow and the tea houses come alive. Walk respectfully — this is a working neighbourhood, not a set.",
        image: IMG.kyo_gion,
        imageAlt:
          "Traditional wooden machiya buildings lining a lantern-lit street in Gion, Kyoto",
        category: "Neighbourhoods",
        priceBand: "$",
        duration: "Evening",
      },
      {
        id: "nishiki-market",
        title: "Nishiki Market food walk",
        description:
          "\"Kyoto's kitchen\" — a narrow, covered arcade of 100-plus stalls selling pickles, tofu, tamagoyaki, and skewered seafood. Graze your way along and pick up ingredients you'll wish you could take home.",
        image: IMG.kyo_nishiki,
        imageAlt:
          "Stalls of food and produce lining the covered Nishiki Market arcade, Kyoto",
        category: "Food & Drink",
        priceBand: "$",
        duration: "1–2 hours",
      },
      {
        id: "kiyomizu-dera",
        title: "Kiyomizu-dera & Higashiyama lanes",
        description:
          "A vast wooden temple on stilts with a hillside view over the city, reached through the preserved slopes of Sannenzaka and Ninenzaka. One of the great Kyoto walks — do it early and end with tea.",
        image: IMG.kyo_kiyomizu,
        imageAlt:
          "The wooden veranda of Kiyomizu-dera temple projecting over the hillside, Kyoto",
        category: "Culture & History",
        priceBand: "$",
        duration: "Half day",
      },
      {
        id: "tea-ceremony",
        title: "A traditional tea ceremony",
        description:
          "Sit through the deliberate, meditative ritual of whisked matcha and seasonal sweets, guided by a host in a tatami room. The most direct way to feel the aesthetic that shaped the whole city.",
        image: IMG.kyo_tea,
        imageAlt:
          "A bowl of frothy green matcha and a bamboo whisk set for a Japanese tea ceremony",
        category: "Wellness",
        priceBand: "$$",
        duration: "1–2 hours",
      },
      {
        id: "nara-day-trip",
        title: "Nara day trip",
        description:
          "Forty minutes away, Japan's first permanent capital pairs a giant bronze Buddha at Todai-ji with a deer park where sika deer bow for crackers. An easy, rewarding half-to-full day out of Kyoto.",
        image: IMG.kyo_nara,
        imageAlt:
          "Free-roaming sika deer in front of Todai-ji temple in Nara, Japan",
        category: "Day Trips",
        priceBand: "$",
        duration: "Full day",
      },
    ],
  },

  {
    slug: "lisbon",
    city: "Lisbon",
    country: "Portugal",
    tagline:
      "Tiled façades, rattling trams, and Atlantic light spilling over seven hills.",
    heroImage: IMG.lis_hero,
    heroImageAlt:
      "Terracotta rooftops of the Alfama district tumbling toward the Tagus River in Lisbon",
    intro: [
      "Lisbon is a city of viewpoints. Built across seven hills above the wide Tagus estuary, it keeps handing you the same reward — climb a lane, round a corner, and the whole tiled, terracotta city opens up below you in the famous Atlantic light. It's a capital that feels sun-bleached and lived-in, where laundry hangs over cobbled alleys and the sound of fado drifts out of a doorway after dark.",
      "It's also remarkably easy to love. Distances are short, the historic yellow trams do half the climbing for you, and the food — grilled sardines, salt cod a hundred ways, and the warm custard tart known as pastel de nata — is generous and cheap. The old quarters of Alfama and Mouraria survived the great 1755 earthquake and still ramble like a medieval village, while the grand riverside district of Belém tells the story of Portugal's age of exploration.",
      "Give it three or four days and it opens outward: the fairy-tale palaces of Sintra in the hills, the surf beaches of the Atlantic coast, and the port lodges of nearby regions are all within an easy day trip. Lisbon is a place to walk, climb, eat, and let the light do the rest.",
    ],
    knownFor: [
      "Historic trams",
      "Miradouros (viewpoints)",
      "Pastéis de nata",
      "Fado music",
      "Azulejo tiles",
      "Day trips to Sintra",
    ],
    bestTime: "March–June & September–October",
    fromPrice: 1200,
    neighbourhoods: [
      {
        name: "Alfama",
        note: "The oldest quarter — a maze of stairways, tiny fado bars, and the cathedral, crowned by São Jorge Castle. Atmospheric and central, if steep.",
      },
      {
        name: "Baixa & Chiado",
        note: "The elegant, flat downtown rebuilt on a grid after the earthquake, full of squares, shops, and cafés. The most convenient, walkable base.",
      },
      {
        name: "Belém",
        note: "The riverside monument district — home to the Tower, the monastery, and the original custard tarts. Quieter and grander, a short tram ride west.",
      },
    ],
    lat: 38.7223,
    lng: -9.1393,
    experiences: [
      {
        id: "tram-28",
        title: "Ride historic Tram 28",
        description:
          "The city's most scenic tram rattles and screeches through Graça, Alfama, and Baixa on a route no car could manage. Board early at a terminus for a seat, and treat it as a moving tour of the old town.",
        image: IMG.lis_tram,
        imageAlt:
          "A vintage yellow tram climbing a narrow tiled street in Lisbon",
        category: "Neighbourhoods",
        priceBand: "$",
        duration: "1–2 hours",
      },
      {
        id: "belem-tower",
        title: "Belém Tower & the riverfront",
        description:
          "The filigreed limestone fort that guarded the harbour mouth is Lisbon's emblem of the Age of Discovery. Pair it with the nearby Monument to the Discoveries and a walk along the Tagus.",
        image: IMG.lis_belem,
        imageAlt:
          "The Manueline-style Belém Tower standing at the edge of the Tagus River, Lisbon",
        category: "Landmarks",
        priceBand: "$",
        duration: "2 hours",
      },
      {
        id: "jeronimos-monastery",
        title: "Jerónimos Monastery",
        description:
          "A masterpiece of ornate Manueline stonework and the resting place of explorer Vasco da Gama. The cloister alone is worth the queue — book ahead and go early to have it near-empty.",
        image: IMG.lis_jeronimos,
        imageAlt:
          "The intricately carved stone cloisters of Jerónimos Monastery in Belém, Lisbon",
        category: "Culture & History",
        priceBand: "$$",
        duration: "2 hours",
      },
      {
        id: "pastel-de-nata",
        title: "Pastel de nata at the source",
        description:
          "Warm, blistered custard tarts dusted with cinnamon — nowhere better than the original bakery in Belém, working from a secret 1837 recipe. Order two; you'll wish you had ordered four.",
        image: IMG.lis_natas,
        imageAlt:
          "Freshly baked pastéis de nata custard tarts with caramelised tops",
        category: "Food & Drink",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "alfama-fado",
        title: "Fado night in Alfama",
        description:
          "Portugal's melancholy, soul-baring song is best heard in a tiny Alfama tavern over dinner. Choose a spot where locals still go, not a tourist show, and let the room fall silent when the singer starts.",
        image: IMG.lis_alfama,
        imageAlt:
          "A narrow cobbled street with tiled buildings in the Alfama district, Lisbon",
        category: "Nightlife",
        priceBand: "$$",
        duration: "Evening",
      },
      {
        id: "sao-jorge-castle",
        title: "São Jorge Castle & viewpoints",
        description:
          "Moorish walls crown Lisbon's highest hill, with the city's best panorama over the rooftops to the river. Climb up through Alfama, timing it for late afternoon light.",
        image: IMG.lis_castle,
        imageAlt:
          "Ramparts of São Jorge Castle overlooking the rooftops of Lisbon",
        category: "Landmarks",
        priceBand: "$",
        duration: "2–3 hours",
      },
      {
        id: "sintra-day-trip",
        title: "Sintra palaces day trip",
        description:
          "Forty minutes by train, a misty hill town of romantic palaces — the candy-coloured Pena Palace and the initiation wells of Quinta da Regaleira. Start at opening time; it gets busy fast.",
        image: IMG.lis_sintra,
        imageAlt:
          "The colourful towers of Pena Palace on a wooded hilltop in Sintra, Portugal",
        category: "Day Trips",
        priceBand: "$$",
        duration: "Full day",
      },
      {
        id: "time-out-market",
        title: "Time Out Market food hall",
        description:
          "A grand old market hall turned showcase of Lisbon's best cooks under one roof — from seafood to steak to pastries. A convenient, high-quality way to taste the city's range in one sitting.",
        image: IMG.lis_timeout,
        imageAlt:
          "Diners at communal tables in the busy Time Out Market food hall, Lisbon",
        category: "Food & Drink",
        priceBand: "$$",
        duration: "1–2 hours",
      },
    ],
  },

  {
    slug: "rome",
    city: "Rome",
    country: "Italy",
    tagline:
      "Three thousand years of empire, art, and appetite, layered street on street.",
    heroImage: IMG.rom_hero,
    heroImageAlt:
      "The ancient Colosseum amphitheatre lit against a dusk sky in Rome",
    intro: [
      "No city wears its history so openly as Rome. Here an ancient temple becomes a church becomes a fountain becomes the backdrop to your morning coffee — nearly three thousand years of empire, faith, and reinvention stacked one layer on the next. You don't visit Rome's past so much as walk straight through it, tripping over a fragment of the Forum on the way to lunch.",
      "The headline sights earn their fame — the Colosseum, the Vatican, the Pantheon's impossible dome — but Rome's real pleasure is the everyday texture between them. The espresso taken standing at the bar; the trattorias of Trastevere and Testaccio serving cacio e pepe and carbonara the way they've always made them; the piazzas that fill with Romans at dusk. It's a city best measured in long walks and unhurried meals.",
      "Come prepared to book ahead — the Vatican Museums and Colosseum reward timed tickets and early starts — but leave room to get lost. Rome is dense, walkable, and endlessly layered, and some of its best moments come when you round a corner with no plan and find a fountain, a facade, or a fresco you weren't looking for.",
    ],
    knownFor: [
      "Ancient ruins",
      "Vatican art",
      "Roman cuisine",
      "Baroque fountains",
      "Piazzas",
      "Espresso culture",
    ],
    bestTime: "April–May & September–October",
    fromPrice: 1600,
    neighbourhoods: [
      {
        name: "Centro Storico",
        note: "The historic centre around the Pantheon and Piazza Navona — walkable to almost everything and full of atmosphere, if pricier.",
      },
      {
        name: "Trastevere",
        note: "Cobbled, ivy-draped, and lively at night, with the city's best concentration of trattorias. Charming base for food-lovers.",
      },
      {
        name: "Monti",
        note: "A stylish, low-key quarter between the Colosseum and Termini — artisan shops, wine bars, and Roman life without the crush.",
      },
    ],
    lat: 41.9028,
    lng: 12.4964,
    experiences: [
      {
        id: "colosseum-forum",
        title: "Colosseum, Forum & Palatine",
        description:
          "The beating heart of ancient Rome — the great amphitheatre, the ruined Forum where the Republic was run, and the palace hill above. A single ticket covers all three; a guide brings the stones to life.",
        image: IMG.rom_colosseum,
        imageAlt:
          "The tiered arches and arena floor inside the Roman Colosseum",
        category: "Landmarks",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "vatican-st-peters",
        title: "Vatican Museums & St Peter's",
        description:
          "Miles of galleries building to the Sistine Chapel ceiling, then the vast basilica next door. Book the earliest slot or an after-hours tour to see Michelangelo's frescoes without the shoulder-to-shoulder crush.",
        image: IMG.rom_vatican,
        imageAlt:
          "The dome and façade of St Peter's Basilica above St Peter's Square, Vatican City",
        category: "Culture & History",
        priceBand: "$$$",
        duration: "Half day",
      },
      {
        id: "roman-forum-walk",
        title: "Ancient Rome walking tour",
        description:
          "Trace the city from the Capitoline Hill through the Forum to the Colosseum with an archaeologist, and the scattered ruins finally connect into a story of temples, triumphs, and daily Roman life.",
        image: IMG.rom_forum,
        imageAlt:
          "Ruined columns and temples of the Roman Forum with the city behind",
        category: "Culture & History",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "trastevere-food-tour",
        title: "Trastevere food & wine tour",
        description:
          "Graze through Rome's most characterful quarter after dark — suppli, cured meats, cacio e pepe, and Roman wine — while the cobbled lanes fill with locals. The tastiest way to learn how Romans really eat.",
        image: IMG.rom_trastevere,
        imageAlt:
          "A narrow cobbled street lined with restaurants in Trastevere, Rome",
        category: "Food & Drink",
        priceBand: "$$",
        duration: "Evening",
      },
      {
        id: "trevi-fountain",
        title: "Trevi Fountain & Baroque Rome",
        description:
          "Rome's grandest fountain, a theatrical wall of gods and sea-horses tucked into a small square. Come at dawn or late at night to see it without the crush, coin toss and all.",
        image: IMG.rom_trevi,
        imageAlt:
          "The sculpted Baroque figures and cascading water of the Trevi Fountain, Rome",
        category: "Landmarks",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "pantheon",
        title: "The Pantheon",
        description:
          "The best-preserved building of ancient Rome, its coffered concrete dome still the largest of its kind after two millennia, lit by a single open oculus. Free to enter and quietly astonishing.",
        image: IMG.rom_pantheon,
        imageAlt:
          "The columned portico of the ancient Pantheon in Rome",
        category: "Landmarks",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "borghese-gallery",
        title: "Borghese Gallery & gardens",
        description:
          "A jewel-box villa of Bernini sculptures and Caravaggio paintings set in Rome's loveliest park. Entry is by timed ticket only — reserve well ahead, then stroll the gardens afterwards.",
        image: IMG.rom_borghese,
        imageAlt:
          "The façade of the Villa Borghese gallery amid gardens in Rome",
        category: "Culture & History",
        priceBand: "$$",
        duration: "2–3 hours",
      },
      {
        id: "roman-cooking-class",
        title: "Roman pasta cooking class",
        description:
          "Learn the four classic Roman pastas — carbonara, cacio e pepe, amatriciana, gricia — hands-on with a local cook, then sit down to eat what you made. You'll never order jarred sauce again.",
        image: IMG.rom_testaccio,
        imageAlt:
          "A plate of cacio e pepe pasta, a classic Roman dish",
        category: "Food & Drink",
        priceBand: "$$",
        duration: "Half day",
      },
    ],
  },

  {
    slug: "hanoi",
    city: "Hanoi",
    country: "Vietnam",
    tagline:
      "Lake-side calm, Old Quarter chaos, and street food worth crossing the world for.",
    // Use the actual Hoan Kiem / Huc Bridge photo (han_hoankiem) for the hero so
    // it matches its alt text. The old `han_hero` file was in fact an Old Town
    // street-seller shot (identical to `han_oldquarter`), which both duplicated
    // the Old Quarter card and contradicted this lake/bridge caption.
    heroImage: IMG.han_hoankiem,
    heroImageAlt:
      "The red Huc Bridge crossing to Ngoc Son Temple on Hoan Kiem Lake, Hanoi",
    intro: [
      "Hanoi is a city of small, vivid moments. A grandmother ladling steaming pho at 6am; a scooter threading an impossible gap with a family of four and a fridge aboard; a plastic stool on a corner where the best meal of your trip costs a dollar. Vietnam's thousand-year-old capital moves fast and close to the ground, and the way to understand it is to slow down and let it swirl around you.",
      "At its centre sits Hoan Kiem Lake, a green lung ringed by joggers and card players, and beside it the Old Quarter — 36 ancient guild streets still loosely named for the trades once practised there. It's a glorious tangle of commerce, temples, faded French-colonial shopfronts, and food carts, and getting lost in it is the whole point. French rule left wide boulevards and elegant villas; the decades since left a fierce, resourceful street life layered on top.",
      "Give the city a couple of days to work on you, then use it as a launchpad. Some of Vietnam's greatest landscapes — the limestone seascape of Ha Long Bay, the rice-paddy karsts of Ninh Binh — are within a few hours, making Hanoi both a destination and the perfect base for the north.",
    ],
    knownFor: [
      "Street food",
      "Old Quarter",
      "Hoan Kiem Lake",
      "French colonial architecture",
      "Egg coffee",
      "Ha Long Bay trips",
    ],
    bestTime: "October–November & March–April",
    fromPrice: 780,
    neighbourhoods: [
      {
        name: "Old Quarter",
        note: "The chaotic, endlessly walkable heart — guild streets, street food, and cheap-to-boutique stays. Loud and central; where most first-timers should be.",
      },
      {
        name: "French Quarter",
        note: "Wide boulevards, the Opera House, and grand hotels south of the lake. Quieter and more polished, an easy walk from the action.",
      },
      {
        name: "Tay Ho (West Lake)",
        note: "A calmer, leafier lakeside district favoured by expats, with cafés and sunset views. Best if you want breathing room over buzz.",
      },
    ],
    lat: 21.0278,
    lng: 105.8342,
    experiences: [
      {
        id: "hoan-kiem-lake",
        title: "Hoan Kiem Lake & Ngoc Son Temple",
        description:
          "The city's serene centre, crossed by a scarlet wooden bridge to a small island temple. Come at dawn to watch tai chi by the water, or at weekends when the surrounding streets go car-free.",
        image: IMG.han_hoankiem,
        imageAlt:
          "The red The Huc Bridge leading to Ngoc Son Temple on Hoan Kiem Lake, Hanoi",
        category: "Landmarks",
        priceBand: "$",
        duration: "1–2 hours",
      },
      {
        id: "old-quarter-street-food",
        title: "Old Quarter street-food tour",
        description:
          "Pho, bun cha, banh mi, and egg coffee, eaten on plastic stools with a guide who knows which stall has done one dish perfectly for thirty years. The single best introduction to Hanoi.",
        image: IMG.han_oldquarter,
        imageAlt:
          "A busy street lined with shops and food stalls in Hanoi's Old Quarter",
        category: "Food & Drink",
        priceBand: "$",
        duration: "Evening",
      },
      {
        id: "train-street",
        title: "Hanoi Train Street",
        description:
          "A working railway runs inches from the houses and cafés of a narrow residential lane. Sit for an egg coffee and, at scheduled times, watch a train squeeze past close enough to touch — from a safe doorway.",
        image: IMG.han_trainstreet,
        imageAlt:
          "Railway tracks running between close-set houses and cafés on Hanoi's Train Street",
        category: "Neighbourhoods",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "temple-of-literature",
        title: "Temple of Literature",
        description:
          "Vietnam's first university, founded in 1070, a tranquil sequence of courtyards, gateways, and lotus ponds dedicated to Confucius. A calm, green counterpoint to the Old Quarter's noise.",
        image: IMG.han_temple_lit,
        imageAlt:
          "A traditional gateway and courtyard at the Temple of Literature, Hanoi",
        category: "Culture & History",
        priceBand: "$",
        duration: "2 hours",
      },
      {
        id: "water-puppet-show",
        title: "Water puppet theatre",
        description:
          "A thousand-year-old northern Vietnamese art form: lacquered puppets dance on a water stage to live traditional music. Short, charming, and unlike anything else — a good early-evening hour.",
        image: IMG.han_puppet,
        imageAlt:
          "Colourful lacquered puppets performing on a water stage at a Vietnamese water puppet theatre",
        category: "Culture & History",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "ha-long-bay",
        title: "Ha Long Bay cruise",
        description:
          "Thousands of limestone islands rising from emerald water — one of Southeast Asia's great sights. Day trips are possible, but an overnight cruise with kayaking and a cave visit is the way to do it justice.",
        image: IMG.han_halong,
        imageAlt:
          "Limestone karst islands rising from the calm green water of Ha Long Bay, Vietnam",
        category: "Day Trips",
        priceBand: "$$$",
        duration: "1–2 days",
      },
      {
        id: "ninh-binh",
        title: "Ninh Binh & Tam Coc",
        description:
          "Called \"Ha Long Bay on land\" — a rowboat glides through caves between towering karst peaks and flooded rice paddies. A quieter, cheaper day trip that many travellers end up preferring.",
        image: IMG.han_ninhbinh,
        imageAlt:
          "A rowboat on a river winding between limestone karsts and rice paddies at Tam Coc, Ninh Binh",
        category: "Day Trips",
        priceBand: "$$",
        duration: "Full day",
      },
      {
        id: "egg-coffee",
        title: "Egg coffee & café culture",
        description:
          "Hanoi's signature drink — strong coffee under a whipped, custardy egg-yolk cream, invented here when milk was scarce. Seek out the original café hidden down an Old Quarter alley and drink it warm.",
        image: IMG.han_eggcoffee,
        imageAlt:
          "A glass of Vietnamese egg coffee topped with whipped egg-yolk cream",
        category: "Food & Drink",
        priceBand: "$",
        duration: "1 hour",
      },
    ],
  },

  {
    slug: "bali",
    city: "Bali",
    country: "Indonesia",
    tagline:
      "Temples on the cliffs, rice terraces in the hills, and surf on every coast.",
    heroImage: IMG.bal_hero,
    heroImageAlt:
      "Sculpted green rice terraces descending a valley at Tegallalang, Bali",
    intro: [
      "Bali packs an improbable amount into one small island: emerald rice terraces stepping down volcanic hillsides, sea temples clinging to surf-battered cliffs, jungle waterfalls, world-class breaks, and a Hindu culture that turns daily life into a run of offerings, processions, and temple festivals. It's beautiful, deeply spiritual, and — in the famous spots — very popular, so the trick is knowing where and when to go.",
      "The island splits roughly into moods. Ubud, in the cultured highland interior, is the place for temples, terraces, yoga, and craft villages. The southern beaches — Seminyak, Canggu, Uluwatu — bring the surf, sunsets, and beach clubs. Further out, the volcanoes of the centre and the quieter east and north reward anyone willing to drive. Renting a scooter or a driver for the day opens all of it up.",
      "Come for the landscapes and the surf, but stay for the culture. Time a visit around a temple ceremony, watch a fire-lit Kecak dance as the sun drops behind Uluwatu, or simply notice the small woven offerings left on every doorstep each morning — and Bali becomes far more than a beach.",
    ],
    knownFor: [
      "Rice terraces",
      "Sea temples",
      "Surf beaches",
      "Waterfalls",
      "Yoga & wellness",
      "Volcano treks",
    ],
    bestTime: "April–October (dry season)",
    fromPrice: 1100,
    neighbourhoods: [
      {
        name: "Ubud",
        note: "The cultural, green heart — temples, rice terraces, yoga, and craft. The base for anyone here for landscapes and calm over beaches.",
      },
      {
        name: "Seminyak & Canggu",
        note: "The stylish surf-and-sunset coast, thick with beach clubs, cafés, and boutiques. Where to stay for nightlife and waves.",
      },
      {
        name: "Uluwatu (Bukit)",
        note: "Clifftop temples, dramatic breaks, and some of the island's best sunsets on the southern peninsula. Scenic but spread out.",
      },
    ],
    lat: -8.4095,
    lng: 115.1889,
    experiences: [
      {
        id: "tegallalang-rice-terraces",
        title: "Tegallalang rice terraces",
        description:
          "The postcard image of Bali — sculpted paddies stepping down a lush valley just north of Ubud, worked by the centuries-old subak irrigation system. Go early, before the tour buses and the midday heat.",
        image: IMG.bal_tegallalang,
        imageAlt:
          "Terraced green rice paddies on a hillside at Tegallalang near Ubud, Bali",
        category: "Nature & Outdoors",
        priceBand: "$",
        duration: "2–3 hours",
      },
      {
        id: "uluwatu-temple-kecak",
        title: "Uluwatu Temple & Kecak at sunset",
        description:
          "A sea temple perched on a sheer cliff above the Indian Ocean, best at dusk when a fire-lit Kecak dance is performed as the sun goes down. Watch the resident monkeys — they're notorious thieves.",
        image: IMG.bal_uluwatu,
        imageAlt:
          "Uluwatu Temple standing on a high cliff above the ocean at sunset, Bali",
        category: "Landmarks",
        priceBand: "$$",
        duration: "Evening",
      },
      {
        id: "tanah-lot",
        title: "Tanah Lot temple",
        description:
          "Bali's most photographed sea temple sits on a rocky outcrop cut off by the tide, silhouetted against the sunset. Come late afternoon, and stay for the light as the crowds thin.",
        image: IMG.bal_tanahlot,
        imageAlt:
          "Tanah Lot temple on a rock formation surrounded by the sea at dusk, Bali",
        category: "Landmarks",
        priceBand: "$",
        duration: "2–3 hours",
      },
      {
        id: "monkey-forest-ubud",
        title: "Sacred Monkey Forest, Ubud",
        description:
          "A jungle sanctuary in the middle of Ubud where long-tailed macaques roam among moss-covered temples and banyan roots. Keep a grip on your sunglasses and phone, and let the ancient shrines do the rest.",
        image: IMG.bal_monkey,
        imageAlt:
          "Long-tailed macaques among mossy temple statues in the Sacred Monkey Forest, Ubud, Bali",
        category: "Nature & Outdoors",
        priceBand: "$",
        duration: "1–2 hours",
      },
      {
        id: "bali-waterfalls",
        title: "Jungle waterfall trek",
        description:
          "Bali's interior hides some spectacular falls — the towering multi-tiered Sekumpul in the north among the best. Expect a steep, sweaty scramble down and back, rewarded by a cool plunge pool at the bottom.",
        image: IMG.bal_waterfall,
        imageAlt:
          "A tall jungle waterfall cascading into a pool surrounded by greenery in Bali",
        category: "Nature & Outdoors",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "seminyak-beach",
        title: "Surf & sunset on the south coast",
        description:
          "The beaches of Seminyak and Canggu are made for long afternoons — a beginner surf lesson on the gentle breaks, then a drink on the sand as the sky turns. Bali's easygoing side at its best.",
        image: IMG.bal_seminyak,
        imageAlt:
          "Surfers and beachgoers watching the sunset on a Bali beach",
        category: "Water & Coast",
        priceBand: "$$",
        duration: "Half day",
      },
      {
        id: "kecak-fire-dance",
        title: "Balinese Kecak fire dance",
        description:
          "Dozens of chanting men form a living, swaying chorus around a fire while dancers act out an episode of the Ramayana. Hypnotic and unforgettable — the most powerful hour of culture on the island.",
        image: IMG.bal_kecak,
        imageAlt:
          "Performers seated in a circle around a fire during a Balinese Kecak dance",
        category: "Culture & History",
        priceBand: "$",
        duration: "1 hour",
      },
      {
        id: "mount-batur-sunrise",
        title: "Mount Batur sunrise trek",
        description:
          "A pre-dawn hike up an active volcano to watch the sun rise over the caldera and Lake Batur, with breakfast cooked in volcanic steam at the top. Two hard hours up in the dark, and worth every step.",
        image: IMG.bal_batur,
        imageAlt:
          "Sunrise over the caldera and lake seen from the summit of Mount Batur, Bali",
        category: "Nature & Outdoors",
        priceBand: "$$",
        duration: "Half day",
      },
    ],
  },
];
