import { describe, expect, it, jest } from "@jest/globals";
import { createBucketStore } from "./bucket-store";

const tile = {
  id: "exp_1",
  tourId: "tour_1",
  rank: 1,
  title: "Floating market",
  image: { url: "https://img.test/1.jpg", width: 640, height: 427 },
  durationMin: 240,
  price: { amountMinor: 3500, currency: "USD" },
  ratingAvg: 4.7,
  ratingCount: 120,
};
const bucket = {
  citySlug: "bangkok",
  countrySlug: "thailand",
  cityName: "Bangkok",
  categorySlug: "food-drink",
  categoryLabel: "Food & Drink",
  total: 1,
  image: tile.image,
  tiles: [tile],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bucket store", () => {
  it("fetches a bucket through the proxy route once, and caches it", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response(JSON.stringify(bucket)));
    const store = createBucketStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const changes = jest.fn();
    store.subscribe(changes);

    store.request("bangkok", "food-drink");
    expect(store.get("bangkok", "food-drink").status).toBe("loading");
    store.request("bangkok", "food-drink");
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/canvas/buckets/bangkok/food-drink");
    const state = store.get("bangkok", "food-drink");
    expect(state.status === "ready" && state.data.tiles[0].id).toBe("exp_1");
    expect(changes).toHaveBeenCalledTimes(2);

    store.request("bangkok", "food-drink");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed bucket on its placeholder and retries on a later request after the wait", async () => {
    let clock = 0;
    const fetchImpl = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bucket)));
    const store = createBucketStore({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock });

    store.request("bangkok", "food-drink");
    await flush();
    expect(store.get("bangkok", "food-drink").status).toBe("failed");

    clock = 1000;
    store.request("bangkok", "food-drink");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = 3000;
    store.request("bangkok", "food-drink");
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(store.get("bangkok", "food-drink").status).toBe("ready");
  });

  it("treats a body off the contract or a network error as a failure", async () => {
    const fetchImpl = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tiles: [] })))
      .mockRejectedValueOnce(new TypeError("offline"));
    const store = createBucketStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    store.request("bangkok", "food-drink");
    store.request("bangkok", "art-culture");
    await flush();
    expect(store.get("bangkok", "food-drink").status).toBe("failed");
    expect(store.get("bangkok", "art-culture").status).toBe("failed");
  });

  it("never refetches a bucket the api reports as empty", async () => {
    const fetchImpl = jest.fn(async () => new Response("", { status: 404 }));
    const store = createBucketStore({ fetchImpl: fetchImpl as unknown as typeof fetch, retryMs: 0 });
    store.request("bangkok", "seasonal-events");
    await flush();
    store.request("bangkok", "seasonal-events");
    expect(store.get("bangkok", "seasonal-events").status).toBe("empty");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
