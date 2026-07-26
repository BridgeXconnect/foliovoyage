import {
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, jest } from "@jest/globals";

import type { Env } from "../config/env.validation";
import { AffiliateController } from "./affiliate.controller";
import type { AffiliateService } from "./affiliate.service";

const SECRET = "test-secret";

function fakeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) =>
      key === "INTERNAL_CLICK_SECRET" ? SECRET : undefined,
  } as unknown as ConfigService<Env, true>;
}

function setup(): { controller: AffiliateController; record: jest.Mock } {
  const record = jest.fn(async () => undefined);
  const service = { recordClick: record } as unknown as AffiliateService;
  return { controller: new AffiliateController(service, fakeConfig()), record };
}

describe("AffiliateController POST /v1/affiliate-clicks", () => {
  it("rejects a missing internal secret without touching the service", async () => {
    const { controller, record } = setup();
    await expect(
      controller.record(undefined, { tourId: "t" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects a wrong internal secret", async () => {
    const { controller, record } = setup();
    await expect(
      controller.record("nope", { tourId: "t" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects a body with no tourId (even with a valid secret)", async () => {
    const { controller, record } = setup();
    await expect(controller.record(SECRET, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("records the click when the secret and tourId are valid", async () => {
    const { controller, record } = setup();
    await controller.record(SECRET, {
      tourId: "bangkok/grand-palace-wat-phra-kaew",
      referrer: "https://folio.example/destinations/bangkok",
      userAgent: "UA",
      ip: "203.0.113.7",
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toEqual({
      tourId: "bangkok/grand-palace-wat-phra-kaew",
      providerId: "viator", // defaulted
      sessionId: undefined,
      referrer: "https://folio.example/destinations/bangkok",
      userAgent: "UA",
      ip: "203.0.113.7",
    });
  });

  it("defaults providerId to viator and drops empty strings", async () => {
    const { controller, record } = setup();
    await controller.record(SECRET, { tourId: "t", providerId: "" });
    expect(
      (record.mock.calls[0][0] as { providerId: string }).providerId,
    ).toBe("viator");
  });
});
