import { Module } from "@nestjs/common";

import { AffiliateController } from "./affiliate.controller";
import { AffiliateService } from "./affiliate.service";

/**
 * Feature module for the affiliate click log (ST-24 / BRI-136).
 * `PrismaService` is injected from the global {@link PrismaModule}.
 */
@Module({
  controllers: [AffiliateController],
  providers: [AffiliateService],
})
export class AffiliateModule {}
