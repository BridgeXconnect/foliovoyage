import { PrismaClient } from "@prisma/client";

import { CURATED_CITIES } from "../src/modules/import/curated-cities";

/**
 * Seed for the destination slice (ST-5 / BRI-100, extended for ST-11 / BRI-164).
 *
 * Creates:
 *  - the six curated cities (Bangkok, Kyoto, Hanoi, Rome, Lisbon, Bali) with
 *    their Viator destination ref + centroid, from the shared registry — the
 *    rows the import linker maps imported tours onto;
 *  - Paris, France (the original ST-5 destination) with a handful of published,
 *    hand-authored experiences and a centroid;
 *  - a small demo of *published* imported experiences for Bangkok — each linked
 *    1:1 to a Tour carrying a real Viator product image + a demo price — so the
 *    DB-backed city page has something to render end-to-end without a live crawl.
 *
 * The Bangkok demo uses real Viator product titles + cover-image URLs (facts and
 * links) with our own short descriptions and placeholder prices — it mirrors the
 * post-import, post-promote state the pipeline produces, not verbatim provider
 * copy.
 *
 * Idempotent: cities upsert on their slug pair, tours on the provider natural
 * key, and imported experiences on their source-tour key, so re-seeding never
 * duplicates. Paris's hand-authored experiences (no source key) are replaced
 * wholesale.
 */
const prisma = new PrismaClient();

const PARIS_HERO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/1280px-Tour_Eiffel_Wikimedia_Commons.jpg";
const PARIS_HERO_ALT =
  "The Eiffel Tower rising above the Champ de Mars in Paris at dusk";
const PARIS_CENTROID = { lat: 48.8566, lng: 2.3522 };

const PARIS_EXPERIENCES: { title: string; description: string }[] = [
  {
    title: "Skip-the-line at the Louvre",
    description:
      "Beat the courtyard queues and walk straight into the world's most-visited museum, from the Mona Lisa to the Winged Victory.",
  },
  {
    title: "Summit the Eiffel Tower",
    description:
      "Ride to the top of the Iron Lady for a 360° view over the Seine, the Trocadéro, and the rooftops of Paris.",
  },
  {
    title: "Seine river evening cruise",
    description:
      "Glide past Notre-Dame, the Musée d'Orsay, and the lamplit bridges as the city switches on for the night.",
  },
  {
    title: "Montmartre & Sacré-Cœur walk",
    description:
      "Climb the artists' hill to the white domes of Sacré-Cœur and wander the lanes that inspired Picasso and Renoir.",
  },
  {
    title: "Versailles day trip",
    description:
      "Escape the city for the gilded halls and formal gardens of Louis XIV's palace, a short train ride from the centre.",
  },
];

/**
 * Bangkok demo — real Viator product titles + cover images, our own short
 * descriptions, placeholder prices spanning the bands, and one editor rating to
 * exercise the nullable-rating path.
 */
const BANGKOK_DEMO: {
  productCode: string;
  title: string;
  description: string;
  imageUrl: string;
  priceMinor: number;
  editorRating: number | null;
}[] = [
  {
    productCode: "3685BKK10C",
    title: "Bangkok Temples Tour, Including Reclining Buddha at Wat Pho",
    description:
      "See Bangkok's landmark temples in a half-day loop, ending at the vast gold-leaf Reclining Buddha of Wat Pho.",
    imageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/08/cb/2c/93.jpg",
    priceMinor: 3500,
    editorRating: 4.7,
  },
  {
    productCode: "145456P65",
    title: "Bangkok Dusit Central Park Song Wat Photo Lanes Walking Tour",
    description:
      "Wander the old Song Wat trading lanes and Dusit's quiet corners on a small-group walk built for photographs.",
    imageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/93/81/af/caption.jpg",
    priceMinor: 8000,
    editorRating: null,
  },
  {
    productCode: "7626P842",
    title: "Private Bangkok Market Tour and Thai Cooking Class",
    description:
      "Shop a neighbourhood market with a local cook, then turn the ingredients into a hands-on Thai lunch.",
    imageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/d0/9d/e2/caption.jpg",
    priceMinor: 12000,
    editorRating: null,
  },
  {
    productCode: "145456P66",
    title: "Bangkok Wat Arun and Tha Tien Half Day Photo Tour",
    description:
      "Cross the river to the porcelain spires of Wat Arun and the riverside Tha Tien quarter for a photo-led morning.",
    imageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/93/8d/c8/caption.jpg",
    priceMinor: 22000,
    editorRating: null,
  },
  {
    productCode: "196194P1",
    title: "Try Dive (Discover Scuba Diving) — Bangkok",
    description:
      "A beginner's first breaths underwater with an instructor — no certification needed, all gear included.",
    imageUrl:
      "https://dynamic-media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/09/2a/0f/a1.jpg",
    priceMinor: 32000,
    editorRating: null,
  },
];

async function seedCuratedCities(): Promise<void> {
  for (const c of CURATED_CITIES) {
    await prisma.city.upsert({
      where: { countrySlug_slug: { countrySlug: c.countrySlug, slug: c.slug } },
      update: {
        name: c.name,
        country: c.country,
        heroImageUrl: c.heroImageUrl,
        heroImageAlt: c.heroImageAlt,
        viatorDestRef: c.primaryRef,
        centroidLat: c.centroidLat,
        centroidLng: c.centroidLng,
      },
      create: {
        slug: c.slug,
        countrySlug: c.countrySlug,
        name: c.name,
        country: c.country,
        heroImageUrl: c.heroImageUrl,
        heroImageAlt: c.heroImageAlt,
        viatorDestRef: c.primaryRef,
        centroidLat: c.centroidLat,
        centroidLng: c.centroidLng,
      },
    });
  }
  console.log(`Seeded ${CURATED_CITIES.length} curated cities.`);
}

async function seedParis(): Promise<void> {
  const city = await prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: "france", slug: "paris" } },
    update: {
      name: "Paris",
      country: "France",
      heroImageUrl: PARIS_HERO_URL,
      heroImageAlt: PARIS_HERO_ALT,
      centroidLat: PARIS_CENTROID.lat,
      centroidLng: PARIS_CENTROID.lng,
    },
    create: {
      slug: "paris",
      countrySlug: "france",
      name: "Paris",
      country: "France",
      heroImageUrl: PARIS_HERO_URL,
      heroImageAlt: PARIS_HERO_ALT,
      centroidLat: PARIS_CENTROID.lat,
      centroidLng: PARIS_CENTROID.lng,
    },
  });

  // Hand-authored experiences have no source key, so replace them wholesale.
  await prisma.experience.deleteMany({
    where: { cityId: city.id, sourceProvider: null },
  });
  await prisma.experience.createMany({
    data: PARIS_EXPERIENCES.map((e, position) => ({
      ...e,
      position,
      status: "published",
      latitude: PARIS_CENTROID.lat,
      longitude: PARIS_CENTROID.lng,
      cityId: city.id,
    })),
  });
  console.log(
    `Seeded France/Paris with ${PARIS_EXPERIENCES.length} published experiences.`,
  );
}

async function seedBangkokDemo(): Promise<void> {
  const bangkok = await prisma.city.findUnique({
    where: { countrySlug_slug: { countrySlug: "thailand", slug: "bangkok" } },
    select: { id: true, centroidLat: true, centroidLng: true },
  });
  if (!bangkok) throw new Error("Bangkok city must be seeded before its demo.");

  for (const [position, d] of BANGKOK_DEMO.entries()) {
    // Published Experience (idempotent on its source-tour key).
    const experience = await prisma.experience.upsert({
      where: {
        sourceProvider_sourceProviderTourId: {
          sourceProvider: "viator",
          sourceProviderTourId: d.productCode,
        },
      },
      update: {
        title: d.title,
        description: d.description,
        status: "published",
        editorRating: d.editorRating,
        position,
        cityId: bangkok.id,
        latitude: bangkok.centroidLat ?? 13.7234186,
        longitude: bangkok.centroidLng ?? 100.4762319,
      },
      create: {
        title: d.title,
        description: d.description,
        status: "published",
        editorRating: d.editorRating,
        position,
        cityId: bangkok.id,
        latitude: bangkok.centroidLat ?? 13.7234186,
        longitude: bangkok.centroidLng ?? 100.4762319,
        sourceProvider: "viator",
        sourceProviderTourId: d.productCode,
      },
      select: { id: true },
    });

    // The linked Tour carries the card's image + price (idempotent on the
    // provider natural key), pointed back at the Experience.
    await prisma.tour.upsert({
      where: {
        provider_providerTourId: {
          provider: "viator",
          providerTourId: d.productCode,
        },
      },
      update: {
        title: d.title,
        imageUrl: d.imageUrl,
        imageAlt: d.title,
        priceMinor: d.priceMinor,
        currency: "USD",
        destinationRefs: ["343"],
        experienceId: experience.id,
      },
      create: {
        provider: "viator",
        providerTourId: d.productCode,
        title: d.title,
        imageUrl: d.imageUrl,
        imageAlt: d.title,
        priceMinor: d.priceMinor,
        currency: "USD",
        destinationRefs: ["343"],
        latitude: bangkok.centroidLat ?? 13.7234186,
        longitude: bangkok.centroidLng ?? 100.4762319,
        experienceId: experience.id,
        fetchedAt: new Date(),
        sourceHash: `seed-${d.productCode}`,
      },
    });
  }
  console.log(
    `Seeded Thailand/Bangkok with ${BANGKOK_DEMO.length} published imported experiences.`,
  );
}

async function main(): Promise<void> {
  await seedCuratedCities();
  await seedParis();
  await seedBangkokDemo();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
