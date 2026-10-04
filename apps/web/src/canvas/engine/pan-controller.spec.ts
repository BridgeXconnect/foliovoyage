/**
 * The pan controller in a node env: a fake canvas (an EventTarget with a size),
 * a fake world (a style bag), and a manual animation frame queue, so each test
 * drives pointer events and frames at times it chooses.
 */

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { createPanController, type PanController } from "./pan-controller";
import { DEFAULT_INERTIA } from "./motion";

const VIEWPORT = { width: 400, height: 800 };
const WORLD = { width: 10_000, height: 4_000 };

let clock = 0;
let frames: Array<(t: number) => void> = [];

/** Run animation frames `ms` apart until none is scheduled, or `limit` frames. */
function runFrames(ms: number, limit = 10_000) {
  let n = 0;
  while (frames.length && n < limit) {
    const queue = frames;
    frames = [];
    clock += ms;
    for (const f of queue) f(clock);
    n++;
  }
  return n;
}

function fakeCanvas() {
  const target = new EventTarget() as EventTarget & {
    clientWidth: number;
    clientHeight: number;
    setPointerCapture: (id: number) => void;
  };
  target.clientWidth = VIEWPORT.width;
  target.clientHeight = VIEWPORT.height;
  target.setPointerCapture = () => {};
  return target;
}

function event<T extends object>(type: string, init: T) {
  const e = new Event(type, { cancelable: true }) as Event & T;
  Object.assign(e, init);
  return e;
}

const pointer = (type: string, x: number, y: number) =>
  event(type, { pointerId: 1, pointerType: "touch", button: 0, clientX: x, clientY: y });

let canvas: ReturnType<typeof fakeCanvas>;
let world: { style: { transform: string } };
let controller: PanController;
let reduced = false;

function create(initialView = { x: 5000, y: 2000 }) {
  controller = createPanController({
    canvas: canvas as unknown as HTMLElement,
    world: world as unknown as HTMLElement,
    worldSize: WORLD,
    initialView,
    reducedMotion: () => reduced,
    now: () => clock,
  });
  runFrames(16);
}

/** Drag from x0 to x1 over `ms`, one move per 16 ms frame, then lift. */
function flick(x0: number, x1: number, ms: number, y = 400) {
  canvas.dispatchEvent(pointer("pointerdown", x0, y));
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    clock += 16;
    canvas.dispatchEvent(pointer("pointermove", x0 + ((x1 - x0) * i) / steps, y));
    // The drag's own frame, scheduled by the move.
    const queue = frames;
    frames = [];
    for (const f of queue) f(clock);
  }
  canvas.dispatchEvent(pointer("pointerup", x1, y));
}

beforeEach(() => {
  clock = 1000;
  frames = [];
  reduced = false;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  canvas = fakeCanvas();
  world = { style: { transform: "" } };
});

afterEach(() => controller?.destroy());

describe("pan controller release inertia", () => {
  it("follows the finger 1:1 while it is down", () => {
    create();
    flick(300, 100, 160);
    // The drag moved the view by exactly the finger's travel before any glide frame ran.
    expect(controller.view.x).toBe(5200);
  });

  it("glides on release in the direction of the drag, and stops", () => {
    create();
    flick(300, 100, 160);
    expect(controller.gliding).toBe(true);
    const before = controller.view.x;
    runFrames(16);
    expect(controller.gliding).toBe(false);
    // About v·τ: 200 px over 160 ms is 1250 px/s, so roughly 400 px of glide.
    const glide = controller.view.x - before;
    expect(glide).toBeGreaterThan(350);
    expect(glide).toBeLessThan((1250 * DEFAULT_INERTIA.tau) / 1000 + 1);
  });

  it("glides the same distance at 60 and 120 frames per second", () => {
    create();
    flick(300, 100, 160);
    const start = controller.view.x;
    runFrames(1000 / 60);
    const at60 = controller.view.x - start;
    controller.destroy();

    canvas = fakeCanvas();
    world = { style: { transform: "" } };
    create();
    flick(300, 100, 160);
    const start120 = controller.view.x;
    runFrames(1000 / 120);
    const at120 = controller.view.x - start120;

    expect(at120).toBeCloseTo(at60, 0);
  });

  it("does not glide when the finger rested before it lifted", () => {
    create();
    canvas.dispatchEvent(pointer("pointerdown", 300, 400));
    clock += 16;
    canvas.dispatchEvent(pointer("pointermove", 200, 400));
    runFrames(16);
    clock += 400;
    canvas.dispatchEvent(pointer("pointerup", 200, 400));
    expect(controller.gliding).toBe(false);
  });

  it("zeroes the velocity on an axis that hits the world edge", () => {
    // Start 50 px from the left edge and flick the content right, so the view moves left.
    create({ x: 50, y: 2000 });
    canvas.dispatchEvent(pointer("pointerdown", 100, 400));
    clock += 16;
    canvas.dispatchEvent(pointer("pointermove", 120, 380));
    runFrames(16, 1);
    clock += 16;
    canvas.dispatchEvent(pointer("pointermove", 140, 360));
    runFrames(16, 1);
    canvas.dispatchEvent(pointer("pointerup", 140, 360));
    expect(controller.gliding).toBe(true);
    const yBefore = controller.view.y;

    runFrames(16, 30);
    expect(controller.view.x).toBe(0);
    // The x axis stopped at the edge; y kept gliding down the world.
    expect(controller.view.y).toBeGreaterThan(yBefore);
    runFrames(16);
    expect(controller.view.x).toBe(0);
    expect(controller.gliding).toBe(false);
  });

  it("stops a glide on touch down, and that tap never opens a tile", () => {
    create();
    flick(300, 100, 160);
    runFrames(16, 3);
    expect(controller.gliding).toBe(true);

    canvas.dispatchEvent(pointer("pointerdown", 200, 400));
    expect(controller.gliding).toBe(false);
    const held = controller.view.x;
    runFrames(16);
    expect(controller.view.x).toBe(held);

    canvas.dispatchEvent(pointer("pointerup", 200, 400));
    const click = event("click", {});
    canvas.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    // The next tap, with no glide under it, goes through.
    canvas.dispatchEvent(pointer("pointerdown", 200, 400));
    canvas.dispatchEvent(pointer("pointerup", 200, 400));
    const next = event("click", {});
    canvas.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });

  it("suppresses the click after a drag, but not after a tap", () => {
    create();
    flick(300, 100, 160);
    const afterDrag = event("click", {});
    canvas.dispatchEvent(afterDrag);
    expect(afterDrag.defaultPrevented).toBe(true);
  });

  it("has no glide and no easing under reduced motion", () => {
    reduced = true;
    create();
    flick(300, 100, 160);
    expect(controller.gliding).toBe(false);
    expect(controller.view.x).toBe(5200);

    canvas.dispatchEvent(event("keydown", { key: "ArrowRight" }));
    expect(runFrames(16)).toBe(1);
    expect(controller.view.x).toBe(5280);
  });
});

describe("pan controller wheel and keys", () => {
  it("eases an arrow key to its target over several frames", () => {
    create();
    canvas.dispatchEvent(event("keydown", { key: "ArrowRight" }));
    const n = runFrames(16);
    expect(n).toBeGreaterThan(3);
    expect(controller.view.x).toBeCloseTo(5080, 9);
  });

  it("eases a notched wheel and applies a trackpad delta at once", () => {
    create();
    canvas.dispatchEvent(event("wheel", { deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: false, ctrlKey: false }));
    expect(runFrames(16)).toBeGreaterThan(3);
    expect(controller.view.y).toBeCloseTo(2100, 9);

    canvas.dispatchEvent(event("wheel", { deltaX: 3.5, deltaY: 7.25, deltaMode: 0, shiftKey: false, ctrlKey: false }));
    expect(runFrames(16)).toBe(1);
    expect(controller.view.x).toBe(5003.5);
    expect(controller.view.y).toBeCloseTo(2107.25, 9);
  });
});
