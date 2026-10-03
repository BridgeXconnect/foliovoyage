/**
 * Section grid culler for the discovery canvas (spec 0004, AC-L7).
 *
 * The world is cut into square sections. Each item is indexed once into every
 * section its bounds touch, so finding what to mount is arithmetic on the view
 * plus a few map lookups, with no per tile observers. Pure: no DOM, no clock.
 */

import type { Point, Rect, Size } from "./view";

/** An inclusive range of section columns and rows. */
export interface SectionRange {
  readonly col0: number;
  readonly col1: number;
  readonly row0: number;
  readonly row1: number;
}

export interface CullerConfig {
  /** Section edge in px. */
  readonly sectionSize: number;
  /** Extra sections mounted on every side of the ones the viewport touches. */
  readonly overscan: number;
}

/**
 * The sections the viewport touches, widened by the overscan and cut to the
 * world's section grid. A viewport edge that lands exactly on a section line does
 * not touch the next section.
 */
export function sectionRange(view: Point, viewport: Size, world: Size, config: CullerConfig): SectionRange {
  const { sectionSize, overscan } = config;
  const lastCol = Math.ceil(world.width / sectionSize) - 1;
  const lastRow = Math.ceil(world.height / sectionSize) - 1;
  const col0 = Math.floor(view.x / sectionSize) - overscan;
  const row0 = Math.floor(view.y / sectionSize) - overscan;
  const col1 = Math.ceil((view.x + viewport.width) / sectionSize) - 1 + overscan;
  const row1 = Math.ceil((view.y + viewport.height) / sectionSize) - 1 + overscan;
  return {
    col0: Math.max(0, col0),
    row0: Math.max(0, row0),
    col1: Math.min(lastCol, col1),
    row1: Math.min(lastRow, row1),
  };
}

export const sameRange = (a: SectionRange, b: SectionRange): boolean =>
  a.col0 === b.col0 && a.col1 === b.col1 && a.row0 === b.row0 && a.row1 === b.row1;

/** Item indexes per section, keyed by `col * KEY_STRIDE + row`. */
export interface SectionIndex {
  readonly sectionSize: number;
  readonly cells: ReadonlyMap<number, readonly number[]>;
}

/** Rows per column in a section key. Far above any real grid (the world is 13 sections tall at 512 px). */
const KEY_STRIDE = 1 << 16;

/** Index each item into every section its bounds touch. `bounds[i]` is item i's world bounds. */
export function buildSectionIndex(bounds: readonly Rect[], sectionSize: number): SectionIndex {
  const cells = new Map<number, number[]>();
  bounds.forEach((b, i) => {
    const col0 = Math.max(0, Math.floor(b.x / sectionSize));
    const row0 = Math.max(0, Math.floor(b.y / sectionSize));
    const col1 = Math.max(col0, Math.ceil((b.x + b.w) / sectionSize) - 1);
    const row1 = Math.max(row0, Math.ceil((b.y + b.h) / sectionSize) - 1);
    for (let col = col0; col <= col1; col++) {
      for (let row = row0; row <= row1; row++) {
        const key = col * KEY_STRIDE + row;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  return { sectionSize, cells };
}

/** The indexes of every item in the range, each once, in ascending order. */
export function itemsInRange(index: SectionIndex, range: SectionRange): number[] {
  const seen = new Set<number>();
  for (let col = range.col0; col <= range.col1; col++) {
    for (let row = range.row0; row <= range.row1; row++) {
      const list = index.cells.get(col * KEY_STRIDE + row);
      if (list) for (const i of list) seen.add(i);
    }
  }
  return [...seen].sort((a, b) => a - b);
}
