import {
  Controller,
  ConflictException,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ProblemDetailsFilter } from "../../common/problem-details.filter";
import type { Env } from "../../config/env.validation";
import { ImportRunService } from "./import-run.service";

/**
 * `POST /v1/import/trigger` — external wake + start trigger for the nightly
 * import (BRI-173).
 *
 * Render's free-tier web service sleeps after 15 minutes with no inbound
 * traffic, and `ImportScheduler`'s in-process cron (`0 3 * * *` by default)
 * cannot fire while the process is asleep — there is nothing running to fire
 * it. A scheduled GitHub Actions workflow calls this endpoint at the same
 * time the cron was meant to, which both wakes the sleeping instance (the
 * HTTP request itself is inbound traffic) and starts the run.
 *
 * **Not a public browser endpoint.** Guarded by a shared `x-import-trigger-secret`
 * — same pattern as `AffiliateController`'s `x-internal-secret` — so only the
 * workflow (which knows the secret via a repo secret) can start a run.
 *
 * **Fire-and-forget.** `ImportRunService.execute()` is intentionally not
 * awaited: a real run can take hours, and the caller (a single GitHub Actions
 * step) only needs confirmation the run *started*, not its eventual outcome —
 * exactly how the in-process cron path already behaves from the scheduler's
 * perspective. Returns `202 Accepted` immediately. `execute()` never throws
 * (see its own docs), so there's no unhandled-rejection risk in leaving it
 * unawaited.
 */
@UseFilters(ProblemDetailsFilter)
@Controller({ path: "import", version: "1" })
export class ImportTriggerController {
  private readonly secret: string;

  constructor(
    private readonly runService: ImportRunService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get("IMPORT_TRIGGER_SECRET", { infer: true });
  }

  @Post("trigger")
  @HttpCode(202)
  async trigger(
    @Headers("x-import-trigger-secret") secret: string | undefined,
  ): Promise<{ triggered: boolean }> {
    // Server-to-server only: reject anything without the shared secret.
    if (!secret || secret !== this.secret) {
      throw new UnauthorizedException("Invalid or missing trigger secret.");
    }

    if (await this.runService.hasRunningRun()) {
      throw new ConflictException("An import run is already in progress.");
    }

    // Deliberately unawaited — see class docs.
    void this.runService.execute("scheduled-external");

    return { triggered: true };
  }
}
