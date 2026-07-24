import { PrismaClient } from "@prisma/client";

/**
 * Seed for the first vertical slice (ST-5 / BRI-100).
 *
 * Inserts exactly one destination — Paris, France — plus a small handful of
 * experiences linked to it. This is the single row the `/v1/destinations/:country/:city`
 * endpoint reads and the web app renders end-to-end. It is intentionally tiny;
 * real content lives in M1+.
 *
 * Idempotent: safe to run repeatedly (upsert the city, then replace its
 * experiences), so re-seeding a dev DB never duplicates rows.
 */
const prisma = new PrismaClient();

// Wikimedia Commons (public) — self-explanatory placeholder until real product
// imagery lands. The web app allow-lists this host in next.config.ts.
const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/1280px-Tour_Eiffel_Wikimedia_Commons.jpg";
const HERO_IMAGE_ALT =
  "The Eiffel Tower rising above the Champ de Mars in Paris at dusk";

const EXPERIENCES: { title: string; description: string }[] = [
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

async function main(): Promise<void> {
  const city = await prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: "france", slug: "paris" } },
    update: {
      name: "Paris",
      country: "France",
      heroImageUrl: HERO_IMAGE_URL,
      heroImageAlt: HERO_IMAGE_ALT,
    },
    create: {
      slug: "paris",
      countrySlug: "france",
      name: "Paris",
      country: "France",
      heroImageUrl: HERO_IMAGE_URL,
      heroImageAlt: HERO_IMAGE_ALT,
    },
  });

  // Replace experiences wholesale so re-runs stay idempotent.
  await prisma.experience.deleteMany({ where: { cityId: city.id } });
  await prisma.experience.createMany({
    data: EXPERIENCES.map((e, position) => ({ ...e, position, cityId: city.id })),
  });

  console.log(
    `Seeded ${city.country}/${city.name} with ${EXPERIENCES.length} experiences.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
