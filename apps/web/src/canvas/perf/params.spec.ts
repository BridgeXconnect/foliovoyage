import { describe, expect, it } from "@jest/globals";
import { DEFAULT_INERTIA } from "../engine/motion";
import { parsePerfParams } from "./params";

describe("parsePerfParams", () => {
  it("is off with no params", () => {
    expect(parsePerfParams("")).toEqual({ perf: false, auto: false, inertia: DEFAULT_INERTIA });
  });

  it("ignores auto and the inertia params outside perf mode", () => {
    expect(parsePerfParams("?auto=1&tau=900")).toEqual({ perf: false, auto: false, inertia: DEFAULT_INERTIA });
  });

  it("reads perf, auto and the inertia params", () => {
    expect(parsePerfParams("?perf=1&auto=1&tau=500&velocityWindow=80&maxVelocity=3000")).toEqual({
      perf: true,
      auto: true,
      inertia: { tau: 500, velocityWindow: 80, maxVelocity: 3000 },
    });
  });

  it("falls back to the default for a missing, malformed or out of range value", () => {
    expect(parsePerfParams("?perf=1&tau=abc&velocityWindow=&maxVelocity=-5").inertia).toEqual(DEFAULT_INERTIA);
    expect(parsePerfParams("?perf=1&tau=1e9").inertia.tau).toBe(DEFAULT_INERTIA.tau);
  });
});
