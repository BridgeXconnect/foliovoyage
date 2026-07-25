import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseFilters,
} from "@nestjs/common";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { DestinationService } from "./destination.service";
import type { DestinationResponse } from "./destination.types";

/**
 * `GET /v1/destinations/:country/:city` — the destination read endpoint
 * (ST-5 / BRI-100, extended for ST-11 / BRI-164). URI-versioned
 * (`version: "1"` → `/v1`); errors are rendered as RFC 9457 problem+json by
 * {@link ProblemDetailsFilter}.
 *
 * Optional `?page` and `?pageSize` paginate the city's published experiences.
 */
@UseFilters(ProblemDetailsFilter)
@Controller({ path: "destinations", version: "1" })
export class DestinationController {
  constructor(private readonly destinations: DestinationService) {}

  @Get(":country/:city")
  get(
    @Param("country") country: string,
    @Param("city") city: string,
    @Query("page", new ParseIntPipe({ optional: true })) page?: number,
    @Query("pageSize", new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<DestinationResponse> {
    return this.destinations.getByCountryAndCity(country, city, {
      page,
      pageSize,
    });
  }
}
