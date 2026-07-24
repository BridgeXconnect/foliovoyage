import { Inject, Injectable } from "@nestjs/common";
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from "@nestjs/terminus";
import Redis from "ioredis";

import { REDIS_CLIENT } from "../redis/redis.module";
import { withTimeout } from "./with-timeout";

/**
 * Terminus health indicator that pings Redis with `PING` (ST-2 / BRI-97).
 * With offline-queue disabled on the client, a down Redis rejects promptly.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = "redis"): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const pong = await withTimeout(this.redis.ping(), 4000, "Redis ping");
      if (pong !== "PONG") {
        return indicator.down({ message: `unexpected PING reply: ${pong}` });
      }
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
