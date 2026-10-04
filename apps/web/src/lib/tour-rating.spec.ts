import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { proxyTourRating } from "@/lib/tour-rating";
import { GET } from "@/app/protected/tours/[experienceId]/rating.json/route";

const ID = "cmtodmrst0hdlqu18h454evr4";
const CACHED = "public, s-maxage=900, stale-while-revalidate=86400";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const asFetch = (fn: unknown) => fn as typeof fetch;

let errors: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  errors = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("proxyTourRating", () => {
  it("returns exactly {ratingAvg, ratingCount} with the cache and robots headers", async () => {
    // An extra key from the api must not pass through.
    const fetchImpl = jest.fn<typeof fetch>(async () => json({ ratingAvg: 4.7, ratingCount: 6756, extra: "x" }));
    const res = await proxyTourRating(ID, "http://api", asFetch(fetchImpl));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ratingAvg: 4.7, ratingCount: 6756 });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe(CACHED);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(fetchImpl).toHaveBeenCalledWith(`http://api/v1/experiences/${ID}/rating`, { next: { revalidate: 900 } });
  });

  it("passes nulls through", async () => {
    const res = await proxyTourRating(ID, "http://api", asFetch(async () => json({ ratingAvg: null, ratingCount: null })));
    expect(await res.json()).toEqual({ ratingAvg: null, ratingCount: null });
  });

  it.each(["", "abc", "../etc/passwd", "C" + "a".repeat(24), "cshort", "c" + "a".repeat(40)])(
    "404s a malformed id (%p) without calling the api, uncached",
    async (bad) => {
      const fetchImpl = jest.fn();
      const res = await proxyTourRating(bad, "http://api", asFetch(fetchImpl));
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("404s when the api 404s, cached like the api's own answer", async () => {
    const res = await proxyTourRating(ID, "http://api", asFetch(async () => json({ status: 404 }, 404)));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe(CACHED);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("answers 502, never cached, on an api 5xx", async () => {
    const res = await proxyTourRating(ID, "http://api", asFetch(async () => json({}, 503)));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("answers 502, never cached, on a network error", async () => {
    const res = await proxyTourRating(ID, "http://api", asFetch(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502, never cached, when the body breaks the shared contract", async () => {
    const res = await proxyTourRating(ID, "http://api", asFetch(async () => json({ ratingAvg: "4.7", ratingCount: 1 })));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("encodes the id in the api url", async () => {
    // Passes the cuid check only if the id is clean, so this pins encodeURIComponent on a clean id.
    const fetchImpl = jest.fn(async () => json({ ratingAvg: 1, ratingCount: 1 }));
    await proxyTourRating(ID, "http://api", asFetch(fetchImpl));
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(`http://api/v1/experiences/${encodeURIComponent(ID)}/rating`);
  });
});

describe("rating.json route", () => {
  it("reads the id from params and proxies it", async () => {
    const fetchMock = jest.fn(async () => json({ ratingAvg: 4.2, ratingCount: 10 }));
    global.fetch = asFetch(fetchMock);
    const res = await GET(new Request("http://x/protected/tours/x/rating.json"), {
      params: Promise.resolve({ experienceId: ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ratingAvg: 4.2, ratingCount: 10 });
  });
});
