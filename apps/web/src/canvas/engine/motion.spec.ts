import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_INERTIA,
  EASE_TAU,
  MAX_FRAME_DT,
  STOP_VELOCITY,
  clampDt,
  decayStep,
  easeStep,
  glideDistance,
  isDiscreteWheel,
  releaseVelocity,
  type PointerSample,
} from "./motion";
import type { Point } from "./view";

/** Run a glide to rest at a fixed frame interval; returns the distance and the frame count. */
function glide(v: Point, frameMs: number, tau = DEFAULT_INERTIA.tau) {
  let velocity = v;
  let x = 0;
  let y = 0;
  let frames = 0;
  while (velocity.x !== 0 || velocity.y !== 0) {
    const step = decayStep(velocity, frameMs, tau);
    velocity = step.velocity;
    x += step.delta.x;
    y += step.delta.y;
    frames++;
    if (frames > 10_000) throw new Error("glide never stopped");
  }
  return { x, y, frames };
}

describe("releaseVelocity", () => {
  it("measures the velocity of the samples in the window, against the pointer", () => {
    // The finger moves left 200 px in 50 ms: the view moves right at 4000 px/s... capped below.
    const samples: PointerSample[] = [
      { t: 0, x: 500, y: 300 },
      { t: 25, x: 450, y: 310 },
      { t: 50, x: 400, y: 320 },
    ];
    expect(releaseVelocity(samples, 50, { ...DEFAULT_INERTIA, maxVelocity: 1e9 })).toEqual({ x: 2000, y: -400 });
  });

  it("ignores samples older than the window", () => {
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 }, // 150 ms before release: outside a 100 ms window
      { t: 100, x: 100, y: 0 },
      { t: 150, x: 150, y: 0 },
    ];
    expect(releaseVelocity(samples, 150)).toEqual({ x: -1000, y: 0 });
  });

  it("is zero when the finger rested before it lifted", () => {
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 20, x: 80, y: 0 },
    ];
    expect(releaseVelocity(samples, 300)).toEqual({ x: 0, y: 0 });
  });

  it("is zero for a single sample or a span too short to measure", () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 0)).toEqual({ x: 0, y: 0 });
    expect(
      releaseVelocity(
        [
          { t: 0, x: 0, y: 0 },
          { t: 2, x: 40, y: 0 },
        ],
        2,
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it("caps the speed and keeps the direction", () => {
    const v = releaseVelocity(
      [
        { t: 0, x: 0, y: 0 },
        { t: 10, x: 300, y: 400 },
      ],
      10,
    );
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(DEFAULT_INERTIA.maxVelocity, 6);
    expect(v.x / v.y).toBeCloseTo(0.75, 6);
  });
});

describe("decayStep", () => {
  it("decays the velocity by exp(-dt/tau)", () => {
    const { velocity } = decayStep({ x: 1000, y: 0 }, 50, 325);
    expect(velocity.x).toBeCloseTo(1000 * Math.exp(-50 / 325), 9);
  });

  it("covers the same distance at 60 and 120 frames per second", () => {
    const v = { x: 3000, y: -1200 };
    const at60 = glide(v, 1000 / 60);
    const at120 = glide(v, 1000 / 120);
    expect(at120.frames).toBeGreaterThan(at60.frames);
    expect(at120.x).toBeCloseTo(at60.x, 0);
    expect(at120.y).toBeCloseTo(at60.y, 0);
    // And both come close to the closed form v·τ (the stop threshold leaves a few px).
    expect(at60.x).toBeGreaterThan(glideDistance(v, 325).x - 5);
    expect(at60.x).toBeLessThanOrEqual(glideDistance(v, 325).x);
  });

  it("stops once the velocity falls below the threshold", () => {
    expect(decayStep({ x: STOP_VELOCITY - 0.1, y: 0 }, 16, 325).velocity).toEqual({ x: 0, y: 0 });
    expect(decayStep({ x: 100, y: 0 }, 16, 325).velocity.x).toBeGreaterThan(0);
    const run = glide({ x: 500, y: 0 }, 16);
    expect(Number.isFinite(run.frames)).toBe(true);
  });

  it("clamps a long frame, so a stalled tab never throws the view", () => {
    expect(decayStep({ x: 1000, y: 0 }, 5000, 325)).toEqual(decayStep({ x: 1000, y: 0 }, MAX_FRAME_DT, 325));
    expect(clampDt(-5)).toBe(0);
  });
});

describe("easeStep", () => {
  it("covers 1 - exp(-dt/tau) of what is left", () => {
    const { delta, remaining } = easeStep({ x: 100, y: 0 }, 16);
    const share = 1 - Math.exp(-16 / EASE_TAU);
    expect(delta.x).toBeCloseTo(100 * share, 9);
    expect(remaining.x + delta.x).toBeCloseTo(100, 9);
  });

  it("snaps the last half pixel and lands exactly on the target", () => {
    let remaining = { x: 80, y: -80 };
    let moved = { x: 0, y: 0 };
    for (let i = 0; i < 200 && (remaining.x !== 0 || remaining.y !== 0); i++) {
      const step = easeStep(remaining, 16);
      remaining = step.remaining;
      moved = { x: moved.x + step.delta.x, y: moved.y + step.delta.y };
    }
    expect(remaining).toEqual({ x: 0, y: 0 });
    expect(moved.x).toBeCloseTo(80, 9);
    expect(moved.y).toBeCloseTo(-80, 9);
  });
});

describe("isDiscreteWheel", () => {
  it("reads a line or page delta as a wheel", () => {
    expect(isDiscreteWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(true);
    expect(isDiscreteWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(true);
  });

  it("reads a whole pixel notch on one axis as a wheel", () => {
    expect(isDiscreteWheel({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(true);
    expect(isDiscreteWheel({ deltaX: 0, deltaY: -120, deltaMode: 0 })).toBe(true);
  });

  it("reads small, fractional or two axis deltas as a trackpad", () => {
    expect(isDiscreteWheel({ deltaX: 0, deltaY: 4, deltaMode: 0 })).toBe(false);
    expect(isDiscreteWheel({ deltaX: 0, deltaY: 53.5, deltaMode: 0 })).toBe(false);
    expect(isDiscreteWheel({ deltaX: 60, deltaY: 60, deltaMode: 0 })).toBe(false);
  });
});
