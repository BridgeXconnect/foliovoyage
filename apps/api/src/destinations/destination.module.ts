import { Module } from "@nestjs/common";

import { DestinationController } from "./destination.controller";
import { DestinationService } from "./destination.service";

/**
 * Feature module for the destination read endpoint (ST-5 / BRI-100).
 * `PrismaService` is injected from the global {@link PrismaModule}.
 */
@Module({
  controllers: [DestinationController],
  providers: [DestinationService],
})
export class DestinationModule {}
