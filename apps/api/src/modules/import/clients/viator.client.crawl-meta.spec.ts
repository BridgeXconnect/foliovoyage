import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "../http/allowlist-fetch";
import type { RawArchiveStore } from "../storage/raw-archive.store";
import { ViatorClient } from "./viator.client";

/** BRI-227: the per-page facts the crawl log needs (cursor sent, status, attempts). */
describe("ViatorClient — page metadata for the crawl log (BRI-227)", () => {
  const archive: RawArchiveStore = {
    putRawPage: async (ref) => ({ bucket: "b", key: `raw/${ref.source}/${ref.date}/${ref.page}.json` }),
  };

  function clientFor(responses: Array<{ status: number; body?: string }>) {
    let i = 0;
    const fetchImpl = jest.fn<FetchLike>(() => {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return Promise.resolve(new Response(r.body ?? "{}", { status: r.status }));
    });
    return new ViatorClient(
      { baseUrl: "https://api.viator.com/partner", apiKey: "k", language: "en-US" },
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      archive,
      { baseDelayMs: 1, maxDelayMs: 1, maxRetries: 5 },
      jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
      () => 0.5,
    );
  }

  it("reports the cursor each request carried, the status and one attempt when nothing retried", async () => {
    const client = clientFor([
      { status: 200, body: JSON.stringify({ products: [], nextCursor: "C2" }) },
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const pages = [];
    for await (const p of client.fetchModifiedSince({ date: "2026-10-09" })) pages.push(p);

    expect(pages.map((p) => p.cursorSent)).toEqual([undefined, "C2"]);
    expect(pages.map((p) => p.status)).toEqual([200, 200]);
    expect(pages.map((p) => p.attempts)).toEqual([1, 1]);
  });

  it("counts the retries the backoff helper made for a page", async () => {
    const client = clientFor([
      { status: 429 },
      { status: 503 },
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const pages = [];
    for await (const p of client.fetchModifiedSince({ date: "2026-10-09" })) pages.push(p);

    expect(pages[0].attempts).toBe(3);
    expect(pages[0].status).toBe(200);
  });
});
