/**
 * The scripted pan behind `?perf=1&auto=1` (BRI-223), the same path the spike's
 * harness measured: after a 3 s countdown, 30 s at 900 px/s left to right across
 * the four slots of a region row and back, with a slow vertical drift through
 * one slot height every 7.5 s. Pure.
 */

export const AUTO_COUNTDOWN_MS = 3000;
export const AUTO_RUN_MS = 30_000;
export const AUTO_SPEED = 900; // px/s
export const AUTO_DRIFT_PERIOD_MS = 7500;

/** The view offset from the run's start at `t` ms into the run, for spans of `spanX` and `spanY` px. */
export function autoPanPosition(t: number, spanX: number, spanY: number): { x: number; y: number } {
  const x = spanX <= 0 ? 0 : (() => {
    const leg = ((t * AUTO_SPEED) / 1000) % (2 * spanX);
    return leg <= spanX ? leg : 2 * spanX - leg;
  })();
  const y = (Math.max(0, spanY) * (1 - Math.cos((2 * Math.PI * t) / AUTO_DRIFT_PERIOD_MS))) / 2;
  return { x, y };
}
