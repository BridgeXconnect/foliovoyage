/**
 * Input rules for the discovery canvas pan (spec 0004, AC-L8): the drag
 * threshold, wheel delta normalisation and arrow key steps. Pure: the pan
 * controller feeds it plain numbers and strings, never DOM events.
 */

import type { Point } from "./view";

/** A drag longer than this, in px, is a pan and suppresses the click under the pointer. */
export const DRAG_THRESHOLD = 6;

/** Distance one arrow key press moves the view, in px. */
export const KEY_STEP = 80;

/** Pixels per line for a wheel event reported in lines (`deltaMode` 1, Firefox with a mouse). */
export const WHEEL_LINE_HEIGHT = 16;

/**
 * One pointer's drag. `move` returns how far the view should move since the last
 * call, which is nothing until the pointer has travelled past the threshold.
 * Crossing it releases the whole distance at once, so the content never lags
 * behind the finger.
 */
export interface DragGesture {
  move(x: number, y: number): Point;
  /** True once the pointer has moved more than the threshold from where it went down. */
  readonly panning: boolean;
}

export function startDrag(x: number, y: number, threshold = DRAG_THRESHOLD): DragGesture {
  let panning = false;
  let lastX = x;
  let lastY = y;
  return {
    move(nx, ny) {
      if (!panning) {
        if (Math.hypot(nx - x, ny - y) <= threshold) return { x: 0, y: 0 };
        panning = true;
      }
      // Dragging content right moves the view left: the view delta is the negated pointer delta.
      const delta = { x: lastX - nx, y: lastY - ny };
      lastX = nx;
      lastY = ny;
      return delta;
    },
    get panning() {
      return panning;
    },
  };
}

/** A wheel event's delta in px. Shift with a vertical-only wheel scrolls sideways, as browsers do. */
export function wheelDelta(
  e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  pageSize: { width: number; height: number },
): Point {
  const scale =
    e.deltaMode === 1 ? { x: WHEEL_LINE_HEIGHT, y: WHEEL_LINE_HEIGHT } :
    e.deltaMode === 2 ? { x: pageSize.width, y: pageSize.height } :
    { x: 1, y: 1 };
  if (e.shiftKey && e.deltaX === 0) return { x: e.deltaY * scale.x, y: 0 };
  return { x: e.deltaX * scale.x, y: e.deltaY * scale.y };
}

/** The view delta for an arrow key, or null for any other key. */
export function keyDelta(key: string, step = KEY_STEP): Point | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}
