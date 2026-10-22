import { describe, expect, it } from 'vitest';
import { createBounds2d } from '../../domain/geometry/bounds';
import { OverlapGrid } from './overlapGrid';

describe('OverlapGrid', () => {
  it('finds a box that crosses one already added, not one beside it', () => {
    const grid = new OverlapGrid();
    grid.add(createBounds2d(0, 0, 100, 50));
    expect(grid.hits(createBounds2d(80, 30, 100, 50))).toBe(true);
    // Shared edge, or a hair of stroke across it: side by side, not stacked.
    expect(grid.hits(createBounds2d(100, 0, 100, 50))).toBe(false);
    expect(grid.hits(createBounds2d(99.8, 0, 100, 50))).toBe(false);
    expect(grid.hits(createBounds2d(0, 60, 100, 50))).toBe(false);
  });

  it('finds overlaps across cell borders, negative coordinates and boxes that hold others', () => {
    const grid = new OverlapGrid();
    grid.add(createBounds2d(500, -20, 40, 40));
    expect(grid.hits(createBounds2d(530, 10, 10, 10))).toBe(true);
    expect(grid.hits(createBounds2d(-10_000, -10_000, 20_000, 20_000))).toBe(true);
    expect(grid.hits(createBounds2d(510, -10, 5, 5))).toBe(true);
  });

  it('checks huge boxes by scan, ignores empty ones, and forgets everything on clear', () => {
    const grid = new OverlapGrid();
    grid.add(createBounds2d(-1e6, 0, 2e6, 10));
    expect(grid.hits(createBounds2d(123_456, 2, 4, 4))).toBe(true);
    grid.add(createBounds2d(5, 5, 0, 100));
    grid.clear();
    expect(grid.hits(createBounds2d(123_456, 2, 4, 4))).toBe(false);
    grid.add(createBounds2d(0, 500, 0, 0));
    expect(grid.hits(createBounds2d(-1, 499, 2, 2))).toBe(false);
  });
});
