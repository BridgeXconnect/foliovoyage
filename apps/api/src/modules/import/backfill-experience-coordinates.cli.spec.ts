import { describe, expect, it, jest } from "@jest/globals";

import {
  main,
  planTour,
  ReadOnlyOverlayCache,
  type BackfillStore,
  type CityRow,
  type TourRow,
} from "./backfill-experience-coordinates.cli";
import type { LatLng } from "./position";
import type { ResolvedLocation } from "./location-resolver";
import type { RawArchiveReader } from "./storage/raw-archive.reader";
import type { ViatorProduct } from "./clients/viator.types";

const HANOI_CENTROID = { latitude: 21.02425, longitude: 105.854694 };
const BALI_CENTROID = { latitude: -8.4095178, longitude: 115.188916 };
const UBUD = { latitude: -8.5192680019, longitude: 115.2632979979 };

const CITIES: CityRow[] = [
  { viatorDestRef: "351", slug: "hanoi", centroidLat: HANOI_CENTROID.latitude, centroidLng: HANOI_CENTROID.longitude },
  { viatorDestRef: "98", slug: "bali", centroidLat: BALI_CENTROID.latitude, centroidLng: BALI_CENTROID.longitude },
];

const loc = (ref: string) => ({ location: { ref } });

function product(code: string, poiRef?: string): ViatorProduct {
  return {
    productCode: code,
    itinerary: poiRef ? { itineraryItems: [{ pointOfInterestLocation: loc(poiRef) }] } : {},
  };
}

function tour(
  id: string,
  refs: string[],
  exp: { latitude: number; longitude: number } | null,
  pair: { latitude: number; longitude: number } | null = null,
): TourRow {
  return {
    id,
    providerTourId: id,
    destinationRefs: refs,
    latitude: pair?.latitude ?? null,
    longitude: pair?.longitude ?? null,
    experience: exp ? { id: `exp-${id}`, ...exp } : null,
  };
}

/** In-memory store that applies guarded writes, so re-runs see real state. */
function fakeStore(tours: TourRow[]) {
  const updateTour = jest.fn(async (id: string, _from: LatLng | null, to: LatLng | null) => {
    const t = tours.find((x) => x.id === id)!;
    t.latitude = to?.latitude ?? null;
    t.longitude = to?.longitude ?? null;
    return 1;
  });
  const updateExperience = jest.fn(async (id: string, _from: LatLng, to: LatLng) => {
    const t = tours.find((x) => x.experience?.id === id)!;
    t.experience = { id, latitude: to.latitude, longitude: to.longitude };
    return 1;
  });
  const store: BackfillStore = {
    cities: async () => CITIES,
    activeTours: async () => tours,
    updateTour,
    updateExperience,
  };
  return { store, updateTour, updateExperience };
}

function fakeReader(pages: ViatorProduct[][]): RawArchiveReader {
  return {
    listPageKeys: async () => pages.map((_, i) => `raw/viator/2026-09-25/${i + 1}.json`),
    readPage: async (key) => pages[Number(key.split("/")[3].replace(".json", "")) - 1],
  };
}

const resolverOf = (m: Record<string, { latitude: number; longitude: number }>) => ({
  resolve: async (refs: string[]) =>
    new Map<string, ResolvedLocation>(
      refs.filter((r) => m[r]).map((r) => [r, { reference: r, ...m[r], name: null }]),
    ),
});

function run(argv: string[], deps: Parameters<typeof main>[3]) {
  const out: string[] = [];
  const err: string[] = [];
  return main(argv, {}, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps).then((code) => ({
    code,
    out: out.join("\n"),
    err: err.join("\n"),
  }));
}

const NEAR_HANOI = { latitude: 21.03, longitude: 105.85 };

describe("backfill-experience-coordinates CLI", () => {
  const setup = () => {
    const tours = [
      // At the Hanoi centroid; its POI resolves near the city → real.
      tour("H1", ["351"], HANOI_CENTROID),
      // Bali tour with no payload match: sub-region fallback (Ubud) replaces the centroid.
      tour("B1", ["5467"], BALI_CENTROID),
      // Hand-placed Experience (not centroid/pair/sub-region): must be left alone.
      tour("H2", ["351"], { latitude: 21.1, longitude: 105.9 }),
    ];
    const reader = fakeReader([[product("H1", "LOC-h1"), product("H2", "LOC-h1")]]);
    const resolver = resolverOf({ "LOC-h1": NEAR_HANOI });
    return { tours, reader, resolver };
  };

  it("dry run (the default) writes nothing and says so", async () => {
    const { tours, reader, resolver } = setup();
    const { store, updateTour, updateExperience } = fakeStore(tours);

    const { code, out } = await run([], { store, reader, resolver, disconnect: async () => {} });

    expect(code).toBe(0);
    expect(updateTour).not.toHaveBeenCalled();
    expect(updateExperience).not.toHaveBeenCalled();
    expect(out).toContain("dry run, nothing is changed");
    expect(out).toContain("Dry run: would update");
    expect(out).toContain("--execute");
  });

  it("--execute writes the Tour pair and Experience position", async () => {
    const { tours, reader, resolver } = setup();
    const { store, updateTour, updateExperience } = fakeStore(tours);

    const { code, out } = await run(["--execute"], { store, reader, resolver, disconnect: async () => {} });

    expect(code).toBe(0);
    expect(out).toContain("EXECUTE");
    // H1: tour pair from the POI, Experience moved off the centroid onto it.
    expect(updateTour).toHaveBeenCalledWith("H1", null, NEAR_HANOI);
    expect(updateExperience).toHaveBeenCalledWith("exp-H1", HANOI_CENTROID, NEAR_HANOI);
    // B1: no archived payload → tour untouched, Experience gets the Ubud sub-region centre.
    expect(updateTour).not.toHaveBeenCalledWith("B1", expect.anything(), expect.anything());
    expect(updateExperience).toHaveBeenCalledWith("exp-B1", BALI_CENTROID, UBUD);
  });

  it("never overwrites a hand-set Experience position", async () => {
    const { tours, reader, resolver } = setup();
    const { store, updateExperience } = fakeStore(tours);

    const { out } = await run(["--execute"], { store, reader, resolver, disconnect: async () => {} });

    expect(updateExperience).not.toHaveBeenCalledWith("exp-H2", expect.anything(), expect.anything());
    expect(out).toContain("skipped as manual overrides 1");
  });

  it("is idempotent: a second --execute run changes nothing", async () => {
    const { tours, reader, resolver } = setup();
    const { store, updateTour, updateExperience } = fakeStore(tours);
    const deps = { store, reader, resolver, disconnect: async () => {} };

    await run(["--execute"], deps);
    updateTour.mockClear();
    updateExperience.mockClear();
    await run(["--execute"], deps);

    expect(updateTour).not.toHaveBeenCalled();
    expect(updateExperience).not.toHaveBeenCalled();
  });

  it("reports before/after coverage", async () => {
    const { tours, reader, resolver } = setup();
    const { store } = fakeStore(tours);

    const { out } = await run([], { store, reader, resolver, disconnect: async () => {} });

    // Hanoi: H1 city→real, H2 manual (counted real as it isn't a fallback): 1/2 → 2/2.
    expect(out).toMatch(/hanoi\s+2 Experiences\s+real before\s+50\.0%\s+after\s+100\.0%/);
    expect(out).toContain("without 1");
  });

  it("--city writes only that city's rows, leaving every other city untouched", async () => {
    const { tours, reader, resolver } = setup();
    const { store, updateTour, updateExperience } = fakeStore(tours);

    const { code, out } = await run(["--execute", "--city", "bali"], { store, reader, resolver, disconnect: async () => {} });

    expect(code).toBe(0);
    expect(out).toContain("Restricted to bali: 1 of 3 tour(s).");
    // Only B1 (Bali): Hanoi's H1 would otherwise have moved, but must not.
    expect(updateTour).not.toHaveBeenCalled();
    expect(updateExperience).toHaveBeenCalledTimes(1);
    expect(updateExperience.mock.calls[0][0]).toBe("exp-B1");
    expect(tours.find((t) => t.id === "H1")!.experience).toEqual({ id: "exp-H1", ...HANOI_CENTROID });
  });

  it("--city only scans payloads for that city's tours", async () => {
    const { tours, reader, resolver } = setup();
    const { store } = fakeStore(tours);
    const { out } = await run(["--city", "hanoi"], { store, reader, resolver, disconnect: async () => {} });
    expect(out).toContain("Restricted to hanoi: 2 of 3 tour(s).");
    expect(out).toContain("Found archived payloads for 2 of 2 tours");
  });

  it("--city rejects an unknown or missing slug", async () => {
    for (const argv of [["--city", "atlantis"], ["--city"]]) {
      const { code, err } = await run(argv, { disconnect: async () => {} });
      expect(code).toBe(1);
      expect(err).toContain("--city needs one of:");
    }
  });

  it("reports the true number of rows written when writes run concurrently", async () => {
    const tours = Array.from({ length: 30 }, (_, i) => tour(`H${i}`, ["351"], HANOI_CENTROID));
    const reader = fakeReader([tours.map((t) => product(t.providerTourId, "LOC-h1"))]);
    const { store } = fakeStore(tours);
    const slow = store.updateExperience.bind(store);
    // Yield so all writers of a batch are in flight together, as with real DB round-trips.
    store.updateExperience = async (...args) => {
      await new Promise((resolve) => setImmediate(resolve));
      return slow(...args);
    };

    const { out } = await run(["--execute"], {
      store,
      reader,
      resolver: resolverOf({ "LOC-h1": NEAR_HANOI }),
      disconnect: async () => {},
    });

    expect(out).toContain("Updated 30 Tour row(s) and 30 Experience row(s)");
  });

  it("rejects unknown arguments", async () => {
    const { code, err } = await run(["--wat"], { disconnect: async () => {} });
    expect(code).toBe(1);
    expect(err).toContain('Unknown argument "--wat"');
  });
});

describe("planTour", () => {
  const cityBySlug = new Map(CITIES.map((c) => [c.slug, c]));

  it("clears a stale start pair when no candidate is within the radius", () => {
    const plan = planTour({
      tour: tour("H9", ["351"], HANOI_CENTROID, { latitude: 20.95, longitude: 107.08 }),
      cityBySlug,
      candidates: [{ source: "start", ref: "LOC-far" }],
      resolved: new Map([["LOC-far", { latitude: 20.95, longitude: 107.08 }]]),
    });
    expect(plan?.tourTo).toBeNull();
    expect(plan?.tourChanged).toBe(true);
    expect(plan?.basis).toBe("city");
  });

  it("leaves a tour with no archived payload alone", () => {
    const plan = planTour({
      tour: tour("H8", ["351"], HANOI_CENTROID, NEAR_HANOI),
      cityBySlug,
      candidates: undefined,
      resolved: new Map(),
    });
    expect(plan?.hadPayload).toBe(false);
    expect(plan?.tourChanged).toBe(false);
  });
});

describe("ReadOnlyOverlayCache", () => {
  it("serves fresh results from memory but never writes to the inner cache", async () => {
    const inner = { getMany: jest.fn(async () => new Map<string, ResolvedLocation>()), putMany: jest.fn(async () => {}) };
    const cache = new ReadOnlyOverlayCache(inner);
    await cache.putMany([{ reference: "LOC-a", latitude: 1, longitude: 2, name: null }]);

    expect(inner.putMany).not.toHaveBeenCalled();
    expect((await cache.getMany(["LOC-a"])).get("LOC-a")?.latitude).toBe(1);
  });
});
