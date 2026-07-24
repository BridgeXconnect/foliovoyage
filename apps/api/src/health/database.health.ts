import { Inject, Injectable } from "@nestjs/common";
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from "@nestjs/terminus";
import { Pool } from "pg";

import { PG_POOL } from "../database/database.module";
import { withTimeout } from "./with-timeout";

/**
 * Terminus health indicator that pings Postgres with `SELECT 1` (ST-2 / BRI-97).
 * ORM-agnostic — talks to the raw pool so it does not prejudge the ST-5 ORM.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = "database"): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(this.pool.query("SELECT 1"), 4000, "Postgres ping");
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
