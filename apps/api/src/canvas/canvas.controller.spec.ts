import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import type { Response } from "express";

import { CANVAS_CACHE_CONTROL, CanvasController } from "./canvas.controller";
import type { CanvasService } from "./canvas.service";

function setup(service: Partial<Record<keyof CanvasService, jest.Mock>>) {
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return { controller: new CanvasController(service as unknown as CanvasService), res, setHeader };
}

describe("CanvasController", () => {
  it("sets the cache header on both successful reads (AC-F8)", async () => {
    const getSummaries = jest.fn(async () => ({ buckets: [] }));
    const getBucket = jest.fn(async () => ({ tiles: [] }));
    const { controller, res, setHeader } = setup({ getSummaries, getBucket } as never);

    await controller.summaries(res);
    await controller.bucket("bangkok", "art-culture", res);

    expect(CANVAS_CACHE_CONTROL).toBe("public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    expect(setHeader).toHaveBeenCalledTimes(2);
    expect(setHeader).toHaveBeenNthCalledWith(1, "Cache-Control", CANVAS_CACHE_CONTROL);
    expect(setHeader).toHaveBeenNthCalledWith(2, "Cache-Control", CANVAS_CACHE_CONTROL);
  });

  it("does not set the cache header when the bucket is a 404", async () => {
    const getBucket = jest.fn(async () => {
      throw new NotFoundException("Unknown city");
    });
    const { controller, res, setHeader } = setup({ getBucket } as never);

    await expect(controller.bucket("paris", "art-culture", res)).rejects.toBeInstanceOf(NotFoundException);
    expect(setHeader).not.toHaveBeenCalled();
  });
});
