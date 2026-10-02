import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "./http/allowlist-fetch";
import type { Sleep } from "./http/fetch-with-backoff";
import {
  LocationResolver,
  MAX_LOCATIONS_PER_REQUEST,
  type LocationCache,
  type LocationResolverConfig,
  type ResolvedLocation,
} from "./location-resolver";
import { normalizeViatorProduct } from "./normalizer";

const CONFIG: LocationResolverConfig = {
  baseUrl: "https://api.viator.com/partner",
  apiKey: "test-key",
  language: "en-US",
};

/** In-memory {@link LocationCache}; the persistent store is faked in tests. */
class FakeCache implements LocationCache {
  readonly store = new Map<string, ResolvedLocation>();
  readonly puts: ResolvedLocation[][] = [];

  seed(...locations: ResolvedLocation[]): this {
    for (const loc of locations) this.store.set(loc.reference, loc);
    return this;
  }

  getMany(references: string[]): Promise<Map<string, ResolvedLocation>> {
    const hit = new Map<string, ResolvedLocation>();
    for (const ref of references) {
      const loc = this.store.get(ref);
      if (loc) hit.set(ref, loc);
    }
    return Promise.resolve(hit);
  }

  putMany(locations: ResolvedLocation[]): Promise<void> {
    this.puts.push(locations);
    for (const loc of locations) this.store.set(loc.reference, loc);
    return Promise.resolve();
  }
}

/** One `center`-bearing location, as `/locations/bulk` returns it. */
function apiLocation(reference: string, lat: number, lng: number) {
  return {
    reference,
    name: `Name ${reference}`,
    address: { city: "Somewhere" }, // extra field the resolver must tolerate
    center: { latitude: lat, longitude: lng },
  };
}

/**
 * A fetch stub for `/locations/bulk`. Echoes back a `center` for every reference
 * in the request body, and records each request's parsed body so tests can
 * assert on batch composition and call count.
 */
function bulkFetch(): {
  fetchImpl: jest.Mock<FetchLike>;
  bodies: string[][];
} {
  const bodies: string[][] = [];
  const fetchImpl = jest.fn<FetchLike>((_input, init) => {
    const body = JSON.parse(String(init?.body)) as { locations: string[] };
    bodies.push(body.locations);
    const locations = body.locations.map((ref, i) =>
      apiLocation(ref, 10 + i, 20 + i),
    );
    return Promise.resolve(
      new Response(JSON.stringify({ locations }), { status: 200 }),
    );
  });
  return { fetchImpl, bodies };
}

function makeResolver(
  fetchImpl: jest.Mock<FetchLike>,
  cache: FakeCache = new FakeCache(),
): { resolver: LocationResolver; cache: FakeCache } {
  const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
  return { resolver: new LocationResolver(CONFIG, http, cache), cache };
}

describe("LocationResolver — resolve", () => {
  it("resolves references to coordinates via /locations/bulk", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a", "LOC-b"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Hit the right endpoint with a POST and the references in the body.
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "https://api.viator.com/partner/locations/bulk",
    );
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("POST");
    expect(bodies[0]).toEqual(["LOC-a", "LOC-b"]);

    expect(resolved.get("LOC-a")).toEqual({
      reference: "LOC-a",
      latitude: 10,
      longitude: 20,
      name: "Name LOC-a",
    });
    expect(resolved.get("LOC-b")?.latitude).toBe(11);
  });

  it("dedupes and drops empty references before requesting", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    await resolver.resolve(["LOC-a", "LOC-a", "", "LOC-b"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toEqual(["LOC-a", "LOC-b"]);
  });

  it("persists freshly-resolved locations to the cache", async () => {
    const { fetchImpl } = bulkFetch();
    const { resolver, cache } = makeResolver(fetchImpl);

    await resolver.resolve(["LOC-a"]);

    expect(cache.store.get("LOC-a")?.latitude).toBe(10);
    expect(cache.puts).toHaveLength(1);
  });

  it("skips locations returned without usable center coordinates", async () => {
    // One with a center, one without — the second must be dropped, not crash.
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            locations: [
              apiLocation("LOC-a", 1, 2),
              { reference: "LOC-nocenter", name: "No coords" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { resolver } = makeResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a", "LOC-nocenter"]);

    expect(resolved.has("LOC-a")).toBe(true);
    expect(resolved.has("LOC-nocenter")).toBe(false);
  });

  it("throws on a non-OK response from /locations/bulk", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(
        new Response("Maximum number of locations 500 exceeded", {
          status: 400,
          statusText: "Bad Request",
        }),
      ),
    );
    const { resolver } = makeResolver(fetchImpl);

    await expect(resolver.resolve(["LOC-a"])).rejects.toThrow(/400/);
  });
});

describe("LocationResolver — /locations/bulk retry (BRI-183)", () => {
  /** A 200 echoing a `center` for every requested reference. */
  function okResponse(init?: RequestInit): Response {
    const body = JSON.parse(String(init?.body)) as { locations: string[] };
    return new Response(
      JSON.stringify({
        locations: body.locations.map((ref) => apiLocation(ref, 1, 2)),
      }),
      { status: 200 },
    );
  }

  /** Fails the first `failures.length` calls as scripted, then succeeds. */
  function scriptedFetch(
    failures: ((init?: RequestInit) => Promise<Response>)[],
  ): jest.Mock<FetchLike> {
    let calls = 0;
    return jest.fn<FetchLike>((_input, init) => {
      const step = failures[calls];
      calls += 1;
      return step ? step(init) : Promise.resolve(okResponse(init));
    });
  }

  function makeRetryingResolver(
    fetchImpl: jest.Mock<FetchLike>,
    maxRetries = 5,
  ): { resolver: LocationResolver; sleep: jest.Mock<Sleep> } {
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const resolver = new LocationResolver(
      CONFIG,
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      new FakeCache(),
      { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries },
      sleep,
      () => 0.5,
    );
    return { resolver, sleep };
  }

  const timeout = () =>
    Promise.reject(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );

  it("retries a timeout, then resolves (one retry)", async () => {
    const fetchImpl = scriptedFetch([timeout]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a"]);

    expect(resolved.get("LOC-a")?.latitude).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(50); // floor(0.5 * 100 * 2^0)
  });

  it("retries a 503, then resolves", async () => {
    const fetchImpl = scriptedFetch([
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
    ]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a"]);

    expect(resolved.has("LOC-a")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("waits the Retry-After of a 429, then resolves", async () => {
    const fetchImpl = scriptedFetch([
      () =>
        Promise.resolve(
          new Response("slow down", {
            status: 429,
            headers: { "retry-after": "3" },
          }),
        ),
    ]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a"]);

    expect(resolved.has("LOC-a")).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("fails a 400 immediately, without retrying", async () => {
    const fetchImpl = scriptedFetch([
      () =>
        Promise.resolve(
          new Response("Maximum number of locations 500 exceeded", {
            status: 400,
            statusText: "Bad Request",
          }),
        ),
    ]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    await expect(resolver.resolve(["LOC-a"])).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a body-read failure on a 200 (the read is inside the retry unit)", async () => {
    const fetchImpl = scriptedFetch([
      (init) => {
        const response = okResponse(init);
        (response as { text: () => Promise<string> }).text = () =>
          Promise.reject(new Error("body read timed out"));
        (response as { json: () => Promise<unknown> }).json = () =>
          Promise.reject(new Error("body read timed out"));
        return Promise.resolve(response);
      },
    ]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    const resolved = await resolver.resolve(["LOC-a"]);

    expect(resolved.has("LOC-a")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry a malformed-JSON 200 (a parse error is not transient)", async () => {
    const fetchImpl = scriptedFetch([
      () => Promise.resolve(new Response("{not json", { status: 200 })),
    ]);
    const { resolver, sleep } = makeRetryingResolver(fetchImpl);

    await expect(resolver.resolve(["LOC-a"])).rejects.toThrow(SyntaxError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects with the last error after exactly maxRetries attempts, caching nothing", async () => {
    const fetchImpl = jest.fn<FetchLike>(timeout);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const cache = new FakeCache();
    const resolver = new LocationResolver(
      CONFIG,
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      cache,
      { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries: 3 },
      sleep,
      () => 0.5,
    );

    await expect(resolver.resolve(["LOC-a"])).rejects.toThrow(
      /after 3 attempts.*aborted due to timeout/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // not after the final attempt
    expect(cache.puts).toHaveLength(0);
  });
});

describe("LocationResolver — caching (no re-fetch on a hit)", () => {
  it("does NOT call /locations/bulk when every reference is already cached", async () => {
    const { fetchImpl } = bulkFetch();
    const cache = new FakeCache().seed({
      reference: "LOC-a",
      latitude: 48.85,
      longitude: 2.35,
      name: "Paris",
    });
    const { resolver } = makeResolver(fetchImpl, cache);

    const resolved = await resolver.resolve(["LOC-a"]);

    // The whole point of the cache: a hit must not hit the API at all.
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(resolved.get("LOC-a")?.latitude).toBe(48.85);
  });

  it("fetches only the cache misses, not the hits", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const cache = new FakeCache().seed({
      reference: "LOC-cached",
      latitude: 1,
      longitude: 2,
      name: null,
    });
    const { resolver } = makeResolver(fetchImpl, cache);

    const resolved = await resolver.resolve(["LOC-cached", "LOC-fresh"]);

    // Only the miss is requested; the hit is served from cache.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toEqual(["LOC-fresh"]);
    expect(resolved.get("LOC-cached")?.latitude).toBe(1);
    expect(resolved.get("LOC-fresh")).toBeDefined();
  });
});

describe("LocationResolver — 500-per-request batching", () => {
  it("splits a batch over 500 references into multiple requests", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    // 1200 refs → 500 + 500 + 200 across three requests.
    const refs = Array.from({ length: 1200 }, (_, i) => `LOC-${i}`);
    const resolved = await resolver.resolve(refs);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(bodies.map((b) => b.length)).toEqual([500, 500, 200]);
    // No batch exceeds Viator's hard limit.
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(MAX_LOCATIONS_PER_REQUEST);
    // Every reference resolved.
    expect(resolved.size).toBe(1200);
  });

  it("sends exactly one request for a full 500-reference batch", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const refs = Array.from({ length: 500 }, (_, i) => `LOC-${i}`);
    await resolver.resolve(refs);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toHaveLength(500);
  });
});

describe("LocationResolver — attachLocations (Tour DTO enrichment)", () => {
  const FETCHED_AT = "2026-07-18T00:00:00.000Z";

  /** A real normalized tour carrying a start reference (ST-7 → ST-7b seam). */
  function tourWithRef(code: string, ref: string) {
    return normalizeViatorProduct(
      {
        productCode: code,
        title: `Tour ${code}`,
        logistics: { start: [{ location: { ref } }] },
      },
      { fetchedAt: FETCHED_AT },
    );
  }

  it("attaches resolved lat/lng to a normalized tour with a start reference", async () => {
    const { fetchImpl } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const tour = tourWithRef("57189P2", "LOC-a");
    expect(tour.location_ref).toBe("LOC-a");
    expect(tour.latitude).toBeNull(); // normalization leaves it unresolved

    const [enriched] = await resolver.attachLocations([tour]);

    expect(enriched.latitude).toBe(10);
    expect(enriched.longitude).toBe(20);
    // Provider fields are preserved untouched.
    expect(enriched.provider_tour_id).toBe("57189P2");
  });

  it("leaves coordinates null for a tour with no start reference", async () => {
    const { fetchImpl } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const tour = normalizeViatorProduct(
      { productCode: "X1", title: "No location" },
      { fetchedAt: FETCHED_AT },
    );

    const [enriched] = await resolver.attachLocations([tour]);

    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(enriched.latitude).toBeNull();
    expect(enriched.longitude).toBeNull();
  });

  it("resolves references across many tours in one batched pass", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const tours = [
      tourWithRef("A", "LOC-a"),
      tourWithRef("B", "LOC-b"),
      tourWithRef("C", "LOC-a"), // shares a ref with A → deduped
    ];

    const enriched = await resolver.attachLocations(tours);

    // One request, two unique references.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toEqual(["LOC-a", "LOC-b"]);
    expect(enriched[0].latitude).toBe(enriched[2].latitude); // same resolved ref
    expect(enriched[1].location_ref).toBe("LOC-b");
  });

  it("does not mutate the input DTOs", async () => {
    const { fetchImpl } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const tour = tourWithRef("A", "LOC-a");
    const snapshot = JSON.stringify(tour);

    await resolver.attachLocations([tour]);

    expect(JSON.stringify(tour)).toBe(snapshot);
  });
});

describe("LocationResolver — against the real recorded /locations/bulk payload", () => {
  // A verbatim production response (Viator, 2026-07-24): one TRIPADVISOR
  // location that carries real coordinates, and one GOOGLE location that carries
  // only a providerReference (Google Place ID) and NO center. This is the shape
  // reality returns — proven by a live call, not the docs.
  const realResponse = readFileSync(
    join(__dirname, "__fixtures__", "viator-locations-bulk.json"),
    "utf8",
  );
  const TRIPADVISOR_REF = "LOC-6eKJ+or5y8o99Qw0C8xWyMHzSYSyYSMn5ptFi+dSfPo=";
  const GOOGLE_REF =
    "LOC-o0AXGEKPN4wJ9sIG0RAn5FDU2yNvK2GN0H/H4Yo4vgdufEilvC2zBg6045n2CAQq";

  function realFetch(): jest.Mock<FetchLike> {
    return jest.fn<FetchLike>(() =>
      Promise.resolve(new Response(realResponse, { status: 200 })),
    );
  }

  it("resolves a TRIPADVISOR location to its real coordinates", async () => {
    const { resolver } = makeResolver(realFetch());

    const resolved = await resolver.resolve([TRIPADVISOR_REF, GOOGLE_REF]);

    // The field names the code assumes (center.latitude/longitude) are the ones
    // the live API actually returns.
    expect(resolved.get(TRIPADVISOR_REF)).toEqual({
      reference: TRIPADVISOR_REF,
      latitude: 21.036959,
      longitude: 105.8509,
      name: "La Aurora Hang Hanh",
    });
  });

  it("leaves a GOOGLE location (no center, only a Place ID) unresolved", async () => {
    const { resolver } = makeResolver(realFetch());

    const resolved = await resolver.resolve([TRIPADVISOR_REF, GOOGLE_REF]);

    // GOOGLE-provider locations have no coordinates in the Viator response, so
    // they are dropped rather than crashing the batch — the tour keeps null lat/lng.
    expect(resolved.has(GOOGLE_REF)).toBe(false);
    expect(resolved.size).toBe(1);
  });
});

describe("LocationResolver — SSRF enforcement", () => {
  it("routes through the host allowlist (rejects a non-allowlisted base)", async () => {
    const { fetchImpl } = bulkFetch();
    const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
    const resolver = new LocationResolver(
      { ...CONFIG, baseUrl: "https://evil.example.com/partner" },
      http,
      new FakeCache(),
    );

    await expect(resolver.resolve(["LOC-a"])).rejects.toThrow(
      /non-allowlisted host/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("LocationResolver — attachLocations with priority-ordered candidates (BRI-218)", () => {
  const FETCHED_AT = "2026-09-27T00:00:00.000Z";
  const loc = (reference: string, latitude: number, longitude: number): ResolvedLocation => ({
    reference,
    latitude,
    longitude,
    name: null,
  });

  /** A Hanoi tour (curated ref 351) whose only start ref is the unresolvable one. */
  function hanoiTour(code: string) {
    return normalizeViatorProduct(
      {
        productCode: code,
        title: `Tour ${code}`,
        destinations: [{ ref: "351", primary: true }],
        logistics: { start: [{ location: { ref: "LOC-start-google" } }] },
      },
      { fetchedAt: FETCHED_AT },
    );
  }

  it("positions a tour from its POI when the start ref does not resolve", async () => {
    const { fetchImpl } = bulkFetch();
    // Cache holds the POI; the start ref is absent, and the fake API is asked for
    // it but this stub returns a center for everything — so seed both and make the
    // start ref's coordinates obviously distinct.
    const cache = new FakeCache().seed(
      loc("LOC-poi", 21.03, 105.85),
      loc("LOC-start-google", 0, 0),
    );
    const { resolver } = makeResolver(fetchImpl, cache);
    const tour = hanoiTour("H1");

    const [out] = await resolver.attachLocations([tour], new Map([
      ["H1", [
        { source: "poi" as const, ref: "LOC-poi" },
        { source: "start" as const, ref: "LOC-start-google" },
      ]],
    ]));

    expect([out.latitude, out.longitude]).toEqual([21.03, 105.85]);
    // The hashed location_ref is untouched, so source_hash is unaffected.
    expect(out.location_ref).toBe("LOC-start-google");
    expect(out.source_hash).toBe(tour.source_hash);
  });

  it("skips a POI outside the 40 km radius and falls to the next source", async () => {
    const { fetchImpl } = bulkFetch();
    const cache = new FakeCache().seed(
      loc("LOC-far", 20.95, 107.08),
      loc("LOC-hotel", 21.04, 105.86),
    );
    const { resolver } = makeResolver(fetchImpl, cache);

    const [out] = await resolver.attachLocations([hanoiTour("H2")], new Map([
      ["H2", [
        { source: "poi" as const, ref: "LOC-far" },
        { source: "pickup" as const, ref: "LOC-hotel" },
      ]],
    ]));

    expect([out.latitude, out.longitude]).toEqual([21.04, 105.86]);
  });

  it("leaves coordinates null when no candidate is usable (the linker then falls back)", async () => {
    const { fetchImpl } = bulkFetch();
    const cache = new FakeCache().seed(loc("LOC-far", 20.95, 107.08));
    const { resolver } = makeResolver(fetchImpl, cache);

    const [out] = await resolver.attachLocations([hanoiTour("H3")], new Map([
      ["H3", [{ source: "poi" as const, ref: "LOC-far" }]],
    ]));

    expect(out.latitude).toBeNull();
    expect(out.longitude).toBeNull();
  });

  it("resolves every page's candidate refs in one deduped pass", async () => {
    const { fetchImpl, bodies } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    await resolver.attachLocations([hanoiTour("A"), hanoiTour("B")], new Map([
      ["A", [{ source: "poi" as const, ref: "LOC-1" }, { source: "pickup" as const, ref: "LOC-2" }]],
      ["B", [{ source: "poi" as const, ref: "LOC-1" }]],
    ]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toEqual(["LOC-1", "LOC-2"]);
  });

  it("still uses location_ref alone for a tour absent from the candidates map", async () => {
    const { fetchImpl } = bulkFetch();
    const { resolver } = makeResolver(fetchImpl);

    const [out] = await resolver.attachLocations([hanoiTour("H4")], new Map());

    // bulkFetch echoes a center for LOC-start-google.
    expect(out.latitude).toBe(10);
  });
});
