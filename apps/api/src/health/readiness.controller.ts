import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";

import { DatabaseHealthIndicator } from "./database.health";
import { RedisHealthIndicator } from "./redis.health";

/**
 * Readiness probe (ST-2 / BRI-97). See Architecture §17 (Observability).
 *
 * Returns 200 only when BOTH Postgres and Redis respond; if either is
 * unreachable, Terminus responds 503. Distinct from `/health`, which is a
 * static liveness check that is always 200 while the process is up.
 */
@Controller("ready")
export class ReadinessController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy("database"),
      () => this.redis.isHealthy("redis"),
    ]);
  }
}
