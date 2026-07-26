import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Affiliate click logger (ST-24 / BRI-136).
 *
 * Writes one append-only `AffiliateClick` row per outbound affiliate click. The
 * `/go` redirect awaits this **before** it 302s, so no click is lost (FR-AFF-1).
 * The client IP is stored only as a salted hash — never raw — so the log carries
 * no directly-identifying network address.
 */

/** The fields a caller supplies for one click. `ip` is hashed here, never stored raw. */
export interface RecordClickInput {
  /** Clicked tour identifier: a static "<slug>/<expId>" key or a DB Tour.id. */
  tourId: string;
  /** Source OTA the deep link targets (e.g. "viator"). */
  providerId: string;
  /** First-party session id, when the caller has one. */
  sessionId?: string | null;
  /** Referring page URL, when sent. */
  referrer?: string | null;
  /** Requesting user agent, when sent. */
  userAgent?: string | null;
  /** Raw client IP — hashed with a salt before storage, then discarded. */
  ip?: string | null;
}

@Injectable()
export class AffiliateService {
  private readonly ipSalt: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ipSalt = config.get("IP_HASH_SALT", { infer: true });
  }

  /** Append one click row. Resolves once the row is committed (log-before-redirect). */
  async recordClick(input: RecordClickInput): Promise<void> {
    await this.prisma.affiliateClick.create({
      data: {
        tourId: input.tourId,
        providerId: input.providerId,
        sessionId: input.sessionId ?? null,
        referrer: input.referrer ?? null,
        userAgent: input.userAgent ?? null,
        ipHash: input.ip ? this.hashIp(input.ip) : null,
      },
    });
  }

  /** Salted SHA-256 of an IP, so a stored hash never derives back to the raw IP. */
  private hashIp(ip: string): string {
    return createHash("sha256").update(`${this.ipSalt}:${ip}`).digest("hex");
  }
}
