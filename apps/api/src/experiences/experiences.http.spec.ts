import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Logger, VERSION_NEUTRAL, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { experiencePageSchema, experienceRatingSchema, type ExperiencePage } from "@folio/shared";

import { computeGroundingHash } from "../modules/content/tour-copy-grounding-hash";
import { PrismaService } from "../prisma/prisma.service";
import { EXPERIENCE_CACHE_CONTROL, ExperiencesController } from "./experiences.controller";
import { ExperiencesService, NOT_FOUND_DETAIL } from "./experiences.service";

/**
 * AC-1, AC-2, AC-3 and AC-5 through the real controller, filter and service, over
 * real HTTP, with Prisma faked in memory. No database, so this runs in CI.
 *
 * The fake honours the `where`, `orderBy` and `take` the service passes for the
 * Experience's tours, so dropping the `deletedAt` filter or the id ordering from
 * the service fails here. What it cannot prove is that Postgres agrees; the
 * database backed `experiences.integration.spec.ts` covers that locally.
 */

interface TourRow {
  id: string;
  title: string;
  description: string | null;
  durationMin: number | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  priceMinor: bigint | null;
  currency: string | null;
  affiliateUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  images: unknown;
  inclusions: unknown;
  exclusions: unknown;
  cancellationPolicy: unknown;
  deletedAt: Date | null;
  tourCopy: { status: string; aiSummary: string | null; groundingHash: string } | null;
}

interface ExperienceRow {
  id: string;
  title: string;
  status: string;
  city: { slug: string; countrySlug: string; name: string };
  tours: TourRow[];
}

const CITY = { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" };

function tour(over: Partial<TourRow> = {}): TourRow {
  return {
    id: "tour-b",
    title: "Grand Palace Walking Tour",
    description: "A walk through the palace.",
    durationMin: 180,
    ratingAvg: 4.6,
    ratingCount: 120,
    priceMinor: 450_000n,
    currency: "THB",
    affiliateUrl: "https://www.viator.com/tours/Bangkok/x/d343-1P1?pid=P1&mcid=42383",
    imageUrl: "https://img.test/plain.jpg",
    imageAlt: "The palace at dawn",
    images: [
      {
        isCover: true,
        variants: [
          { url: "https://img.test/480.jpg", width: 480, height: 320 },
          { url: "https://img.test/720.jpg", width: 720, height: 480 },
        ],
      },
    ],
    inclusions: [],
    exclusions: [],
    cancellationPolicy: { type: "STANDARD", description: "Cancel up to 24 hours before.\nFull refund.", refundTiers: [] },
    deletedAt: null,
    tourCopy: null,
    ...over,
  };
}

function experience(over: Partial<ExperienceRow> = {}): ExperienceRow {
  return { id: "exp-1", title: "Experience title, not the tour title", status: "published", city: CITY, tours: [tour()], ...over };
}

type FindArgs = {
  where: { id: string };
  select: { tours: { where: { deletedAt: null }; orderBy: { id: "asc" }; take: number } };
};

let rows: ExperienceRow[] = [];
let failWith: Error | null = null;

const fakePrisma = {
  experience: {
    findUnique: async ({ where, select }: FindArgs) => {
      if (failWith) throw failWith;
      const found = rows.find((r) => r.id === where.id);
      if (!found) return null;
      const { where: tw, orderBy, take } = select.tours;
      let tours = found.tours.filter((t) => t.deletedAt === tw.deletedAt);
      if (orderBy.id === "asc") tours = [...tours].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { ...found, tours: tours.slice(0, take) };
    },
  },
} as unknown as PrismaService;

let app: INestApplication;
let baseUrl = "";

async function get(path: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function page(): Promise<ExperiencePage> {
  const { status, body } = await get("/v1/experiences/exp-1");
  expect(status).toBe(200);
  return experiencePageSchema.parse(body);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ExperiencesController],
    providers: [ExperiencesService, { provide: PrismaService, useValue: fakePrisma }],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  rows = [];
  failWith = null;
  jest.restoreAllMocks();
});

describe("GET /v1/experiences/:id (AC-1)", () => {
  it("returns the page data, parses against the shared schema, and carries no rating", async () => {
    rows = [experience()];
    const { status, body } = await get("/v1/experiences/exp-1");
    expect(status).toBe(200);
    expect(experiencePageSchema.parse(body)).toEqual({
      experienceId: "exp-1",
      tourId: "tour-b",
      title: "Grand Palace Walking Tour",
      image: { url: "https://img.test/720.jpg", width: 720, height: 480, alt: "The palace at dawn" },
      durationMin: 180,
      price: { amountMinor: 450000, currency: "THB" },
      cancellationDescription: "Cancel up to 24 hours before.\nFull refund.",
      summary: { kind: "provider", text: "A walk through the palace." },
      affiliateUrl: "https://www.viator.com/tours/Bangkok/x/d343-1P1?pid=P1&mcid=42383",
      city: CITY,
    });
    // Parsing strips unknown keys, so check the raw wire body too: no rating field, no rating value.
    expect(Object.keys(body as object).sort()).toEqual(Object.keys(experiencePageSchema.shape).sort());
    expect(JSON.stringify(body).toLowerCase()).not.toContain("rating");
    expect(JSON.stringify(body)).not.toContain("4.6");
  });

  it("takes the title from the Tour, not the Experience", async () => {
    rows = [experience()];
    expect((await page()).title).toBe("Grand Palace Walking Tour");
  });

  it("sends a BigInt price as a JSON integer", async () => {
    rows = [experience({ tours: [tour({ priceMinor: 12_345_678_901n })] })];
    const res = await fetch(`${baseUrl}/v1/experiences/exp-1`);
    expect(await res.text()).toContain('"amountMinor":12345678901');
  });

  it("has a null price when priceMinor or currency is null", async () => {
    rows = [experience({ tours: [tour({ priceMinor: null })] })];
    expect((await page()).price).toBeNull();
    rows = [experience({ tours: [tour({ currency: null })] })];
    expect((await page()).price).toBeNull();
  });

  it("has a null price for an amount that would not survive as an exact JSON number", async () => {
    rows = [experience({ tours: [tour({ priceMinor: 2n ** 60n })] })];
    expect((await page()).price).toBeNull();
  });

  it("returns the cancellation text exactly as stored, line breaks included", async () => {
    const text = "  Line one.\n\nLine two.\r\n- point  ";
    rows = [experience({ tours: [tour({ cancellationPolicy: { type: "X", description: text } })] })];
    expect((await page()).cancellationDescription).toBe(text);
  });

  it.each([
    ["no policy", null],
    ["a policy without a description", { type: "X", refundTiers: [{ percentageRefundable: 100 }] }],
    ["a description that is not a string", { description: 42 }],
    ["an empty description", { description: "   " }],
    ["a policy that is not an object", "STANDARD"],
  ])("has a null cancellation text for %s, and never builds one from refundTiers", async (_name, policy) => {
    rows = [experience({ tours: [tour({ cancellationPolicy: policy })] })];
    expect((await page()).cancellationDescription).toBeNull();
  });

  it("falls back to the title for the image alt, and to imageUrl for the image", async () => {
    rows = [experience({ tours: [tour({ imageAlt: null, images: [] })] })];
    expect((await page()).image).toEqual({
      url: "https://img.test/plain.jpg",
      width: null,
      height: null,
      alt: "Grand Palace Walking Tour",
    });
  });

  it("has a null image when the Tour has none", async () => {
    rows = [experience({ tours: [tour({ imageUrl: null, images: [] })] })];
    expect((await page()).image).toBeNull();
  });

  it("has a null affiliateUrl when the Tour has none", async () => {
    rows = [experience({ tours: [tour({ affiliateUrl: null })] })];
    expect((await page()).affiliateUrl).toBeNull();
  });

  it("has a null duration when the Tour has none", async () => {
    rows = [experience({ tours: [tour({ durationMin: null })] })];
    expect((await page()).durationMin).toBeNull();
  });
});

describe("which Tour (AC-1)", () => {
  it("uses the live Tour with the lowest id, skipping a deleted lower one", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    rows = [
      experience({
        tours: [
          tour({ id: "tour-c", title: "C" }),
          tour({ id: "tour-a", title: "A", deletedAt: new Date() }),
          tour({ id: "tour-b", title: "B" }),
        ],
      }),
    ];
    const p = await page();
    expect(p.tourId).toBe("tour-b");
    expect(p.title).toBe("B");
  });

  it("warns once per Experience when it has more than one live Tour, and the rating comes from the same Tour", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // Its own id: the service remembers which Experiences it has already warned about.
    rows = [
      experience({
        id: "exp-multi",
        tours: [
          tour({ id: "tour-b", ratingAvg: 4.1, ratingCount: 11 }),
          tour({ id: "tour-a", ratingAvg: 4.9, ratingCount: 99 }),
        ],
      }),
    ];
    const first = experiencePageSchema.parse((await get("/v1/experiences/exp-multi")).body);
    expect(first.tourId).toBe("tour-a");
    await get("/v1/experiences/exp-multi");
    expect((await get("/v1/experiences/exp-multi/rating")).body).toEqual({ ratingAvg: 4.9, ratingCount: 99 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("exp-multi");
  });

  it("does not warn for one live Tour next to a deleted one", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    rows = [experience({ tours: [tour({ id: "tour-a", deletedAt: new Date() }), tour({ id: "tour-b" })] })];
    await page();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("summary (AC-5)", () => {
  const grounding = (t: TourRow) =>
    computeGroundingHash({
      title: t.title,
      description: t.description,
      durationMin: t.durationMin,
      inclusions: t.inclusions,
      exclusions: t.exclusions,
    });
  const copy = (t: TourRow, over: Partial<NonNullable<TourRow["tourCopy"]>> = {}) => ({
    status: "published",
    aiSummary: "Written for Atlas.",
    groundingHash: grounding(t),
    ...over,
  });

  it("is the AI copy when it is published, its hash is current and the Tour is eligible", async () => {
    const t = tour();
    rows = [experience({ tours: [{ ...t, tourCopy: copy(t) }] })];
    expect((await page()).summary).toEqual({ kind: "ai", text: "Written for Atlas." });
  });

  it("falls back to the provider text when the grounding hash is stale", async () => {
    const t = tour();
    rows = [experience({ tours: [{ ...t, tourCopy: copy(t, { groundingHash: "v1:stale" }) }] })];
    expect((await page()).summary).toEqual({ kind: "provider", text: "A walk through the palace." });
  });

  it("falls back to the provider text when the copy is not published", async () => {
    const t = tour();
    rows = [experience({ tours: [{ ...t, tourCopy: copy(t, { status: "withdrawn" }) }] })];
    expect((await page()).summary?.kind).toBe("provider");
  });

  it("falls back to the provider text when the Tour is no longer eligible", async () => {
    const t = tour({ ratingCount: 2 });
    rows = [experience({ tours: [{ ...t, tourCopy: copy(t) }] })];
    expect((await page()).summary?.kind).toBe("provider");
  });

  it("strips markup from the provider text, with paragraph breaks and no truncation", async () => {
    const long = "word ".repeat(1500).trim();
    rows = [experience({ tours: [tour({ description: `<p>Fish &amp; chips<br>at <b>dawn</b>.</p><p>${long}</p>` })] })];
    expect((await page()).summary).toEqual({ kind: "provider", text: `Fish & chips\n\nat dawn.\n\n${long}` });
  });

  it("is null when nothing is left after stripping, or there is no description", async () => {
    rows = [experience({ tours: [tour({ description: "<p>&nbsp;</p><br/>" })] })];
    expect((await page()).summary).toBeNull();
    rows = [experience({ tours: [tour({ description: null })] })];
    expect((await page()).summary).toBeNull();
  });
});

describe("GET /v1/experiences/:id/rating (AC-2)", () => {
  it("returns the Tour's rating and nothing else, and parses against the shared schema", async () => {
    rows = [experience()];
    const { status, body } = await get("/v1/experiences/exp-1/rating");
    expect(status).toBe(200);
    expect(body).toEqual({ ratingAvg: 4.6, ratingCount: 120 });
    expect(experienceRatingSchema.safeParse(body).success).toBe(true);
  });

  it("returns nulls for an unrated Tour", async () => {
    rows = [experience({ tours: [tour({ ratingAvg: null, ratingCount: null })] })];
    expect((await get("/v1/experiences/exp-1/rating")).body).toEqual({ ratingAvg: null, ratingCount: null });
  });
});

describe("404s and the cache header (AC-3)", () => {
  const paths = ["/v1/experiences/exp-1", "/v1/experiences/exp-1/rating"];

  it("pins the header value", () => {
    expect(EXPERIENCE_CACHE_CONTROL).toBe("public, s-maxage=900, stale-while-revalidate=86400");
  });

  it.each(paths)("sets the cache header on a 200 from %s", async (path) => {
    rows = [experience()];
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(EXPERIENCE_CACHE_CONTROL);
  });

  const cases: Array<[string, () => void, string]> = [
    ["an unknown Experience", () => (rows = []), NOT_FOUND_DETAIL.unknown],
    ["a draft Experience", () => (rows = [experience({ status: "draft" })]), NOT_FOUND_DETAIL.unpublished],
    ["a draft Experience with no Tour", () => (rows = [experience({ status: "draft", tours: [] })]), NOT_FOUND_DETAIL.unpublished],
    ["a published Experience with no Tour", () => (rows = [experience({ tours: [] })]), NOT_FOUND_DETAIL.noLiveTour],
    [
      "a published Experience whose only Tour is soft deleted",
      () => (rows = [experience({ tours: [tour({ deletedAt: new Date() })] })]),
      NOT_FOUND_DETAIL.noLiveTour,
    ],
  ];

  describe.each(paths)("%s", (path) => {
    it.each(cases)("404s for %s, as problem+json with its own detail and the cache header", async (_name, arrange, detail) => {
      arrange();
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(res.headers.get("cache-control")).toBe(EXPERIENCE_CACHE_CONTROL);
      expect(res.body).toMatchObject({ type: "about:blank", title: "Not Found", status: 404, detail, instance: path });
    });
  });

  it("gives the three cases three different details", () => {
    expect(new Set(Object.values(NOT_FOUND_DETAIL)).size).toBe(3);
  });

  it.each(paths)("does not let a CDN hold a server error: %s has no cache header on a 500", async (path) => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    rows = [experience()];
    failWith = new Error("connection reset");
    const res = await get(path);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
  });
});
