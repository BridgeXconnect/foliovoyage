import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

import type { Env } from "../config/env.validation";

/** DI token for the shared Redis client. */
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/**
 * Provides a single ioredis client built from `REDIS_URL` (ST-2 / BRI-97).
 *
 * `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` make commands fail
 * fast when Redis is down instead of queueing — important so the readiness ping
 * returns promptly. The client keeps retrying its connection in the background.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis =>
        new Redis(config.get("REDIS_URL", { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit(): void {
    // Attach handlers so background connection errors are logged, not thrown as
    // unhandled 'error' events. App stays up regardless (readiness gate).
    this.redis.on("ready", () => this.logger.log("Connected to Redis"));
    this.redis.on("error", (err: Error) =>
      this.logger.warn(`Redis connection error: ${err.message}`),
    );
    // The client connects eagerly on construction, so 'ready' may have already
    // fired before this handler was attached — log the current state too.
    if (this.redis.status === "ready") {
      this.logger.log("Connected to Redis");
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // quit() drains gracefully; ignore errors if already disconnected.
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
