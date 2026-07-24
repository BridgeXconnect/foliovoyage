import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { validateEnv } from "./config/env.validation";
import { DatabaseModule } from "./database/database.module";
import { DestinationModule } from "./destinations/destination.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Zod-validated, fail-fast config (ST-2 / BRI-97). ConfigModule loads
      // .env for local dev; in prod the values come from the real environment.
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    PrismaModule,
    HealthModule,
    DestinationModule,
  ],
})
export class AppModule {}
