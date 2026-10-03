import { describe, expect, it } from "@jest/globals";
import { AUTO_DRIFT_PERIOD_MS, AUTO_SPEED, autoPanPosition } from "./auto-pan";

describe("autoPanPosition", () => {
  const spanX = 9000;
  const spanY = 800;

  it("starts at the origin", () => {
    expect(autoPanPosition(0, spanX, spanY)).toEqual({ x: 0, y: 0 });
  });

  it("moves right at the run speed, turns at the span and comes back", () => {
    expect(autoPanPosition(1000, spanX, spanY).x).toBeCloseTo(AUTO_SPEED, 6);
    const turn = (spanX / AUTO_SPEED) * 1000;
    expect(autoPanPosition(turn, spanX, spanY).x).toBeCloseTo(spanX, 6);
    expect(autoPanPosition(turn + 1000, spanX, spanY).x).toBeCloseTo(spanX - AUTO_SPEED, 6);
    expect(autoPanPosition(2 * turn, spanX, spanY).x).toBeCloseTo(0, 6);
  });

  it("drifts through the vertical span and back once per period", () => {
    expect(autoPanPosition(AUTO_DRIFT_PERIOD_MS / 2, spanX, spanY).y).toBeCloseTo(spanY, 6);
    expect(autoPanPosition(AUTO_DRIFT_PERIOD_MS, spanX, spanY).y).toBeCloseTo(0, 6);
  });

  it("stays put on an axis with no room", () => {
    expect(autoPanPosition(5000, 0, -10)).toEqual({ x: 0, y: 0 });
  });
});
