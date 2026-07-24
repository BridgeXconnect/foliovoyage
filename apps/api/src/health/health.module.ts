import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { DatabaseHealthIndicator } from "./database.health";
import { HealthController } from "./health.controller";
import { ReadinessController } from "./readiness.controller";
import { RedisHealthIndicator } from "./redis.health";

/**
 * Health/readiness endpoints (ST-2 / BRI-97):
 *   GET /health — liveness (always 200 if the process is up)
 *   GET /ready  — readiness (200 only when Postgres AND Redis are reachable)
 *
 * The Postgres pool and Redis client come from the global DatabaseModule /
 * RedisModule registered in AppModule.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController, ReadinessController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
