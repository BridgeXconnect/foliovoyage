import { Controller, Get, Param, UseFilters } from "@nestjs/common";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { DestinationService } from "./destination.service";
import type { DestinationResponse } from "./destination.types";

/**
 * `GET /v1/destinations/:country/:city` — the first vertical slice's read
 * endpoint (ST-5 / BRI-100). URI-versioned (`version: "1"` → `/v1`); errors are
 * rendered as RFC 9457 problem+json by {@link ProblemDetailsFilter}.
 */
@UseFilters(ProblemDetailsFilter)
@Controller({ path: "destinations", version: "1" })
export class DestinationController {
  constructor(private readonly destinations: DestinationService) {}

  @Get(":country/:city")
  get(
    @Param("country") country: string,
    @Param("city") city: string,
  ): Promise<DestinationResponse> {
    return this.destinations.getByCountryAndCity(country, city);
  }
}
