import { describe, expect, it } from 'vitest';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import { createPixiSpikePage } from './spikeFixture';
import { PixiContainerRenderer } from './PixiContainerRenderer';
import { PixiNodeRenderer } from './PixiNodeRenderer';

describe('Pixi node renderer', () => {
  // A v1 import once handed the canvas 0-wide class and architecture nodes; one
  // negative rect threw and took the whole renderer down with it.
  it.each([
    { width: 0, height: 0 },
    { width: 1, height: 1 },
    { width: 12, height: 8 },
  ])('draws every node kind at $width×$height without throwing', (size) => {
    const spike = createPixiSpikePage(40);
    const page = { ...spike, nodes: spike.nodes.map((node) => ({ ...node, size })) };
    const index = createSceneIndex(page);

    expect(() => new PixiNodeRenderer().draw(page, index)).not.toThrow();
    expect(() => new PixiContainerRenderer().draw(page, index)).not.toThrow();
  });

  // #92: Reorder changes zIndex, never array position, so painting in array order left the canvas unchanged.
  it('paints shapes and containers in zIndex order, not array order', () => {
    const spike = createPixiSpikePage(13);
    const page = { ...spike, nodes: spike.nodes.map((node, at) => ({ ...node, zIndex: 100 - at })) };
    const index = createSceneIndex(page);
    const painted = (renderer: PixiNodeRenderer | PixiContainerRenderer, ids: readonly string[]) => {
      renderer.draw(page, index);
      return renderer.getDebugSnapshot().map(({ id }) => id).filter((id) => ids.includes(id));
    };

    expect(painted(new PixiNodeRenderer(), ['node-0', 'node-1', 'node-2', 'node-3', 'node-4']))
      .toEqual(['node-4', 'node-3', 'node-2', 'node-1', 'node-0']);
    expect(painted(new PixiContainerRenderer(), ['node-10', 'node-11', 'node-12']))
      .toEqual(['node-12', 'node-11', 'node-10']);
  });
});
