import { describe, expect, it, jest } from "@jest/globals";

import { CategoryResolver, type TagVocabularySource } from "./category-resolver";
import type { TourDTO } from "./normalizer";
import type { TagVocabulary } from "./tag-resolver";

function tour(overrides: Partial<TourDTO> & { provider_tour_id: string; tags: number[] }): TourDTO {
  return {
    provider: "viator",
    title: "Test tour",
    description: null,
    duration_min: null,
    rating_avg: null,
    rating_count: null,
    price_minor: null,
    currency: null,
    price_reference_minor: null,
    price_reference_currency: null,
    affiliate_url: null,
    location_ref: null,
    image_url: null,
    image_alt: null,
    destination_refs: [],
    images: [],
    inclusions: [],
    exclusions: [],
    cancellation_policy: null,
    reviews_by_source: [],
    latitude: null,
    longitude: null,
    primary_category_tag_id: null,
    fetched_at: "2026-09-28T00:00:00Z",
    source_hash: "hash",
    ...overrides,
  };
}

const VOCAB: TagVocabulary = {
  graph: new Map<number, readonly number[]>([
    [21910, []],
    [21913, []],
    [100, [21910]],
    [200, [21913]],
  ]),
  names: new Map([
    [21910, "Art & Culture"],
    [21913, "Tours, Sightseeing & Cruises"],
  ]),
};

function fakeSource(vocab: TagVocabulary = VOCAB): TagVocabularySource & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getVocabulary: () => {
      calls += 1;
      return Promise.resolve(vocab);
    },
  };
}

describe("CategoryResolver.attachCategories", () => {
  it("attaches the derived primary category for a resolvable tag", async () => {
    const resolver = new CategoryResolver(fakeSource());
    const [out] = await resolver.attachCategories([
      tour({ provider_tour_id: "A", tags: [100] }),
    ]);
    expect(out.primary_category_tag_id).toBe(21910);
  });

  it("leaves primary_category_tag_id null when no tag reaches a category root", async () => {
    const resolver = new CategoryResolver(fakeSource());
    const [out] = await resolver.attachCategories([
      tour({ provider_tour_id: "A", tags: [] }),
    ]);
    expect(out.primary_category_tag_id).toBeNull();
  });

  it("does not mutate the input DTOs", async () => {
    const resolver = new CategoryResolver(fakeSource());
    const input = tour({ provider_tour_id: "A", tags: [100] });
    const [out] = await resolver.attachCategories([input]);
    expect(input.primary_category_tag_id).toBeNull();
    expect(out).not.toBe(input);
  });

  it("returns [] without fetching the vocabulary for an empty batch", async () => {
    const source = fakeSource();
    const resolver = new CategoryResolver(source);
    const out = await resolver.attachCategories([]);
    expect(out).toEqual([]);
    expect(source.calls).toBe(0);
  });

  it("fetches the vocabulary once and reuses it across multiple calls", async () => {
    const source = fakeSource();
    const resolver = new CategoryResolver(source);
    await resolver.attachCategories([tour({ provider_tour_id: "A", tags: [100] })]);
    await resolver.attachCategories([tour({ provider_tour_id: "B", tags: [200] })]);
    expect(source.calls).toBe(1);
  });

  it("never throws when a tag id is missing from the vocabulary", async () => {
    const resolver = new CategoryResolver(fakeSource());
    const result = await resolver.attachCategories([
      tour({ provider_tour_id: "A", tags: [100, 999999] }),
    ]);
    expect(result[0].primary_category_tag_id).toBe(21910);
  });

  it("reports every unresolved tag id across the batch (never silently dropped)", async () => {
    const warn = jest.fn();
    const resolver = new CategoryResolver(fakeSource(), { warn });
    await resolver.attachCategories([
      tour({ provider_tour_id: "A", tags: [100, 999999] }),
      tour({ provider_tour_id: "B", tags: [888888] }),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("999999");
    expect(message).toContain("888888");
  });
});
