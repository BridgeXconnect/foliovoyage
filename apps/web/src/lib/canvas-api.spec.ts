import { describe, expect, it, jest } from "@jest/globals";

import { fetchCanvasSummaries, proxyCanvasBucket } from "./canvas-api";

const BASE = "http://api.test";
const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

const summary = {
  citySlug: "bangkok",
  countrySlug: "thailand",
  cityName: "Bangkok",
  categorySlug: "food-drink",
  categoryLabel: "Food & Drink",
  total: 210,
  image: { url: "https://img.test/1.jpg", width: 640, height: 427 },
};

describe("proxyCanvasBucket", () => {
  it("passes the status, body, content type and cache header through", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": CACHE, "x-other": "1" },
        }),
    );
    const res = await proxyCanvasBucket("bangkok", "food-drink", BASE, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/v1/canvas/buckets/bangkok/food-drink`, { cache: "no-store" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(res.headers.get("cache-control")).toBe(CACHE);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-other")).toBeNull();
  });

  it("passes an api 404 through without adding a cache header", async () => {
    const fetchImpl = jest.fn(
      async () => new Response('{"status":404}', { status: 404, headers: { "content-type": "application/problem+json" } }),
    );
    const res = await proxyCanvasBucket("bangkok", "seasonal-events", BASE, fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("answers 404 for a slug outside the canvas without calling the api", async () => {
    const fetchImpl = jest.fn();
    const res = await proxyCanvasBucket("paris", "food-drink", BASE, fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await proxyCanvasBucket("bangkok", "transport", BASE, fetchImpl as unknown as typeof fetch)).status).toBe(
      404,
    );
  });

  it("answers 502, uncached, when the api cannot be reached", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await proxyCanvasBucket("bangkok", "food-drink", BASE, fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });
});

describe("fetchCanvasSummaries", () => {
  const realFetch = global.fetch;

  it("returns the parsed summaries", async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ buckets: [summary] }))) as unknown as typeof fetch;
    await expect(fetchCanvasSummaries(BASE)).resolves.toEqual([summary]);
    global.fetch = realFetch;
  });

  it("throws on a failed request or a body off the contract", async () => {
    global.fetch = jest.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchCanvasSummaries(BASE)).rejects.toThrow("500");
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ buckets: [{}] }))) as unknown as typeof fetch;
    await expect(fetchCanvasSummaries(BASE)).rejects.toThrow("Unexpected response");
    global.fetch = realFetch;
  });
});
