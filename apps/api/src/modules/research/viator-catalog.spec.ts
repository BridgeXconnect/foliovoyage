import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { ViatorCatalog, ViatorCatalogError } from "./viator-catalog";

const KEY = "viator-key-abc123";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ViatorCatalog", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "viator-catalog-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const make = (fetchImpl: typeof fetch) =>
    new ViatorCatalog({
      dataDir: dir,
      apiKey: KEY,
      baseUrl: "https://api.viator.com/partner",
      language: "en-US",
      fetchImpl,
    });

  describe("tagNames", () => {
    const tagsBody = {
      tags: [
        { tagId: 11, allNamesByLocale: { en: "Food Tours", de: "Kulinarische Touren" } },
        { tagId: 12, allNamesByLocale: { fr: "Excursions" } },
        { tagId: 13, allNamesByLocale: { en: "  " } },
        { allNamesByLocale: { en: "No id" } },
      ],
    };

    it("maps tag ids to English names, falls back to the first locale, and skips unusable rows", async () => {
      const fetchMock = jest.fn(async () => json(tagsBody));
      const names = await make(fetchMock as unknown as typeof fetch).tagNames();
      expect([...names]).toEqual([
        [11, "Food Tours"],
        [12, "Excursions"],
      ]);
    });

    it("sends the key, version and language headers to the tags endpoint", async () => {
      const fetchMock = jest.fn<(u: unknown, i?: unknown) => Promise<Response>>(async () => json(tagsBody));
      await make(fetchMock as unknown as typeof fetch).tagNames();
      const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
      expect(String(url)).toBe("https://api.viator.com/partner/products/tags");
      expect(init.method).toBe("GET");
      expect(init.headers).toMatchObject({
        "exp-api-key": KEY,
        Accept: "application/json;version=2.0",
        "Accept-Language": "en-US",
      });
    });

    it("caches the raw reply on disk and makes no second call", async () => {
      const fetchMock = jest.fn(async () => json(tagsBody));
      await make(fetchMock as unknown as typeof fetch).tagNames();
      await make(fetchMock as unknown as typeof fetch).tagNames();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(dir, "viator", "tags.json"))).toBe(true);
    });

    it("fails when the reply holds no names, and does not cache that reply as good", async () => {
      const fetchMock = jest.fn(async () => json({ tags: [] }));
      await expect(make(fetchMock as unknown as typeof fetch).tagNames()).rejects.toThrow(ViatorCatalogError);
    });
  });

  describe("attractions", () => {
    it("pages until a short page and reads name, product count and rating", async () => {
      const page = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          name: `Place ${i}`,
          productCount: 10 + i,
          reviews: { combinedAverageRating: 4.5 },
        }));
      const fetchMock = jest
        .fn<(u: unknown, i?: unknown) => Promise<Response>>()
        .mockResolvedValueOnce(json({ attractions: page(30), totalCount: 35 }))
        .mockResolvedValueOnce(json({ attractions: page(5), totalCount: 35 }));
      const result = await make(fetchMock as unknown as typeof fetch).attractions("343");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(35);
      expect(result[0]).toEqual({ name: "Place 0", productCount: 10, ratingAvg: 4.5 });
      const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
      expect(bodies[0]).toEqual({ destinationId: 343, sorting: { sort: "DEFAULT" }, pagination: { start: 1, count: 30 } });
      expect(bodies[1]).toEqual({ destinationId: 343, sorting: { sort: "DEFAULT" }, pagination: { start: 31, count: 30 } });
    });

    it("leaves counts out when the reply has none", async () => {
      const fetchMock = jest.fn(async () => json({ attractions: [{ name: "Wat Arun" }], totalCount: 1 }));
      expect(await make(fetchMock as unknown as typeof fetch).attractions("343")).toEqual([{ name: "Wat Arun" }]);
    });

    it("caches per destination", async () => {
      const fetchMock = jest.fn(async () => json({ attractions: [{ name: "Wat Arun" }], totalCount: 1 }));
      await make(fetchMock as unknown as typeof fetch).attractions("343");
      await make(fetchMock as unknown as typeof fetch).attractions("343");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(dir, "viator", "attractions-343.json"))).toBe(true);
    });
  });

  describe("errors", () => {
    it("shows the status and a short reply, and never the key", async () => {
      const fetchMock = jest.fn(async () => new Response(`bad key ${KEY} rejected`, { status: 401 }));
      const error = await make(fetchMock as unknown as typeof fetch)
        .tagNames()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ViatorCatalogError);
      const message = (error as Error).message;
      expect(message).toContain("HTTP 401");
      expect(message).not.toContain(KEY);
    });

    it("does not cache a failed call", async () => {
      const fetchMock = jest.fn(async () => new Response("nope", { status: 500 }));
      await make(fetchMock as unknown as typeof fetch).tagNames().catch(() => undefined);
      expect(fs.existsSync(path.join(dir, "viator", "tags.json"))).toBe(false);
    });

    it("only talks to the Viator host", async () => {
      const fetchMock = jest.fn(async () => json({}));
      const catalog = new ViatorCatalog({
        dataDir: dir,
        apiKey: KEY,
        baseUrl: "https://api.viator.com/partner",
        language: "en-US",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await catalog.tagNames().catch(() => undefined);
      for (const call of fetchMock.mock.calls as unknown as Array<[URL | string]>) {
        expect(new URL(String(call[0])).host).toBe("api.viator.com");
      }
    });
  });
});
