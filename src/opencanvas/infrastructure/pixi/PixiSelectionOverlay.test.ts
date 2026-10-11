import { describe, expect, it } from 'vitest';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { PixiSelectionOverlay } from './PixiSelectionOverlay';

const rects = (overlay: PixiSelectionOverlay) =>
  overlay.graphics.context.instructions.filter((instruction) => instruction.action === 'stroke').length;

describe('PixiSelectionOverlay', () => {
  // Found 2026-10-11 (U4-07): after a marquee only the group box showed, so you could not tell what it caught.
  it('outlines each item of a multi-selection under the group box', () => {
    const page = createTestDocument({ nodes: [createTestNode('a'), createTestNode('b', { transform: { translation: { x: 300, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } } })] }).pages[0]!;
    const index = createSceneIndex(page);
    // Read-only: the frame alone, no handles, so the only difference is the per-item hairlines.
    const single = new PixiSelectionOverlay();
    single.draw(index, ['a'], 'a', 1, null, null, null, false);
    const many = new PixiSelectionOverlay();
    many.draw(index, ['a', 'b'], 'a', 1, null, null, null, false);
    expect(rects(many)).toBeGreaterThanOrEqual(rects(single) + 2);
  });
});
