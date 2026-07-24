import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Thin wrapper around the generated Prisma client (ST-5 / BRI-100).
 *
 * ST-2 kept persistence ORM-agnostic (a raw `pg.Pool` behind the readiness
 * probe); ST-5 picks Prisma for application queries. The readiness probe still
 * pings the pool — this client is the app's data-access path.
 *
 * Connection lifecycle is tied to the Nest module lifecycle so the process
 * shuts down cleanly (main.ts enables shutdown hooks).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
