import { createHash } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { describe, expect, it, jest } from "@jest/globals";

import type { Env } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { AffiliateService } from "./affiliate.service";

const SALT = "test-salt";

/** Minimal ConfigService returning the IP-hash salt. */
function fakeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) => (key === "IP_HASH_SALT" ? SALT : undefined),
  } as unknown as ConfigService<Env, true>;
}

/** Fake PrismaService capturing affiliateClick.create input. */
function fakePrisma(): {
  prisma: PrismaService;
  create: jest.Mock;
} {
  const create = jest.fn(async (args: unknown) => args);
  const prisma = {
    affiliateClick: { create },
  } as unknown as PrismaService;
  return { prisma, create };
}

describe("AffiliateService.recordClick", () => {
  it("appends a click row with the provided fields", async () => {
    const { prisma, create } = fakePrisma();
    const service = new AffiliateService(prisma, fakeConfig());

    await service.recordClick({
      tourId: "bangkok/grand-palace-wat-phra-kaew",
      providerId: "viator",
      referrer: "https://folio.example/destinations/bangkok",
      userAgent: "Mozilla/5.0",
      ip: "203.0.113.7",
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data.tourId).toBe("bangkok/grand-palace-wat-phra-kaew");
    expect(data.providerId).toBe("viator");
    expect(data.referrer).toBe(
      "https://folio.example/destinations/bangkok",
    );
    expect(data.userAgent).toBe("Mozilla/5.0");
  });

  it("stores the IP only as a salted SHA-256, never the raw IP", async () => {
    const { prisma, create } = fakePrisma();
    const service = new AffiliateService(prisma, fakeConfig());

    await service.recordClick({
      tourId: "t",
      providerId: "viator",
      ip: "203.0.113.7",
    });

    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    const expected = createHash("sha256")
      .update(`${SALT}:203.0.113.7`)
      .digest("hex");
    expect(data.ipHash).toBe(expected);
    // The raw IP must never appear anywhere in the persisted row.
    expect(JSON.stringify(data)).not.toContain("203.0.113.7");
  });

  it("nulls optional fields (incl. ipHash) when absent", async () => {
    const { prisma, create } = fakePrisma();
    const service = new AffiliateService(prisma, fakeConfig());

    await service.recordClick({ tourId: "t", providerId: "viator" });

    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data.sessionId).toBeNull();
    expect(data.referrer).toBeNull();
    expect(data.userAgent).toBeNull();
    expect(data.ipHash).toBeNull();
  });
});
