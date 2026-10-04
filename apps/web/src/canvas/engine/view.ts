/**
 * View arithmetic for the discovery canvas pan (spec 0004, AC-L8).
 *
 * The view is the world coordinate of the viewport's top left corner. The world
 * element is moved by `translate3d(-view.x, -view.y, 0)`, so a larger view.x shows
 * content further right. Pure: no DOM, no clock.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Clamp one axis: 0 at the low edge, `world - viewport` at the high edge, 0 when the world is smaller. */
function clampAxis(value: number, viewport: number, world: number): number {
  const max = Math.max(0, world - viewport);
  return Math.min(max, Math.max(0, value));
}

/** The nearest view that keeps the viewport inside the world bounds. */
export function clampView(view: Point, viewport: Size, world: Size): Point {
  return {
    x: clampAxis(view.x, viewport.width, world.width),
    y: clampAxis(view.y, viewport.height, world.height),
  };
}

/**
 * The axis aligned bounds of a rect rotated by `rotDeg` degrees about its top
 * left corner, the same pivot the layout's clearance check uses. Tiles are drawn
 * with `transform-origin: 0 0` to match.
 */
export function rotatedBounds(rect: Rect, rotDeg: number): Rect {
  if (rotDeg === 0) return rect;
  const angle = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs = [0, rect.w * cos, rect.w * cos - rect.h * sin, -rect.h * sin];
  const ys = [0, rect.w * sin, rect.w * sin + rect.h * cos, rect.h * cos];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: rect.x + left,
    y: rect.y + top,
    w: Math.max(...xs) - left,
    h: Math.max(...ys) - top,
  };
}
