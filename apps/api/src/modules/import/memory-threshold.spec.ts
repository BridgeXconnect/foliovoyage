import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "@jest/globals";

import type { Env } from "../../config/env.validation";
import { memoryThresholdBytes } from "./memory-threshold";

/** A minimal fake `ConfigService` returning fixed values for the two BRI-182 vars. */
function fakeConfig(limitMb: number, pct: number): ConfigService<Env, true> {
  return {
    get: (key: string) => {
      if (key === "IMPORT_MEMORY_LIMIT_MB") return limitMb;
      if (key === "IMPORT_CRAWL_RESTART_MEMORY_PCT") return pct;
      throw new Error(`fakeConfig: unexpected key ${key}`);
    },
  } as unknown as ConfigService<Env, true>;
}

describe("memoryThresholdBytes (BRI-182)", () => {
  it("converts the configured MB limit and percentage into an absolute byte threshold", () => {
    // Production defaults: 512MB limit, 45% -> ~230.4MB.
    const bytes = memoryThresholdBytes(fakeConfig(512, 45));
    expect(bytes).toBe(Math.floor(512 * 1024 * 1024 * 0.45));
    expect(bytes).toBe(241591910);
  });

  it("scales with a different configured limit and percentage", () => {
    const bytes = memoryThresholdBytes(fakeConfig(1024, 50));
    expect(bytes).toBe(1024 * 1024 * 1024 * 0.5);
  });
});
