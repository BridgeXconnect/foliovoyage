import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { fetchDestination } from "./api";

const validBody = {
  city: "Bangkok",
  citySlug: "bangkok",
  country: "Thailand",
  countrySlug: "thailand",
  heroImageUrl: "https://example.test/bkk.jpg",
  heroImageAlt: "Bangkok hero",
  experiences: [
    {
      id: "exp_1",
      title: "Wat Pho",
      description: "Temples.",
      imageUrl: "https://img/1.jpg",
      imageAlt: "Wat Pho",
      editorRating: 4.7,
      priceBand: "$$",
      tags: [],
      aiSummary: "A reclining Buddha.",
    },
  ],
  pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
};

function mockFetch(status: number, body?: unknown): void {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("fetchDestination", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns the parsed destination, including aiSummary", async () => {
    mockFetch(200, validBody);
    const result = await fetchDestination("thailand", "bangkok");
    expect(result?.experiences[0].aiSummary).toBe("A reclining Buddha.");
  });

  it("tolerates extra fields the API ships ahead of the web", async () => {
    mockFetch(200, { ...validBody, somethingNew: true });
    await expect(fetchDestination("thailand", "bangkok")).resolves.not.toBeNull();
  });

  it("returns null on 404", async () => {
    mockFetch(404);
    await expect(fetchDestination("thailand", "nowhere")).resolves.toBeNull();
  });

  it("throws, naming the field, when the API drops a required field", async () => {
    const { aiSummary: _drop, ...rest } = validBody.experiences[0];
    mockFetch(200, { ...validBody, experiences: [rest] });
    await expect(fetchDestination("thailand", "bangkok")).rejects.toThrow(
      /experiences\.0\.aiSummary/,
    );
  });

  it("throws on an unknown price band", async () => {
    const bad = {
      ...validBody,
      experiences: [{ ...validBody.experiences[0], priceBand: "$$$$$" }],
    };
    mockFetch(200, bad);
    await expect(fetchDestination("thailand", "bangkok")).rejects.toThrow(
      /priceBand/,
    );
  });
});
