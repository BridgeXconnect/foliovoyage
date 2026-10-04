/**
 * The discovery canvas pan controller (spec 0004, AC-L8, AC-L15).
 *
 * Binds pointer drag (mouse, touch, pen), the wheel and the arrow keys on the
 * canvas element, and moves the world element with one `translate3d` write per
 * animation frame. Input handlers only add to a pending delta, a glide or an
 * ease; the frame advances them, clamps the view to the world bounds, writes
 * the transform, then reports the view.
 *
 * Motion (`motion.ts`): while a finger is down the world follows it 1:1. On
 * release it glides with exponential decay from the velocity of the last pointer
 * samples. A pointer down during a glide stops it, and that tap never opens a
 * tile. A notched wheel and the arrow keys ease to their target; a trackpad is
 * applied as is, since the system already adds momentum. With
 * `prefers-reduced-motion` there is no glide and no easing. All of it runs in
 * this one frame loop, so the culler always reads the exact offset.
 *
 * The canvas needs `touch-action: none` (so the browser neither scrolls nor
 * zooms the page under a drag) and `tabIndex` for the keys. The world element is
 * a zero size container with no `will-change`, so the browser never allocates a
 * layer the size of the world.
 */

import { keyDelta, startDrag, wheelDelta, type DragGesture } from "./input";
import {
  DEFAULT_INERTIA,
  STOP_VELOCITY,
  clampDt,
  decayStep,
  easeStep,
  isDiscreteWheel,
  releaseVelocity,
  type InertiaConfig,
  type PointerSample,
} from "./motion";
import { clampView, type Point, type Size } from "./view";

export interface PanControllerOptions {
  readonly canvas: HTMLElement;
  readonly world: HTMLElement;
  readonly worldSize: Size;
  readonly initialView?: Point;
  /** Called once per frame in which the view or the viewport changed, after the transform is written. */
  readonly onView?: (view: Point, viewport: Size) => void;
  /**
   * Called on every user input that pans the view (a drag move past the
   * threshold, a wheel event, an arrow key), when a panning drag ends, and on
   * every frame a glide or an ease moves the view. Not called for `panBy` from
   * code, a tap, or a drag still inside the threshold.
   */
  readonly onPanInput?: () => void;
  readonly inertia?: InertiaConfig;
  /** Read at each gesture. True turns the glide and the easing off. Defaults to `prefers-reduced-motion`. */
  readonly reducedMotion?: () => boolean;
  /** Clock in ms, on the same time base as `requestAnimationFrame` timestamps. Defaults to `performance.now`. */
  readonly now?: () => number;
}

export interface PanController {
  readonly view: Point;
  /** True while a release glide is moving the view. */
  readonly gliding: boolean;
  /** Move the view by a delta, applied (and clamped) on the next frame. */
  panBy(delta: Point): void;
  /** Move the view by a delta with a short ease, or at once under reduced motion. */
  easeBy(delta: Point): void;
  destroy(): void;
}

const ZERO: Point = { x: 0, y: 0 };
const isZero = (p: Point) => p.x === 0 && p.y === 0;

function prefersReducedMotion(): () => boolean {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  return () => query?.matches ?? false;
}

export function createPanController(options: PanControllerOptions): PanController {
  const { canvas, world, worldSize, onView, onPanInput } = options;
  const inertia = options.inertia ?? DEFAULT_INERTIA;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  const now = options.now ?? (() => performance.now());

  let viewport: Size = { width: canvas.clientWidth, height: canvas.clientHeight };
  let view = clampView(options.initialView ?? ZERO, viewport, worldSize);
  let pendingX = 0;
  let pendingY = 0;
  let frame = 0;
  let dirty = true;

  // Glide velocity in px/s and the distance an ease still has to go, in px.
  let glide: Point = ZERO;
  let ease: Point = ZERO;
  // The time the last motion frame ran, or 0 when no glide or ease is running.
  let motionClock = 0;

  // Only the first pointer drives the pan. A second finger is ignored, not a pinch.
  let pointerId: number | null = null;
  let gesture: DragGesture | null = null;
  let samples: PointerSample[] = [];
  let suppressClick = false;

  const inMotion = () => !isZero(glide) || !isZero(ease);

  const render = (t: number) => {
    frame = 0;
    let dx = pendingX;
    let dy = pendingY;
    pendingX = 0;
    pendingY = 0;

    const moving = inMotion();
    if (moving) {
      const dt = clampDt(t - motionClock);
      motionClock = t;
      if (!isZero(glide)) {
        const step = decayStep(glide, dt, inertia.tau);
        glide = step.velocity;
        dx += step.delta.x;
        dy += step.delta.y;
      }
      if (!isZero(ease)) {
        const step = easeStep(ease, dt);
        ease = step.remaining;
        dx += step.delta.x;
        dy += step.delta.y;
      }
    }

    const target = { x: view.x + dx, y: view.y + dy };
    const next = clampView(target, viewport, worldSize);
    // An edge stops the motion on its axis, so a glide never presses into it.
    if (next.x !== target.x) {
      glide = { x: 0, y: glide.y };
      ease = { x: 0, y: ease.y };
    }
    if (next.y !== target.y) {
      glide = { x: glide.x, y: 0 };
      ease = { x: ease.x, y: 0 };
    }

    if (inMotion()) schedule();
    else motionClock = 0;

    if (!dirty && next.x === view.x && next.y === view.y) return;
    view = next;
    dirty = false;
    world.style.transform = `translate3d(${-view.x}px, ${-view.y}px, 0)`;
    if (moving) onPanInput?.();
    onView?.(view, viewport);
  };

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  const startMotion = () => {
    if (!motionClock) motionClock = now();
    schedule();
  };

  const stopMotion = () => {
    glide = ZERO;
    ease = ZERO;
    motionClock = 0;
  };

  const panBy = (delta: Point) => {
    pendingX += delta.x;
    pendingY += delta.y;
    schedule();
  };

  const easeBy = (delta: Point) => {
    glide = ZERO;
    if (reducedMotion()) {
      panBy(delta);
      return;
    }
    ease = { x: ease.x + delta.x, y: ease.y + delta.y };
    startMotion();
  };

  const panByInput = (delta: Point) => {
    onPanInput?.();
    panBy(delta);
  };

  const sample = (x: number, y: number) => {
    const t = now();
    samples.push({ t, x, y });
    // Keep only what a release could still read.
    while (samples.length > 2 && t - samples[0].t > inertia.velocityWindow) samples.shift();
  };

  const endPointer = (release: boolean) => {
    if (gesture?.panning) {
      suppressClick = true;
      onPanInput?.();
      if (release && !reducedMotion()) {
        const v = releaseVelocity(samples, now(), inertia);
        if (Math.hypot(v.x, v.y) >= STOP_VELOCITY) {
          glide = v;
          startMotion();
        }
      }
    }
    pointerId = null;
    gesture = null;
    samples = [];
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A touch that lands on a glide only stops it: its click never opens a tile.
    const halted = !isZero(glide);
    stopMotion();
    pointerId = e.pointerId;
    gesture = startDrag(e.clientX, e.clientY);
    samples = [];
    sample(e.clientX, e.clientY);
    suppressClick = halted;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || !gesture) return;
    sample(e.clientX, e.clientY);
    const wasPanning = gesture.panning;
    const delta = gesture.move(e.clientX, e.clientY);
    if (gesture.panning && !wasPanning) {
      // From here the drag belongs to the canvas, even when the pointer leaves it.
      canvas.setPointerCapture(e.pointerId);
    }
    if (delta.x !== 0 || delta.y !== 0) panByInput(delta);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    sample(e.clientX, e.clientY);
    endPointer(true);
  };

  // The system took the pointer (a back swipe, a scroll): end the drag, no glide.
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) endPointer(false);
  };

  // A touch is implicitly captured by the tile it went down on. Moving the capture
  // to the canvas fires `lostpointercapture` on that tile, which bubbles here and
  // must not end the drag: only the canvas losing capture does. After a normal
  // `pointerup` the drag is already over and this does nothing.
  const onLostCapture = (e: PointerEvent) => {
    if (e.target === canvas) onPointerCancel(e);
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
    const delta = wheelDelta(e, viewport);
    onPanInput?.();
    if (isDiscreteWheel(e)) {
      easeBy(delta);
    } else {
      stopMotion();
      panBy(delta);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = keyDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    onPanInput?.();
    easeBy(delta);
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
  canvas.addEventListener("pointercancel", onPointerCancel);
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
    get gliding() {
      return !isZero(glide);
    },
    panBy,
    easeBy,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("lostpointercapture", onLostCapture);
      canvas.removeEventListener("click", onClick, true);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("dragstart", onDragStart);
    },
  };
}
