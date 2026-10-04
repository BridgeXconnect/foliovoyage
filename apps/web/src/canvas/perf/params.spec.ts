import { describe, expect, it } from "@jest/globals";
import { DEFAULT_INERTIA } from "../engine/motion";
import { NO_ABLATION, describeSwitches, parsePerfParams } from "./params";

describe("parsePerfParams", () => {
  it("is off with no params", () => {
    expect(parsePerfParams("")).toEqual({
      perf: false,
      auto: false,
      inertia: DEFAULT_INERTIA,
      ablation: NO_ABLATION,
      flat: false,
      invalid: [],
    });
  });

  it("ignores auto, the inertia params and the switches outside perf mode", () => {
    const p = parsePerfParams("?auto=1&tau=900&radius=0&flat=1&img=1x");
    expect(p.perf).toBe(false);
    expect(p.auto).toBe(false);
    expect(p.inertia).toEqual(DEFAULT_INERTIA);
    expect(p.ablation).toEqual(NO_ABLATION);
    expect(p.invalid).toEqual([]);
  });

  it("reads perf, auto and the inertia params", () => {
    const p = parsePerfParams("?perf=1&auto=1&tau=500&velocityWindow=80&maxVelocity=3000");
    expect(p).toMatchObject({ perf: true, auto: true, inertia: { tau: 500, velocityWindow: 80, maxVelocity: 3000 } });
    expect(p.ablation).toEqual(NO_ABLATION);
    expect(p.invalid).toEqual([]);
  });

  it("falls back to the default for a malformed or out of range value, and flags it", () => {
    const p = parsePerfParams("?perf=1&tau=abc&velocityWindow=&maxVelocity=-5");
    expect(p.inertia).toEqual(DEFAULT_INERTIA);
    expect(p.invalid).toEqual(["tau=abc", "velocityWindow=", "maxVelocity=-5"]);
    expect(parsePerfParams("?perf=1&tau=1e9").inertia.tau).toBe(DEFAULT_INERTIA.tau);
  });

  it("reads each ablation switch on its own", () => {
    expect(parsePerfParams("?perf=1&radius=0").ablation).toEqual({ ...NO_ABLATION, radius: false });
    expect(parsePerfParams("?perf=1&tilt=0").ablation).toEqual({ ...NO_ABLATION, tilt: false });
    expect(parsePerfParams("?perf=1&captions=off").ablation).toEqual({ ...NO_ABLATION, captions: false });
    expect(parsePerfParams("?perf=1&prefetch=all").ablation).toEqual({ ...NO_ABLATION, prefetch: true });
    expect(parsePerfParams("?perf=1&radius=1&tilt=1&captions=on&prefetch=near").ablation).toEqual(NO_ABLATION);
  });

  it("turns radius, tilt and captions off together with flat=1", () => {
    const p = parsePerfParams("?perf=1&flat=1");
    expect(p.flat).toBe(true);
    expect(p.ablation).toEqual({ radius: false, tilt: false, captions: false, prefetch: false });
    expect(p.invalid).toEqual([]);
  });

  it("flags unknown values, img, and a switch that contradicts flat=1", () => {
    const p = parsePerfParams("?perf=1&radius=2&captions=0&prefetch=yes&img=1x");
    expect(p.ablation).toEqual(NO_ABLATION);
    expect(p.invalid).toEqual(["img=1x", "radius=2", "captions=0", "prefetch=yes"]);
    expect(parsePerfParams("?perf=1&flat=1&tilt=1").invalid).toEqual(["tilt=1"]);
  });
});

describe("describeSwitches", () => {
  it("names the switches in effect", () => {
    expect(describeSwitches(parsePerfParams("?perf=1"))).toBe("switches: none");
    expect(describeSwitches(parsePerfParams("?perf=1&radius=0&prefetch=all"))).toBe("switches: radius=0 prefetch=all");
    expect(describeSwitches(parsePerfParams("?perf=1&flat=1"))).toBe(
      "switches: flat=1 (radius=0 tilt=0 captions=off)",
    );
  });
});
