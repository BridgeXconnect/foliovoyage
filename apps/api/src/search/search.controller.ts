import { Controller, Get, ParseIntPipe, Query, UseFilters } from "@nestjs/common";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { SearchService } from "./search.service";
import type { SearchResponse } from "./search.types";

/**
 * `GET /v1/search?q=` — free-text search over Experiences + Destinations
 * (ST-13 / BRI-125, Phase-A Postgres FTS — docs/02 §8). URI-versioned
 * (`version: "1"` → `/v1`); errors render as RFC 9457 problem+json via
 * {@link ProblemDetailsFilter}.
 *
 * `q` is optional: an empty/missing query returns the "featured" fallback (see
 * {@link SearchService.runFeatured}). Optional `?page`/`?pageSize` paginate
 * the merged, ranked results.
 */
@UseFilters(ProblemDetailsFilter)
@Controller({ path: "search", version: "1" })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  get(
    @Query("q") q: string | undefined,
    @Query("page", new ParseIntPipe({ optional: true })) page?: number,
    @Query("pageSize", new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<SearchResponse> {
    return this.search.search(q, page, pageSize);
  }
}
