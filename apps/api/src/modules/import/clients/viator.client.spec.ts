import { describe, expect, it, jest } from "@jest/globals";

import { ViatorClient, type Sleep } from "./viator.client";
import {
  AllowlistFetch,
  type FetchLike,
} from "../http/allowlist-fetch";
import type {
  ArchivedPage,
  RawArchiveStore,
  RawPageRef,
} from "../storage/raw-archive.store";

const CONFIG = {
  baseUrl: "https://api.viator.com/partner",
  apiKey: "test-key",
  language: "en-US",
};

/** Records every page it was asked to archive; proves archive-before-yield. */
class FakeArchive implements RawArchiveStore {
  readonly writes: Array<{ ref: RawPageRef; body: string }> = [];

  putRawPage(ref: RawPageRef, body: string): Promise<ArchivedPage> {
    this.writes.push({ ref, body });
    return Promise.resolve({
      bucket: "test-bucket",
      key: `raw/${ref.source}/${ref.date}/${ref.page}.json`,
    });
  }
}

/** A fetch stub that returns a queued list of responses in order. */
function queuedFetch(
  responses: Array<{
    status: number;
    body?: string;
    headers?: Record<string, string>;
  }>,
): {
  fetchImpl: jest.Mock<FetchLike>;
  urls: string[];
  inits: (RequestInit | undefined)[];
} {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let i = 0;
  const fetchImpl = jest.fn<FetchLike>((input, init) => {
    urls.push(input.toString());
    inits.push(init);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(
      new Response(r.body ?? "{}", { status: r.status, headers: r.headers }),
    );
  });
  return { fetchImpl, urls, inits };
}

function makeClient(
  fetchImpl: jest.Mock<FetchLike>,
  opts: {
    archive?: FakeArchive;
    sleep?: Sleep;
    random?: () => number;
    backoff?: ConstructorParameters<typeof ViatorClient>[3];
  } = {},
): { client: ViatorClient; archive: FakeArchive; sleep: jest.Mock<Sleep> } {
  const archive = opts.archive ?? new FakeArchive();
  const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
  const sleep = (opts.sleep as jest.Mock<Sleep>) ?? jest.fn<Sleep>().mockResolvedValue(undefined);
  const client = new ViatorClient(
    CONFIG,
    http,
    archive,
    opts.backoff ?? { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries: 5 },
    sleep,
    opts.random ?? (() => 0.5),
  );
  return { client, archive, sleep };
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("ViatorClient — pagination", () => {
  it("walks the cursor to completion, yielding each page in order", async () => {
    const { fetchImpl, urls } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [{ productCode: "A" }], nextCursor: "CUR2" }) },
      { status: 200, body: JSON.stringify({ products: [{ productCode: "B" }] }) },
    ]);
    const { client, archive } = makeClient(fetchImpl);

    const pages = (await drain(
      client.fetchModifiedSince({ date: "2026-07-24", count: 500 }),
    )) as Array<{ page: number; products: unknown[]; nextCursor?: string }>;

    expect(pages).toHaveLength(2);
    expect(pages[0].products).toEqual([{ productCode: "A" }]);
    expect(pages[0].nextCursor).toBe("CUR2");
    expect(pages[1].products).toEqual([{ productCode: "B" }]);
    expect(pages[1].nextCursor).toBeUndefined();

    // Page 1 has no cursor; page 2 pages with the returned cursor.
    expect(urls[0]).toContain("count=500");
    expect(urls[0]).not.toContain("cursor=");
    expect(urls[1]).toContain("cursor=CUR2");

    // Every page archived to raw/viator/{date}/{page}.json.
    expect(archive.writes.map((w) => w.ref.page)).toEqual([1, 2]);
    expect(archive.writes[0].ref).toEqual({
      source: "viator",
      date: "2026-07-24",
      page: 1,
    });
  });

  it("archives the raw body verbatim before yielding (replay safety net)", async () => {
    const rawPage1 = JSON.stringify({ products: [{ productCode: "A" }], nextCursor: "C2" });
    const rawPage2 = JSON.stringify({ products: [{ productCode: "B" }] });
    const { fetchImpl } = queuedFetch([
      { status: 200, body: rawPage1 },
      { status: 200, body: rawPage2 },
    ]);
    const { client, archive } = makeClient(fetchImpl);

    await drain(client.fetchModifiedSince({ date: "2026-07-24" }));

    expect(archive.writes.map((w) => w.body)).toEqual([rawPage1, rawPage2]);
  });

  it("sends modified-since only on the first request", async () => {
    const { fetchImpl, urls } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [], nextCursor: "C2" }) },
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const { client } = makeClient(fetchImpl);

    await drain(
      client.fetchModifiedSince({ modifiedSince: "2026-07-01T00:00:00Z" }),
    );

    expect(urls[0]).toContain("modified-since=2026-07-01");
    // The endpoint path is /products/modified-since, so assert on the *query*
    // param specifically — the second page must not re-send modified-since=.
    expect(urls[1]).not.toContain("modified-since=");
    expect(urls[1]).toContain("cursor=C2");
  });

  it("BRI-176: resumes from startCursor without ever sending modified-since, even if supplied", async () => {
    const { fetchImpl, urls } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const { client } = makeClient(fetchImpl);

    await drain(
      client.fetchModifiedSince({
        modifiedSince: "2026-07-01T00:00:00Z",
        startCursor: "RESUME_CUR",
      }),
    );

    expect(urls[0]).toContain("cursor=RESUME_CUR");
    expect(urls[0]).not.toContain("modified-since=");
  });

  it("BRI-176: startPage continues page numbering instead of restarting at 1", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [{ productCode: "A" }] }) },
    ]);
    const { client, archive } = makeClient(fetchImpl);

    const pages = (await drain(
      client.fetchModifiedSince({ startPage: 10, date: "2026-07-24" }),
    )) as Array<{ page: number }>;

    expect(pages[0].page).toBe(11);
    // Archive key must continue too, or a restart would overwrite an earlier
    // segment's archived page (BRI-176).
    expect(archive.writes[0].ref.page).toBe(11);
  });

  it("sends v2 auth and content-negotiation headers", async () => {
    const { fetchImpl, inits } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const { client } = makeClient(fetchImpl);

    await drain(client.fetchModifiedSince());

    const headers = inits[0]?.headers as Record<string, string>;
    expect(headers["exp-api-key"]).toBe("test-key");
    expect(headers["Accept"]).toBe("application/json;version=2.0");
    expect(headers["Accept-Language"]).toBe("en-US");
  });
});

describe("ViatorClient — 429 backoff", () => {
  it("backs off and retries on a 429, then succeeds", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 429 },
      { status: 200, body: JSON.stringify({ products: [{ productCode: "A" }] }) },
    ]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    // random() = 0 → full-jitter delay is 0..ceiling; use 0.5 for a midpoint.
    const { client, archive } = makeClient(fetchImpl, {
      sleep,
      random: () => 0.5,
      backoff: { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries: 5 },
    });

    const pages = (await drain(client.fetchModifiedSince())) as unknown[];

    // One retry happened: two fetches, one sleep, and the page still came back.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    // Full-jitter on attempt 0: floor(0.5 * base*2^0) = floor(0.5 * 100) = 50.
    expect(sleep).toHaveBeenCalledWith(50);
    expect(pages).toHaveLength(1);
    // The successful page was archived; the 429 was not.
    expect(archive.writes).toHaveLength(1);
  });

  it("grows the delay exponentially across successive 429s", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, {
      sleep,
      random: () => 1, // push each delay to its ceiling (minus 1ms via floor)
      backoff: { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries: 5 },
    });

    await drain(client.fetchModifiedSince());

    // Ceilings 100, 200, 400 for attempts 0,1,2; floor(1*x) - but random()=1
    // yields floor(1*ceiling) which JS floors to ceiling exactly.
    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays).toEqual([100, 200, 400]);
  });

  it("honours a Retry-After header as the delay floor", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 429, headers: { "retry-after": "2" } },
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, { sleep });

    await drain(client.fetchModifiedSince());

    // Retry-After: 2 seconds → 2000ms, overriding the jittered exponential.
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after maxRetries consecutive 429s", async () => {
    const { fetchImpl } = queuedFetch([{ status: 429 }]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, {
      sleep,
      backoff: { baseDelayMs: 10, maxDelayMs: 100, maxRetries: 3 },
    });

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(
      /after 3 attempts/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Slept between attempts, but not after the final failed attempt.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status (e.g. 401)", async () => {
    const { fetchImpl } = queuedFetch([{ status: 401, body: "unauthorized" }]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, { sleep });

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("ViatorClient — network/timeout error retry (BRI-171)", () => {
  it("retries a thrown network error (e.g. a request timeout) the same as a 5xx", async () => {
    let calls = 0;
    const fetchImpl = jest.fn<FetchLike>(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ products: [{ productCode: "A" }] }), { status: 200 }),
      );
    });
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client, archive } = makeClient(fetchImpl, { sleep });

    const pages = (await drain(client.fetchModifiedSince())) as unknown[];

    // One thrown error, one retry, then success — same shape as the 429 case.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(1);
    // The successful page was archived; the failed attempt produced nothing to archive.
    expect(archive.writes).toHaveLength(1);
  });

  it("gives up after maxRetries consecutive thrown errors, with a clear message", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.reject(new Error("network is down")),
    );
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, {
      sleep,
      backoff: { baseDelayMs: 10, maxDelayMs: 100, maxRetries: 3 },
    });

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(
      /after 3 attempts.*network is down/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("also retries a real network-level failure distinct from a timeout (e.g. TLS handshake)", async () => {
    // Mirrors the historical failure mode (2026-07-26 EPROTO/SSL handshake
    // error) that this same fix now also covers.
    let calls = 0;
    const fetchImpl = jest.fn<FetchLike>(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("write EPROTO … ssl3_read_bytes:sslv3 alert handshake failure"));
      }
      return Promise.resolve(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    });
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, { sleep });

    const pages = (await drain(client.fetchModifiedSince())) as unknown[];

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(pages).toHaveLength(1);
  });

  it("retries a body-read failure on an otherwise-ok response the same as a failed fetch (BRI-182)", async () => {
    // A response whose connection succeeded (status 200) but whose body read
    // fails partway through — the gap this test guards was that
    // `response.text()` sat outside fetchPageWithBackoff's try/catch, so this
    // threw uncaught instead of retrying.
    let calls = 0;
    const fetchImpl = jest.fn<FetchLike>(() => {
      calls += 1;
      if (calls === 1) {
        const response = new Response(
          JSON.stringify({ products: [{ productCode: "A" }] }),
          { status: 200 },
        );
        (response as { text: () => Promise<string> }).text = () =>
          Promise.reject(new Error("body read timed out"));
        return Promise.resolve(response);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ products: [{ productCode: "A" }] }), {
          status: 200,
        }),
      );
    });
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client, archive } = makeClient(fetchImpl, { sleep });

    const pages = (await drain(client.fetchModifiedSince())) as unknown[];

    // One failed body read, one retry, then success — same shape as a thrown
    // fetch error.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(1);
    expect(archive.writes).toHaveLength(1);
  });

  it("gives up after maxRetries consecutive body-read failures, with a clear message", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => {
      const response = new Response(JSON.stringify({ products: [] }), {
        status: 200,
      });
      (response as { text: () => Promise<string> }).text = () =>
        Promise.reject(new Error("body read timed out"));
      return Promise.resolve(response);
    });
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const { client } = makeClient(fetchImpl, {
      sleep,
      backoff: { baseDelayMs: 10, maxDelayMs: 100, maxRetries: 3 },
    });

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(
      /after 3 attempts.*body read timed out/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry HostNotAllowedError — a config error, not a transient one", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
    const client = new ViatorClient(
      { ...CONFIG, baseUrl: "https://evil.example.com/partner" },
      http,
      new FakeArchive(),
      { baseDelayMs: 10, maxDelayMs: 100, maxRetries: 5 },
      sleep,
    );

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(
      /non-allowlisted host/,
    );
    // One attempt, no sleep — a wrong host doesn't change on retry.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("ViatorClient — SSRF enforcement", () => {
  it("cannot be pointed at a non-allowlisted host", async () => {
    const { fetchImpl } = queuedFetch([
      { status: 200, body: JSON.stringify({ products: [] }) },
    ]);
    // Client configured for a host the allowlist does not permit.
    const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
    const client = new ViatorClient(
      { ...CONFIG, baseUrl: "https://evil.example.com/partner" },
      http,
      new FakeArchive(),
      {},
      jest.fn<Sleep>().mockResolvedValue(undefined),
    );

    await expect(drain(client.fetchModifiedSince())).rejects.toThrow(
      /non-allowlisted host/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
