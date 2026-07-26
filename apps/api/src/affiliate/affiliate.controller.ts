import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ProblemDetailsFilter } from "../common/problem-details.filter";
import type { Env } from "../config/env.validation";
import { AffiliateService } from "./affiliate.service";

/**
 * `POST /v1/affiliate-clicks` — internal click-log write for the web `/go`
 * redirect (ST-24 / BRI-136). The DB write lives here because the API owns
 * Prisma; the `/go` route handler in `apps/web` resolves the deep link and calls
 * this, then 302s.
 *
 * **Not a public browser endpoint.** It is guarded by a shared `x-internal-secret`
 * so only the web server (which knows the secret) can write click rows — a
 * browser cannot spam the analytics log. Returns `204 No Content`.
 */

/** Request body the `/go` handler posts. Validated defensively (no global pipe). */
interface RecordClickBody {
  tourId?: unknown;
  providerId?: unknown;
  sessionId?: unknown;
  referrer?: unknown;
  userAgent?: unknown;
  ip?: unknown;
}

/** Narrow an unknown body field to a non-empty string, else undefined. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

@UseFilters(ProblemDetailsFilter)
@Controller({ path: "affiliate-clicks", version: "1" })
export class AffiliateController {
  private readonly secret: string;

  constructor(
    private readonly affiliate: AffiliateService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get("INTERNAL_CLICK_SECRET", { infer: true });
  }

  @Post()
  @HttpCode(204)
  async record(
    @Headers("x-internal-secret") secret: string | undefined,
    @Body() body: RecordClickBody,
  ): Promise<void> {
    // Server-to-server only: reject anything without the shared secret.
    if (!secret || secret !== this.secret) {
      throw new UnauthorizedException("Invalid or missing internal secret.");
    }

    const tourId = optionalString(body?.tourId);
    if (!tourId) {
      throw new BadRequestException("tourId is required.");
    }

    await this.affiliate.recordClick({
      tourId,
      providerId: optionalString(body?.providerId) ?? "viator",
      sessionId: optionalString(body?.sessionId),
      referrer: optionalString(body?.referrer),
      userAgent: optionalString(body?.userAgent),
      ip: optionalString(body?.ip),
    });
  }
}
