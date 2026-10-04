import { Module } from "@nestjs/common";

import { ExperiencesController } from "./experiences.controller";
import { ExperiencesService } from "./experiences.service";

/**
 * Feature module for a tour's own page data (spec 0005). `PrismaService` is
 * injected from the global {@link PrismaModule}.
 */
@Module({
  controllers: [ExperiencesController],
  providers: [ExperiencesService],
})
export class ExperiencesModule {}
