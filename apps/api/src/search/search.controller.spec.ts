import { describe, expect, it, jest } from "@jest/globals";

import { SearchController } from "./search.controller";
import type { SearchService } from "./search.service";
import type { SearchFilters, SearchResponse } from "./search.types";

function setup(): {
  controller: SearchController;
  search: jest.Mock<
    (
      q: string | undefined,
      page?: number,
      pageSize?: number,
      filters?: SearchFilters,
    ) => Promise<SearchResponse>
  >;
} {
  const search = jest.fn<
    (
      q: string | undefined,
      page?: number,
      pageSize?: number,
      filters?: SearchFilters,
    ) => Promise<SearchResponse>
  >();
  const service = { search } as unknown as SearchService;
  return { controller: new SearchController(service), search };
}

const EMPTY_RESPONSE: SearchResponse = {
  query: "",
  results: [],
  pagination: { page: 1, pageSize: 12, total: 0, totalPages: 1 },
};

/** No filter query params set → every {@link SearchFilters} field is undefined. */
const NO_FILTERS: SearchFilters = {
  priceBands: undefined,
  minRating: undefined,
  minDurationMin: undefined,
  maxDurationMin: undefined,
};

describe("SearchController GET /v1/search", () => {
  it("passes q/page/pageSize straight through to the service, with no filters set", async () => {
    const { controller, search } = setup();
    search.mockResolvedValue(EMPTY_RESPONSE);

    await controller.get("bangkok", 2, 20);

    expect(search).toHaveBeenCalledWith("bangkok", 2, 20, NO_FILTERS);
  });

  it("passes an undefined q through unchanged (service owns the featured fallback)", async () => {
    const { controller, search } = setup();
    search.mockResolvedValue(EMPTY_RESPONSE);

    await controller.get(undefined, undefined, undefined);

    expect(search).toHaveBeenCalledWith(undefined, undefined, undefined, NO_FILTERS);
  });

  it("returns the service's response unchanged", async () => {
    const { controller, search } = setup();
    const response: SearchResponse = {
      query: "temple",
      results: [],
      pagination: { page: 1, pageSize: 12, total: 5, totalPages: 1 },
    };
    search.mockResolvedValue(response);

    await expect(controller.get("temple", 1, 12)).resolves.toBe(response);
  });

  it("parses priceBand/minRating/duration query params into SearchFilters (ST-16 / BRI-128)", async () => {
    const { controller, search } = setup();
    search.mockResolvedValue(EMPTY_RESPONSE);

    await controller.get("bangkok", undefined, undefined, "$,$$", 4, 60, 240);

    expect(search).toHaveBeenCalledWith("bangkok", undefined, undefined, {
      priceBands: ["$", "$$"],
      minRating: 4,
      minDurationMin: 60,
      maxDurationMin: 240,
    });
  });

  it("drops unknown priceBand tokens rather than erroring", async () => {
    const { controller, search } = setup();
    search.mockResolvedValue(EMPTY_RESPONSE);

    await controller.get("bangkok", undefined, undefined, "$,not-a-band");

    expect(search).toHaveBeenCalledWith("bangkok", undefined, undefined, {
      ...NO_FILTERS,
      priceBands: ["$"],
    });
  });
});
