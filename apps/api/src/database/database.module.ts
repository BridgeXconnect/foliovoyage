import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

import type { Env } from "../config/env.validation";

/** DI token for the shared Postgres connection pool. */
export const PG_POOL = Symbol("PG_POOL");

/**
 * Provides a single `pg.Pool` built from `DATABASE_URL` (ST-2 / BRI-97).
 *
 * Kept ORM-agnostic on purpose: ST-5 will choose Prisma/TypeORM, but the config
 * surface (`DATABASE_URL`) and a working connection are what ST-2 must deliver.
 * The pool is what the readiness probe pings.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Pool =>
        new Pool({
          connectionString: config.get("DATABASE_URL", { infer: true }),
          // Bound how long a readiness ping waits when Postgres is unreachable,
          // so /ready fails fast instead of hanging.
          connectionTimeoutMillis: 3000,
          max: 10,
        }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Best-effort connectivity probe on boot. Logs the outcome but never crashes
   * the process: a down dependency must leave the app running so /ready can
   * report it as not-ready (readiness gate, not a hard boot dependency).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
      this.logger.log("Connected to Postgres");
    } catch (err) {
      this.logger.warn(
        `Postgres not reachable on boot: ${(err as Error).message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
