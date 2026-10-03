import { Module } from "@nestjs/common";

import { CanvasController } from "./canvas.controller";
import { CanvasService } from "./canvas.service";

/**
 * Feature module for the discovery canvas feed (BRI-225). `PrismaService` is
 * injected from the global {@link PrismaModule}.
 */
@Module({
  controllers: [CanvasController],
  providers: [CanvasService],
})
export class CanvasModule {}
