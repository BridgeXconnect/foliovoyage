import { describe, expect, it } from "@jest/globals";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@folio/shared";
import { DRAG_THRESHOLD, KEY_STEP, WHEEL_LINE_HEIGHT, keyDelta, startDrag, wheelDelta } from "./input";
import { buildSectionIndex, itemsInRange, sameRange, sectionRange } from "./sections";
import { clampView, rotatedBounds } from "./view";

const world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
const phone = { width: 390, height: 844 };

describe("clampView", () => {
  it("keeps a view inside the world unchanged", () => {
    expect(clampView({ x: 1000, y: 500 }, phone, world)).toEqual({ x: 1000, y: 500 });
  });

  it("stops at the top left edge", () => {
    expect(clampView({ x: -40, y: -1 }, phone, world)).toEqual({ x: 0, y: 0 });
  });

  it("stops where the viewport's far edge meets the world's far edge", () => {
    expect(clampView({ x: 1e6, y: 1e6 }, phone, world)).toEqual({
      x: WORLD_WIDTH - phone.width,
      y: WORLD_HEIGHT - phone.height,
    });
  });

  it("pins to 0 on an axis where the viewport is larger than the world", () => {
    expect(clampView({ x: 30, y: 30 }, { width: 900, height: 900 }, { width: 600, height: 2000 })).toEqual({
      x: 0,
      y: 30,
    });
  });
});

describe("rotatedBounds", () => {
  it("returns the rect itself when there is no rotation", () => {
    const rect = { x: 10, y: 20, w: 100, h: 50 };
    expect(rotatedBounds(rect, 0)).toBe(rect);
  });

  it("covers every corner rotated about the top left", () => {
    const rect = { x: 100, y: 100, w: 360, h: 320 };
    for (const rot of [1.5, -1.5]) {
      const b = rotatedBounds(rect, rot);
      const a = (rot * Math.PI) / 180;
      for (const [u, v] of [[0, 0], [rect.w, 0], [rect.w, rect.h], [0, rect.h]]) {
        const x = rect.x + u * Math.cos(a) - v * Math.sin(a);
        const y = rect.y + u * Math.sin(a) + v * Math.cos(a);
        expect(x).toBeGreaterThanOrEqual(b.x - 1e-9);
        expect(x).toBeLessThanOrEqual(b.x + b.w + 1e-9);
        expect(y).toBeGreaterThanOrEqual(b.y - 1e-9);
        expect(y).toBeLessThanOrEqual(b.y + b.h + 1e-9);
      }
      expect(b.w).toBeGreaterThan(rect.w);
      expect(b.h).toBeGreaterThan(rect.h);
    }
  });
});

describe("sectionRange", () => {
  const config = { sectionSize: 512, overscan: 1 };

  it("covers the sections the viewport touches plus the overscan", () => {
    // x 1000..1390 touches columns 1 and 2; y 600..1444 touches rows 1 and 2.
    expect(sectionRange({ x: 1000, y: 600 }, phone, world, config)).toEqual({
      col0: 0,
      col1: 3,
      row0: 0,
      row1: 3,
    });
  });

  it("does not count a section the viewport edge only meets", () => {
    // x 0..512 exactly fills column 0.
    const range = sectionRange({ x: 0, y: 0 }, { width: 512, height: 512 }, world, { sectionSize: 512, overscan: 0 });
    expect(range).toEqual({ col0: 0, col1: 0, row0: 0, row1: 0 });
  });

  it("cuts the overscan at the world's edges", () => {
    const end = clampView({ x: 1e6, y: 1e6 }, phone, world);
    const range = sectionRange(end, phone, world, { sectionSize: 512, overscan: 2 });
    expect(range.col1).toBe(Math.ceil(WORLD_WIDTH / 512) - 1);
    expect(range.row1).toBe(Math.ceil(WORLD_HEIGHT / 512) - 1);
    expect(sectionRange({ x: 0, y: 0 }, phone, world, { sectionSize: 512, overscan: 2 }).col0).toBe(0);
  });

  it("changes only when the view crosses a section line", () => {
    const a = sectionRange({ x: 520, y: 0 }, phone, world, config);
    const b = sectionRange({ x: 530, y: 0 }, phone, world, config);
    const c = sectionRange({ x: 1030, y: 0 }, phone, world, config);
    expect(sameRange(a, b)).toBe(true);
    expect(sameRange(a, c)).toBe(false);
  });
});

describe("section index", () => {
  const bounds = [
    { x: 10, y: 10, w: 100, h: 100 }, // section (0, 0)
    { x: 500, y: 10, w: 100, h: 100 }, // straddles columns 0 and 1
    { x: 2000, y: 2000, w: 50, h: 50 }, // section (3, 3)
  ];
  const index = buildSectionIndex(bounds, 512);

  it("finds an item from every section it touches, once", () => {
    expect(itemsInRange(index, { col0: 0, col1: 0, row0: 0, row1: 0 })).toEqual([0, 1]);
    expect(itemsInRange(index, { col0: 1, col1: 1, row0: 0, row1: 0 })).toEqual([1]);
    expect(itemsInRange(index, { col0: 0, col1: 1, row0: 0, row1: 0 })).toEqual([0, 1]);
  });

  it("leaves out items outside the range", () => {
    expect(itemsInRange(index, { col0: 2, col1: 2, row0: 0, row1: 2 })).toEqual([]);
    expect(itemsInRange(index, { col0: 0, col1: 5, row0: 0, row1: 5 })).toEqual([0, 1, 2]);
  });
});

describe("startDrag", () => {
  it("does not pan within the threshold", () => {
    const drag = startDrag(100, 100);
    expect(drag.move(100 + DRAG_THRESHOLD, 100)).toEqual({ x: 0, y: 0 });
    expect(drag.move(104, 104)).toEqual({ x: 0, y: 0 }); // 5.66 px
    expect(drag.panning).toBe(false);
  });

  it("pans past the threshold and releases the whole distance at once", () => {
    const drag = startDrag(100, 100);
    expect(drag.move(103, 100)).toEqual({ x: 0, y: 0 });
    expect(drag.move(107, 100)).toEqual({ x: -7, y: 0 });
    expect(drag.panning).toBe(true);
    expect(drag.move(117, 90)).toEqual({ x: -10, y: 10 });
  });

  it("stays panning when the pointer comes back near its start", () => {
    const drag = startDrag(0, 0);
    drag.move(20, 0);
    expect(drag.move(1, 0)).toEqual({ x: 19, y: 0 });
    expect(drag.panning).toBe(true);
  });
});

describe("wheelDelta", () => {
  const page = { width: 390, height: 844 };
  const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false };

  it("passes pixel deltas through", () => {
    expect(wheelDelta({ ...wheel, deltaX: 12, deltaY: -30 }, page)).toEqual({ x: 12, y: -30 });
  });

  it("scales line and page deltas", () => {
    expect(wheelDelta({ ...wheel, deltaY: 3, deltaMode: 1 }, page)).toEqual({ x: 0, y: 3 * WHEEL_LINE_HEIGHT });
    expect(wheelDelta({ ...wheel, deltaX: 1, deltaMode: 2 }, page)).toEqual({ x: 390, y: 0 });
  });

  it("turns shift with a vertical wheel into a sideways pan", () => {
    expect(wheelDelta({ ...wheel, deltaY: 40, shiftKey: true }, page)).toEqual({ x: 40, y: 0 });
  });
});

describe("keyDelta", () => {
  it("maps the arrow keys and ignores the rest", () => {
    expect(keyDelta("ArrowRight")).toEqual({ x: KEY_STEP, y: 0 });
    expect(keyDelta("ArrowUp")).toEqual({ x: 0, y: -KEY_STEP });
    expect(keyDelta("Enter")).toBeNull();
  });
});
