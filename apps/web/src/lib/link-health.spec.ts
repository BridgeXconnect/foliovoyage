import { describe, expect, it, jest } from "@jest/globals";
import { checkLinkHealth } from "@/lib/link-health";

function fakeFetch(
  responder: (
    url: string,
    init?: RequestInit,
  ) => Promise<{ ok: boolean; status: number; headers?: Headers }>,
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const { ok, status, headers = new Headers() } = await responder(url, init);
    return { ok, status, headers } as Response;
  }) as typeof fetch;
}

describe("checkLinkHealth", () => {
  it("reports ok:true for a link that responds 200", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: true, status: 200 },
    ]);
  });

  it("reports ok:false with the status for a 404", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: false, status: 404 }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: false, status: 404 },
    ]);
  });

  it("reports ok:false with an error message on a network failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      {
        key: "bangkok/a",
        url: "https://www.viator.com/tours/a",
        ok: false,
        error: "getaddrinfo ENOTFOUND",
      },
    ]);
  });

  it("retries with GET when HEAD isn't allowed (405)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "HEAD") return { ok: false, status: 405, headers: new Headers() } as Response;
      return { ok: true, status: 200, headers: new Headers() } as Response;
    }) as typeof fetch;
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(calls).toEqual(["HEAD", "GET"]);
    expect(results[0]).toMatchObject({ ok: true, status: 200 });
  });

  it("flags a DataDome challenge as blocked, not a genuine failure", async () => {
    const fetchImpl = fakeFetch(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ server: "DataDome" }),
    }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: false, status: 403, blocked: true },
    ]);
  });

  it("treats a plain 403 (no DataDome header) as a genuine failure", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: false, status: 403 }));
    const results = await checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: false, status: 403 },
    ]);
  });

  it("skips entries with no affiliateUrl", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const results = await checkLinkHealth(
      { "bangkok/unmatched": {}, "bangkok/matched": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe("bangkok/matched");
  });

  it("pings only sampleSize entries when the registry is larger", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200 }));
    const links = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`d/${i}`, { affiliateUrl: `https://www.viator.com/tours/${i}` }]),
    );
    let call = 0;
    const random = () => {
      // Deterministic sequence so the test doesn't depend on Math.random.
      const seq = [0.9, 0.1];
      return seq[call++ % seq.length]!;
    };
    const results = await checkLinkHealth(links, { fetchImpl, sampleSize: 2, random });
    expect(results).toHaveLength(2);
    const keys = new Set(results.map((r) => r.key));
    expect(keys.size).toBe(2);
  });

  it("times out a hung request and reports it as a failure", async () => {
    jest.useFakeTimers();
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as unknown as typeof fetch;

    const promise = checkLinkHealth(
      { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" } },
      { fetchImpl, timeoutMs: 5000 },
    );
    await jest.advanceTimersByTimeAsync(5000);
    const results = await promise;

    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toMatch(/abort/i);
    jest.useRealTimers();
  });
});
