import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { ExperienceAutoPromoter } from "./experience-auto-promoter";

/**
 * Integration tests for {@link ExperienceAutoPromoter.promoteEligible}
 * (category/currency promotion plan, Task 7 / Decision 3) against a **real
 * Postgres**. Verifies the acceptance criteria the pure `isPromotable` unit
 * tests (`experience-auto-promoter.spec.ts`) can't reach on their own: the DB
 * query scopes correctly by provider + non-deleted Tour, and the
 * `status: "draft"` write guard makes a re-run promote nothing.
 *
 * Fixtures are scoped by a dedicated `provider`/`sourceProvider` so they never
 * touch the real `viator` rows other integration specs manage — same
 * isolation approach as `experience-linker.integration.spec.ts`.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "auto-promoter-test";
const CITY_SLUG = "auto-promoter-test-city";

function promoter(): ExperienceAutoPromoter {
  return new ExperienceAutoPromoter(prisma);
}

async function makeCity(): Promise<{ id: string }> {
  return prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: CITY_SLUG, slug: CITY_SLUG } },
    update: {},
    create: {
      slug: CITY_SLUG,
      countrySlug: CITY_SLUG,
      name: "Auto-Promoter Test City",
      country: "Testland",
      heroImageUrl: "https://img/hero.jpg",
      heroImageAlt: "hero",
    },
    select: { id: true },
  });
}

async function makeExperience(input: {
  providerTourId: string;
  status: string;
  title?: string;
  description?: string;
  cityId: string;
}): Promise<{ id: string }> {
  return prisma.experience.create({
    data: {
      title: input.title ?? "Title",
      description: input.description ?? "Description",
      status: input.status,
      latitude: 1,
      longitude: 1,
      cityId: input.cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: input.providerTourId,
    },
    select: { id: true },
  });
}

async function makeTour(input: {
  providerTourId: string;
  experienceId: string | null;
  imageUrl?: string | null;
  affiliateUrl?: string | null;
  priceReferenceMinor?: bigint | number | null;
  deletedAt?: Date | null;
}): Promise<{ id: string }> {
  return prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId: input.providerTourId,
      title: `Tour ${input.providerTourId}`,
      experienceId: input.experienceId,
      imageUrl: input.imageUrl === undefined ? "https://img/x.jpg" : input.imageUrl,
      affiliateUrl: input.affiliateUrl === undefined ? "https://go/x" : input.affiliateUrl,
      priceReferenceMinor:
        input.priceReferenceMinor === undefined ? 3000 : input.priceReferenceMinor,
      priceMinor: 3000,
      currency: "USD",
      deletedAt: input.deletedAt ?? null,
      fetchedAt: new Date(),
      sourceHash: `hash-${input.providerTourId}`,
    },
    select: { id: true },
  });
}

async function cleanup(): Promise<void> {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.city.deleteMany({ where: { countrySlug: CITY_SLUG, slug: CITY_SLUG } });
  await prisma.$disconnect();
});

describe("ExperienceAutoPromoter.promoteEligible", () => {
  it("promotes exactly the eligible draft and no-ops on a re-run", async () => {
    const city = await makeCity();

    // A promotable draft: linked Tour has image, affiliate link, positive reference price.
    const promotable = await makeExperience({
      providerTourId: "P1",
      status: "draft",
      cityId: city.id,
    });
    await makeTour({ providerTourId: "P1", experienceId: promotable.id });

    // A non-promotable draft: linked Tour has a null reference price.
    const nonPromotable = await makeExperience({
      providerTourId: "P2",
      status: "draft",
      cityId: city.id,
    });
    await makeTour({
      providerTourId: "P2",
      experienceId: nonPromotable.id,
      priceReferenceMinor: null,
    });

    // An already-published row — should stay untouched and not be re-counted.
    const alreadyPublished = await makeExperience({
      providerTourId: "P3",
      status: "published",
      cityId: city.id,
    });
    await makeTour({ providerTourId: "P3", experienceId: alreadyPublished.id });

    const first = await promoter().promoteEligible(PROVIDER);
    expect(first).toEqual({ scanned: 2, promoted: 1 });

    const reloadedPromotable = await prisma.experience.findUnique({
      where: { id: promotable.id },
    });
    expect(reloadedPromotable!.status).toBe("published");

    const reloadedNonPromotable = await prisma.experience.findUnique({
      where: { id: nonPromotable.id },
    });
    expect(reloadedNonPromotable!.status).toBe("draft");

    const reloadedAlreadyPublished = await prisma.experience.findUnique({
      where: { id: alreadyPublished.id },
    });
    expect(reloadedAlreadyPublished!.status).toBe("published");

    // Idempotent: nothing left in `draft` for this provider that qualifies.
    const second = await promoter().promoteEligible(PROVIDER);
    expect(second).toEqual({ scanned: 1, promoted: 0 });
  });

  it("ignores a draft whose linked Tour is soft-deleted", async () => {
    const city = await makeCity();
    const exp = await makeExperience({ providerTourId: "P4", status: "draft", cityId: city.id });
    await makeTour({ providerTourId: "P4", experienceId: exp.id, deletedAt: new Date() });

    const result = await promoter().promoteEligible(PROVIDER);
    expect(result).toEqual({ scanned: 0, promoted: 0 });

    const reloaded = await prisma.experience.findUnique({ where: { id: exp.id } });
    expect(reloaded!.status).toBe("draft");
  });

  it("does not touch another provider's draft Experiences", async () => {
    const city = await makeCity();
    const exp = await makeExperience({ providerTourId: "P5", status: "draft", cityId: city.id });
    await prisma.tour.create({
      data: {
        provider: "some-other-provider",
        providerTourId: "P5",
        title: "Tour P5",
        experienceId: exp.id,
        imageUrl: "https://img/x.jpg",
        affiliateUrl: "https://go/x",
        priceReferenceMinor: 3000,
        priceMinor: 3000,
        currency: "USD",
        fetchedAt: new Date(),
        sourceHash: "hash-P5",
      },
    });

    const result = await promoter().promoteEligible(PROVIDER);
    expect(result).toEqual({ scanned: 0, promoted: 0 });

    const reloaded = await prisma.experience.findUnique({ where: { id: exp.id } });
    expect(reloaded!.status).toBe("draft");

    await prisma.tour.deleteMany({ where: { provider: "some-other-provider" } });
  });
});
