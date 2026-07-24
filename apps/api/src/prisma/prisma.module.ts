import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service";

/**
 * Global provider for {@link PrismaService} (ST-5 / BRI-100) so feature modules
 * can inject it without re-importing this module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
