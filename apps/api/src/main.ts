import { VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import type { Env } from "./config/env.validation";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Fire OnApplicationShutdown so the pg pool / Redis client close cleanly.
  app.enableShutdownHooks();

  // URI versioning (ST-5 / BRI-100): controllers opt in with `version: "1"` to
  // get a `/v1` prefix (e.g. /v1/destinations). Default is VERSION_NEUTRAL so
  // the ST-2 liveness/readiness probes stay at /health and /ready, unversioned.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get("PORT", { infer: true });

  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
