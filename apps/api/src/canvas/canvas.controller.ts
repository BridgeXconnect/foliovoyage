import { Controller, Get, Param, Res, UseFilters } from "@nestjs/common";
import type { Response } from "express";
import type { CanvasBucketResponse, CanvasBucketsResponse } from "@folio/shared";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import { CanvasService } from "./canvas.service";

/**
 * Public, read only feed for the discovery canvas (BRI-225). URI versioned
 * (`/v1/canvas/...`); errors are RFC 9457 problem+json from
 * {@link ProblemDetailsFilter}.
 */
export const CANVAS_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

@UseFilters(ProblemDetailsFilter)
@Controller({ path: "canvas/buckets", version: "1" })
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get()
  async summaries(@Res({ passthrough: true }) res: Response): Promise<CanvasBucketsResponse> {
    const body = await this.canvas.getSummaries();
    res.setHeader("Cache-Control", CANVAS_CACHE_CONTROL);
    return body;
  }

  @Get(":citySlug/:categorySlug")
  async bucket(
    @Param("citySlug") citySlug: string,
    @Param("categorySlug") categorySlug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CanvasBucketResponse> {
    const body = await this.canvas.getBucket(citySlug, categorySlug);
    // Set after the lookup, so a 404 never carries a cacheable header.
    res.setHeader("Cache-Control", CANVAS_CACHE_CONTROL);
    return body;
  }
}
