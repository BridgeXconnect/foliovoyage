import { Module } from "@nestjs/common";

import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

/**
 * Feature module for free-text search (ST-13 / BRI-125).
 * `PrismaService` is injected from the global {@link PrismaModule}.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
