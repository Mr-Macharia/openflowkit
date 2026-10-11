import { describe, expect, it } from 'vitest';
import { dragBox, MIN_CREATE_SIZE, toolShape } from './v2PointerGestures';
import { DEFAULT_TOOL_CONFIG } from './v2ToolCatalog';

describe('square drawing', () => {
  const start = { x: 100, y: 100 };

  it('a free drag spans both extents', () => {
    expect(dragBox(start, { x: 160, y: 130 }, false)).toEqual({ at: start, size: { width: 60, height: 30 } });
  });

  it('a square drag takes the larger extent on both sides, anchored at the start corner', () => {
    expect(dragBox(start, { x: 160, y: 130 }, true)).toEqual({ at: start, size: { width: 60, height: 60 } });
    expect(dragBox(start, { x: 130, y: 40 }, true)).toEqual({ at: { x: 100, y: 40 }, size: { width: 60, height: 60 } });
    expect(dragBox(start, { x: 20, y: 90 }, true)).toEqual({ at: { x: 20, y: 20 }, size: { width: 80, height: 80 } });
  });

  it('a square drag never collapses below the minimum', () => {
    expect(dragBox(start, { x: 101, y: 101 }, true).size).toEqual({ width: MIN_CREATE_SIZE, height: MIN_CREATE_SIZE });
  });

  it('⌥ draws from the centre: the press is the middle, the box twice the drag', () => {
    expect(dragBox(start, { x: 160, y: 130 }, false, true)).toEqual({ at: { x: 40, y: 70 }, size: { width: 120, height: 60 } });
    expect(dragBox(start, { x: 160, y: 130 }, true, true)).toEqual({ at: { x: 40, y: 40 }, size: { width: 120, height: 120 } });
  });

  it('the Square tool draws a rectangle, never a node kind of its own', () => {
    expect(toolShape('square', DEFAULT_TOOL_CONFIG)).toBe('rectangle');
    expect(toolShape('select', DEFAULT_TOOL_CONFIG)).toBeNull();
  });
});
