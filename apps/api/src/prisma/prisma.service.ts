import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { transientRetryExtension } from "./transient-retry.extension";

/**
 * Thin wrapper around the generated Prisma client (ST-5 / BRI-100).
 *
 * ST-2 kept persistence ORM-agnostic (a raw `pg.Pool` behind the readiness
 * probe); ST-5 picks Prisma for application queries. The readiness probe still
 * pings the pool — this client is the app's data-access path.
 *
 * Connection lifecycle is tied to the Nest module lifecycle so the process
 * shuts down cleanly (main.ts enables shutdown hooks).
 *
 * Every instance carries the transient-retry extension (BRI-210): standalone
 * queries on its allow-list are retried on a connection-class error, using the
 * process's retry profile (`setDbRetryProfile`, default `web`). `$extends`
 * returns a new client, so the constructor returns that instead of `this`;
 * prototype methods (`onModuleInit`, …) still resolve through it.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    return this.$extends(transientRetryExtension) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
