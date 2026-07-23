import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  /** Liveness probe. See Architecture §17 (Observability). */
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
