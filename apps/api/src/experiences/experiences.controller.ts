import { Controller, Get, NotFoundException, Param, Res, UseFilters } from "@nestjs/common";
import type { Response } from "express";
import type { ExperiencePage, ExperienceRating } from "@folio/shared";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { ExperiencesService } from "./experiences.service";

/**
 * Public, read only data for a tour's own page (spec 0005). URI versioned
 * (`/v1/experiences/...`); errors are RFC 9457 problem+json from
 * {@link ProblemDetailsFilter}.
 *
 * The cache header goes on every response, 404s included (AC-3): a missing or
 * unpublished Experience is as cacheable as a live one. It is set before the
 * lookup so a thrown 404 still carries it. Any other failure (a database error)
 * has it removed again, so a CDN never holds a 5xx for 15 minutes.
 */
export const EXPERIENCE_CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=86400";

@UseFilters(ProblemDetailsFilter)
@Controller({ path: "experiences", version: "1" })
export class ExperiencesController {
  constructor(private readonly experiences: ExperiencesService) {}

  @Get(":id")
  page(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<ExperiencePage> {
    return this.cached(res, () => this.experiences.getPage(id));
  }

  @Get(":id/rating")
  rating(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<ExperienceRating> {
    return this.cached(res, () => this.experiences.getRating(id));
  }

  private async cached<T>(res: Response, read: () => Promise<T>): Promise<T> {
    res.setHeader("Cache-Control", EXPERIENCE_CACHE_CONTROL);
    try {
      return await read();
    } catch (err) {
      if (!(err instanceof NotFoundException)) res.removeHeader("Cache-Control");
      throw err;
    }
  }
}
