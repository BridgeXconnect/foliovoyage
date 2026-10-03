/**
 * Motion rules for the discovery canvas pan: release inertia after a drag, and
 * the short ease a wheel notch or an arrow key moves with (BRI-223, decided with
 * Roy after the phone spike: the pan stopped dead when the finger lifted).
 *
 * Both run inside the pan controller's own `requestAnimationFrame` loop, so the
 * culler still reads the exact offset every frame and nothing else owns the
 * position. Both are closed form in the real frame time `dt`, so they cover the
 * same distance at 60 and 120 frames per second. Pure: no DOM, no clock.
 */

import type { Point } from "./view";

export interface InertiaConfig {
  /** Time constant of the glide's exponential decay, in ms. */
  readonly tau: number;
  /** Pointer samples younger than this at release set the release velocity, in ms. */
  readonly velocityWindow: number;
  /** Release speed cap, in px/s. */
  readonly maxVelocity: number;
}

export const DEFAULT_INERTIA: InertiaConfig = {
  tau: 325,
  velocityWindow: 100,
  maxVelocity: 4000,
};

/** A glide stops once it is slower than this, in px/s. */
export const STOP_VELOCITY = 8;

/** Time constant of the ease a discrete wheel notch or an arrow key moves with, in ms. */
export const EASE_TAU = 80;

/** An ease snaps to its target once less than this is left on both axes, in px. */
export const EASE_SNAP = 0.5;

/** The longest frame a motion step trusts, in ms, so a stall or a hidden tab never throws the view. */
export const MAX_FRAME_DT = 64;

/** A pan that ends with fewer than this many ms between its window's samples has no measurable velocity. */
const MIN_SAMPLE_SPAN = 8;

/** One pointer position, in client px, at a time in ms. */
export interface PointerSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export const clampDt = (dt: number): number => Math.min(MAX_FRAME_DT, Math.max(0, dt));

const capSpeed = (v: Point, max: number): Point => {
  const speed = Math.hypot(v.x, v.y);
  return speed > max ? { x: (v.x / speed) * max, y: (v.y / speed) * max } : v;
};

/**
 * The view velocity, in px/s, of a drag released at `now`, from the pointer
 * samples inside the velocity window. The view moves against the pointer, so
 * the sign is flipped. A finger that rested before it lifted leaves no sample
 * in the window, and the glide is zero.
 */
export function releaseVelocity(
  samples: readonly PointerSample[],
  now: number,
  config: InertiaConfig = DEFAULT_INERTIA,
): Point {
  const recent = samples.filter((s) => now - s.t <= config.velocityWindow);
  if (recent.length < 2) return { x: 0, y: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = last.t - first.t;
  if (span < MIN_SAMPLE_SPAN) return { x: 0, y: 0 };
  const v = { x: ((first.x - last.x) / span) * 1000, y: ((first.y - last.y) / span) * 1000 };
  return capSpeed(v, config.maxVelocity);
}

/**
 * One frame of glide: `v ← v · exp(−dt/τ)`, and the exact distance that decay
 * covers in `dt`, `v · τ · (1 − exp(−dt/τ))`. Being the integral rather than
 * `v · dt`, splitting a span into more frames never changes the total.
 */
export function decayStep(velocity: Point, dt: number, tau: number): { velocity: Point; delta: Point } {
  const t = clampDt(dt) / 1000;
  const tauS = tau / 1000;
  const keep = Math.exp(-t / tauS);
  const travel = tauS * (1 - keep);
  let next = { x: velocity.x * keep, y: velocity.y * keep };
  if (Math.hypot(next.x, next.y) < STOP_VELOCITY) next = { x: 0, y: 0 };
  return { velocity: next, delta: { x: velocity.x * travel, y: velocity.y * travel } };
}

/**
 * One frame of ease toward a target `remaining` px away: it covers the share
 * `1 − exp(−dt/τ)` of what is left, and snaps the last half pixel.
 */
export function easeStep(remaining: Point, dt: number, tau = EASE_TAU): { remaining: Point; delta: Point } {
  const share = 1 - Math.exp(-clampDt(dt) / tau);
  const left = { x: remaining.x * (1 - share), y: remaining.y * (1 - share) };
  if (Math.abs(left.x) < EASE_SNAP && Math.abs(left.y) < EASE_SNAP) {
    return { remaining: { x: 0, y: 0 }, delta: remaining };
  }
  return { remaining: left, delta: { x: remaining.x - left.x, y: remaining.y - left.y } };
}

/** The whole distance a glide released at `velocity` travels before it stops, ignoring edges: about `v · τ`. */
export const glideDistance = (velocity: Point, tau: number): Point => ({
  x: (velocity.x * tau) / 1000,
  y: (velocity.y * tau) / 1000,
});

/**
 * Below this a pixel mode wheel delta reads as a trackpad: small continuous
 * deltas that the operating system already smooths with its own momentum.
 */
export const DISCRETE_WHEEL_MIN = 50;

/**
 * True for a wheel event from a notched mouse wheel, which eases; false for a
 * trackpad, which is applied as is. A delta in lines or pages is always a
 * wheel. In pixel mode a notch arrives as one whole number of at least 50 px on
 * a single axis (Chrome reports 100 or 120), where a trackpad sends small,
 * often fractional deltas, usually on both axes at once.
 */
export function isDiscreteWheel(e: { deltaX: number; deltaY: number; deltaMode: number }): boolean {
  if (e.deltaMode !== 0) return true;
  const oneAxis = (e.deltaX === 0) !== (e.deltaY === 0);
  const value = e.deltaX === 0 ? e.deltaY : e.deltaX;
  return oneAxis && Number.isInteger(value) && Math.abs(value) >= DISCRETE_WHEEL_MIN;
}
