import {
  Controller,
  Get,
  ParseFloatPipe,
  ParseIntPipe,
  Query,
  UseFilters,
} from "@nestjs/common";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { parseSearchFilters, SearchService } from "./search.service";
import type { SearchResponse } from "./search.types";

/**
 * `GET /v1/search?q=` — free-text search over Experiences + Destinations
 * (ST-13 / BRI-125, Phase-A Postgres FTS — docs/02 §8), extended with
 * composable filters (ST-16 / BRI-128). URI-versioned (`version: "1"` →
 * `/v1`); errors render as RFC 9457 problem+json via
 * {@link ProblemDetailsFilter}.
 *
 * `q` is optional: an empty/missing query returns the "featured" fallback (see
 * {@link SearchService.runFeatured}). Optional `?page`/`?pageSize` paginate
 * the merged, ranked results.
 *
 * Filters — `?priceBand=$,$$` (comma-separated), `?minRating=4`,
 * `?minDurationMin=`/`?maxDurationMin=` — AND together with each other and
 * with `q`; see {@link SearchService.search}'s docs for the one structural
 * exception (Destination results are excluded outright once any of these is
 * set, since a City has none of them). Same query-param names are intended for
 * a future results page / map view (M3) to reuse verbatim — this endpoint is
 * the contract, not a one-off.
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
    @Query("priceBand") priceBand?: string,
    @Query("minRating", new ParseFloatPipe({ optional: true })) minRating?: number,
    @Query("minDurationMin", new ParseIntPipe({ optional: true })) minDurationMin?: number,
    @Query("maxDurationMin", new ParseIntPipe({ optional: true })) maxDurationMin?: number,
  ): Promise<SearchResponse> {
    const filters = parseSearchFilters({
      priceBand,
      minRating,
      minDurationMin,
      maxDurationMin,
    });
    return this.search.search(q, page, pageSize, filters);
  }
}
