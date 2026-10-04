import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ExperiencePage } from "@folio/shared";
import { tourGo } from "@/lib/tour-go";

const page = (over: Partial<ExperiencePage> = {}): ExperiencePage => ({
  experienceId: "cmtodmrst0hdlqu18h454evr4",
  tourId: "tour_db_id",
  title: "Bangkok Canal Tour",
  image: null,
  durationMin: null,
  price: null,
  cancellationDescription: null,
  summary: null,
  affiliateUrl: "https://www.viator.com/tours/Bangkok/Canal/d343-1P5?pid=P1&mcid=42383&medium=api",
  city: { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" },
  ...over,
});

const req = () =>
  new Request("http://localhost/go/tours/x", {
    headers: { "user-agent": "jest", referer: "http://localhost/tours/x", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
const asFetch = (fn: unknown) => fn as typeof fetch;

let errors: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  errors = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("tourGo", () => {
  it("logs the click with the database tour id, then 302s with campaign, no-store and noindex", async () => {
    const post = jest.fn(async () => new Response(null, { status: 201 }));
    const after = jest.fn();
    const res = await tourGo(req(), "e1", { fetchPage: async () => page(), fetchImpl: asFetch(post), after });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://www.viator.com/tours/Bangkok/Canal/d343-1P5?pid=P1&mcid=42383&medium=api&campaign=canvas-tour",
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/affiliate-clicks$/);
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      tourId: "tour_db_id",
      providerId: "viator",
      referrer: "http://localhost/tours/x",
      userAgent: "jest",
      ip: "1.2.3.4",
    });
    expect(after).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("returns 404 and logs nothing for an unknown or malformed id", async () => {
    const post = jest.fn();
    const res = await tourGo(req(), "nope", { fetchPage: async () => null, fetchImpl: asFetch(post), after: jest.fn() });
    expect(res.status).toBe(404);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a non Viator host", "https://evilviator.com/tours/x"],
    ["http", "http://www.viator.com/tours/x"],
  ])("falls back to the Viator destination page for %s and logs viator-search-fallback", async (_n, affiliateUrl) => {
    const post = jest.fn(async () => new Response(null, { status: 201 }));
    const res = await tourGo(req(), "e1", {
      fetchPage: async () => page({ affiliateUrl }),
      fetchImpl: asFetch(post),
      after: jest.fn(),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(new URL(location).hostname).toBe("www.viator.com");
    expect(location).toContain("campaign=affiliate-fallback");
    expect(JSON.parse((post.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).providerId).toBe(
      "viator-search-fallback",
    );
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("fallback"));
  });

  it("falls back to the account root for a city the static registry does not know", async () => {
    const res = await tourGo(req(), "e1", {
      fetchPage: async () => page({ affiliateUrl: null, city: { slug: "atlantis", countrySlug: "sea", name: "Atlantis" } }),
      fetchImpl: asFetch(async () => new Response(null, { status: 201 })),
      after: jest.fn(),
    });
    const url = new URL(res.headers.get("Location")!);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("still redirects when the POST hangs, sends exactly one POST, and lets it finish through after()", async () => {
    let release!: (r: Response) => void;
    const hung = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const post = jest.fn(() => hung);
    const afterTasks: Promise<unknown>[] = [];
    const after = jest.fn((task: Promise<unknown>) => void afterTasks.push(task));

    const res = await tourGo(req(), "e1", {
      fetchPage: async () => page(),
      fetchImpl: asFetch(post),
      after,
      timeoutMs: 20,
    });

    expect(res.status).toBe(302);
    expect(post).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("event=tour_click_log_slow"));

    // The request was never aborted: it is still pending, and completes afterwards.
    let settled = false;
    void afterTasks[0].then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    release(new Response(null, { status: 201 }));
    await afterTasks[0];
    expect(settled).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("never shows the visitor an error when the POST fails", async () => {
    const res = await tourGo(req(), "e1", {
      fetchPage: async () => page(),
      fetchImpl: asFetch(async () => {
        throw new Error("api down");
      }),
      after: jest.fn(),
    });
    expect(res.status).toBe(302);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("click log failed"), expect.any(Error));

    const non2xx = await tourGo(req(), "e1", {
      fetchPage: async () => page(),
      fetchImpl: asFetch(async () => new Response(null, { status: 401 })),
      after: jest.fn(),
    });
    expect(non2xx.status).toBe(302);
  });
});
