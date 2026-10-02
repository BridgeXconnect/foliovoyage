import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "./http/allowlist-fetch";
import type { Sleep } from "./http/fetch-with-backoff";
import {
  parseTagsResponse,
  TagResolver,
  toTagGraph,
  type CachedTag,
  type TagResolverConfig,
  type TagVocabularyCache,
} from "./tag-resolver";

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "__fixtures__", "viator-tags.json"),
    "utf8",
  ),
);

const CONFIG: TagResolverConfig = {
  baseUrl: "https://api.viator.com/partner",
  apiKey: "test-key",
  language: "en-US",
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** In-memory {@link TagVocabularyCache}. */
function memCache(seed: CachedTag[] = [], seedFetchedAt: Date | null = null) {
  let rows = seed;
  let fetchedAt = seedFetchedAt;
  return {
    loadAll: () => Promise.resolve(rows),
    lastRefreshedAt: () => Promise.resolve(fetchedAt),
    replaceAll: (newRows: CachedTag[], at: Date) => {
      rows = newRows;
      fetchedAt = at;
      return Promise.resolve();
    },
  } satisfies TagVocabularyCache;
}

function makeResolver(fetchImpl: FetchLike, cache: TagVocabularyCache): TagResolver {
  const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
  return new TagResolver(CONFIG, http, cache, {}, () => Promise.resolve());
}

describe("parseTagsResponse", () => {
  it("parses tagId, English name, and parentTagIds from the fixture", () => {
    const rows = parseTagsResponse(FIXTURE);
    const museums = rows.find((r) => r.tagId === 100);
    expect(museums).toEqual({ tagId: 100, name: "Museums", parentTagIds: [21910] });
  });

  it("keeps a multi-parent tag's every parent", () => {
    const rows = parseTagsResponse(FIXTURE);
    const foodTours = rows.find((r) => r.tagId === 300);
    expect(foodTours?.parentTagIds).toEqual([21911, 21913]);
  });

  it("defaults parentTagIds to [] for a parentless (root/flag) tag", () => {
    const rows = parseTagsResponse(FIXTURE);
    expect(rows.find((r) => r.tagId === 12518)).toEqual({
      tagId: 12518,
      name: "Attractions",
      parentTagIds: [],
    });
    expect(rows.find((r) => r.tagId === 999)).toEqual({
      tagId: 999,
      name: "Zombie",
      parentTagIds: [],
    });
  });

  it("falls back to the first available locale when `en` is absent", () => {
    const rows = parseTagsResponse(FIXTURE);
    expect(rows.find((r) => r.tagId === 700)?.name).toBe("Visites guidées");
  });

  it("carries a mutual-parent cycle through unchanged (the cycle guard lives in category-rule)", () => {
    const rows = parseTagsResponse(FIXTURE);
    expect(rows.find((r) => r.tagId === 500)?.parentTagIds).toEqual([501]);
    expect(rows.find((r) => r.tagId === 501)?.parentTagIds).toEqual([500]);
  });

  it("returns [] for a shape with no tags array", () => {
    expect(parseTagsResponse({ notTags: [] })).toEqual([]);
  });
});

describe("toTagGraph", () => {
  it("builds a tagId → parentTagIds map usable by category-rule", () => {
    const graph = toTagGraph(parseTagsResponse(FIXTURE));
    expect(graph.get(100)).toEqual([21910]);
    expect(graph.get(300)).toEqual([21911, 21913]);
  });
});

describe("TagResolver — staleness", () => {
  it("fetches and replaces when the cache has never been refreshed", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => Promise.resolve(okJson(FIXTURE)));
    const cache = memCache([], null);
    const resolver = makeResolver(fetchImpl, cache);

    const vocab = await resolver.getVocabulary();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vocab.graph.get(100)).toEqual([21910]);
    expect(vocab.names.get(100)).toBe("Museums");
  });

  it("uses the cached vocabulary without fetching when refreshed recently", async () => {
    const fetchImpl = jest.fn<FetchLike>();
    const cache = memCache(
      [{ tagId: 100, name: "Museums", parentTagIds: [21910] }],
      new Date(),
    );
    const resolver = makeResolver(fetchImpl, cache);

    const vocab = await resolver.getVocabulary();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vocab.graph.get(100)).toEqual([21910]);
  });

  it("re-fetches once the cache is older than 7 days", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => Promise.resolve(okJson(FIXTURE)));
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const cache = memCache(
      [{ tagId: 1, name: "Stale", parentTagIds: [] }],
      eightDaysAgo,
    );
    const resolver = makeResolver(fetchImpl, cache);

    const vocab = await resolver.getVocabulary();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vocab.graph.get(100)).toEqual([21910]);
  });
});

describe("TagResolver — tolerance", () => {
  it("falls back to the existing vocabulary (non-fatal) when a refresh fetch fails but the table has data", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => Promise.reject(new Error("network down")));
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const cache = memCache(
      [{ tagId: 100, name: "Museums", parentTagIds: [21910] }],
      eightDaysAgo,
    );
    const resolver = makeResolver(fetchImpl, cache);

    const vocab = await resolver.getVocabulary();

    expect(vocab.graph.get(100)).toEqual([21910]);
  });

  it("returns an empty vocabulary (never throws) when the refresh fails and the table is empty", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => Promise.reject(new Error("network down")));
    const cache = memCache([], null);
    const resolver = makeResolver(fetchImpl, cache);

    const vocab = await resolver.getVocabulary();

    expect(vocab.graph.size).toBe(0);
  });

  it("never throws on a non-OK response", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("server error", { status: 500 })),
    );
    const cache = memCache([], null);
    const resolver = makeResolver(fetchImpl, cache);

    await expect(resolver.getVocabulary()).resolves.toBeDefined();
  });
});

const timeoutError = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("TagResolver — /products/tags retry (BRI-183)", () => {
  const ok = () => Promise.resolve(okJson(FIXTURE));

  function retrying(fetchImpl: jest.Mock<FetchLike>, cache: TagVocabularyCache, maxRetries = 5) {
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const resolver = new TagResolver(
      CONFIG,
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      cache,
      { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries },
      sleep,
      () => 0.5,
    );
    return { resolver, sleep };
  }

  it("retries a timeout, then refreshes the vocabulary", async () => {
    const fetchImpl = jest
      .fn<FetchLike>()
      .mockRejectedValueOnce(timeoutError())
      .mockImplementation(ok);
    const { resolver, sleep } = retrying(fetchImpl, memCache());

    const vocab = await resolver.getVocabulary();

    expect(vocab.names.get(100)).toBe("Museums");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("does not retry a 403", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("forbidden", { status: 403 })),
    );
    const { resolver, sleep } = retrying(fetchImpl, memCache());

    expect((await resolver.getVocabulary()).names.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("after maxRetries attempts keeps the existing stale vocabulary (fallback preserved)", async () => {
    const stale: CachedTag[] = [{ tagId: 1, name: "Old", parentTagIds: [] }];
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("down", { status: 502 })),
    );
    const { resolver, sleep } = retrying(
      fetchImpl,
      memCache(stale, new Date(0)),
      3,
    );

    const vocab = await resolver.getVocabulary();

    expect(vocab.names.get(1)).toBe("Old");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
