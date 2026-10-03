/**
 * The discovery canvas pan controller (spec 0004, AC-L8, AC-L15).
 *
 * Binds pointer drag (mouse, touch, pen), the wheel and the arrow keys on the
 * canvas element, and moves the world element with one `translate3d` write per
 * animation frame. Input handlers only add to a pending delta; the frame clamps
 * the view to the world bounds, writes the transform, then reports the view.
 *
 * The canvas needs `touch-action: none` (so the browser neither scrolls nor
 * zooms the page under a drag) and `tabIndex` for the keys. The world element is
 * a zero size container with no `will-change`, so the browser never allocates a
 * layer the size of the world.
 */

import { keyDelta, startDrag, wheelDelta, type DragGesture } from "./input";
import { clampView, type Point, type Size } from "./view";

export interface PanControllerOptions {
  readonly canvas: HTMLElement;
  readonly world: HTMLElement;
  readonly worldSize: Size;
  readonly initialView?: Point;
  /** Called once per frame in which the view or the viewport changed, after the transform is written. */
  readonly onView?: (view: Point, viewport: Size) => void;
}

export interface PanController {
  readonly view: Point;
  /** Move the view by a delta, applied (and clamped) on the next frame. */
  panBy(delta: Point): void;
  destroy(): void;
}

export function createPanController(options: PanControllerOptions): PanController {
  const { canvas, world, worldSize, onView } = options;

  let viewport: Size = { width: canvas.clientWidth, height: canvas.clientHeight };
  let view = clampView(options.initialView ?? { x: 0, y: 0 }, viewport, worldSize);
  let pendingX = 0;
  let pendingY = 0;
  let frame = 0;
  let dirty = true;

  // Only the first pointer drives the pan. A second finger is ignored, not a pinch.
  let pointerId: number | null = null;
  let gesture: DragGesture | null = null;
  let suppressClick = false;

  const render = () => {
    frame = 0;
    const next = clampView({ x: view.x + pendingX, y: view.y + pendingY }, viewport, worldSize);
    pendingX = 0;
    pendingY = 0;
    if (!dirty && next.x === view.x && next.y === view.y) return;
    view = next;
    dirty = false;
    world.style.transform = `translate3d(${-view.x}px, ${-view.y}px, 0)`;
    onView?.(view, viewport);
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const panBy = (delta: Point) => {
    pendingX += delta.x;
    pendingY += delta.y;
    schedule();
  };

  const endPointer = () => {
    if (gesture?.panning) suppressClick = true;
    pointerId = null;
    gesture = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId = e.pointerId;
    gesture = startDrag(e.clientX, e.clientY);
    suppressClick = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || !gesture) return;
    const wasPanning = gesture.panning;
    const delta = gesture.move(e.clientX, e.clientY);
    if (gesture.panning && !wasPanning) {
      // From here the drag belongs to the canvas, even when the pointer leaves it.
      canvas.setPointerCapture(e.pointerId);
    }
    if (delta.x !== 0 || delta.y !== 0) panBy(delta);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === pointerId) endPointer();
  };

  // A touch is implicitly captured by the tile it went down on. Moving the capture
  // to the canvas fires `lostpointercapture` on that tile, which bubbles here and
  // must not end the drag: only the canvas losing capture does.
  const onLostCapture = (e: PointerEvent) => {
    if (e.target === canvas) onPointerUp(e);
  };

  // Capture phase, so a pan that started on a tile never reaches the tile's link.
  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // A trackpad pinch arrives as ctrl + wheel. There is no zoom, so it does nothing.
    if (e.ctrlKey) return;
    panBy(wheelDelta(e, viewport));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = keyDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    panBy(delta);
  };

  // Links and images are draggable by default; a native drag would steal the pan.
  const onDragStart = (e: DragEvent) => e.preventDefault();

  const resize = new ResizeObserver(() => {
    viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    dirty = true;
    schedule();
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("lostpointercapture", onLostCapture);
  canvas.addEventListener("click", onClick, true);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("dragstart", onDragStart);
  resize.observe(canvas);
  schedule();

  return {
    get view() {
      return view;
    },
    panBy,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("lostpointercapture", onLostCapture);
      canvas.removeEventListener("click", onClick, true);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("dragstart", onDragStart);
    },
  };
}
