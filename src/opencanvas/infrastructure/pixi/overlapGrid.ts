import type { Bounds2d } from '../../domain/geometry/types';

/** Shared edges and anti-aliased strokes are not an overlap: two boxes must cross by more than this, in world px. */
const TOUCH = 0.5;
const CELL = 512;
/** A box over more cells than this is checked by a scan instead of bucketed. */
const MAX_CELLS = 1024;

// One number per cell, no string per lookup. Past ±16.7M world px keys repeat, which only costs a comparison.
const cellKey = (x: number, y: number): number => (x + 32_768) * 65_536 + (y + 32_768);

const crosses = (left: Bounds2d, right: Bounds2d): boolean =>
  left.x + TOUCH < right.x + right.width && right.x + TOUCH < left.x + left.width
  && left.y + TOUCH < right.y + right.height && right.y + TOUCH < left.y + left.height;

/**
 * The boxes already painted in one overlap layer, bucketed by a uniform grid so a page of thousands of shapes stays
 * linear: `hits` asks whether a box crosses any of them.
 */
export class OverlapGrid {
  private readonly cells = new Map<number, Bounds2d[]>();
  private readonly wide: Bounds2d[] = [];
  private readonly all: Bounds2d[] = [];

  hits(box: Bounds2d): boolean {
    const range = this.range(box);
    if (!range) return this.all.some((other) => crosses(box, other));
    if (this.wide.some((other) => crosses(box, other))) return true;
    for (let x = range.x0; x <= range.x1; x += 1) {
      for (let y = range.y0; y <= range.y1; y += 1) {
        if (this.cells.get(cellKey(x, y))?.some((other) => crosses(box, other))) return true;
      }
    }
    return false;
  }

  add(box: Bounds2d): void {
    if (box.width <= 0 || box.height <= 0) return;
    this.all.push(box);
    const range = this.range(box);
    if (!range) {
      this.wide.push(box);
      return;
    }
    for (let x = range.x0; x <= range.x1; x += 1) {
      for (let y = range.y0; y <= range.y1; y += 1) {
        const key = cellKey(x, y);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(box);
        else this.cells.set(key, [box]);
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.wide.length = 0;
    this.all.length = 0;
  }

  /** Cell range of a box, or null when it spans too many cells to bucket. */
  private range(box: Bounds2d): { x0: number; x1: number; y0: number; y1: number } | null {
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.width) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.height) / CELL);
    return (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS ? null : { x0, x1, y0, y1 };
  }
}
