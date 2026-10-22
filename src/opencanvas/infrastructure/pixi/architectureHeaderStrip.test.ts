import { Graphics, Text, type Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { PixiNodeRenderer } from './PixiNodeRenderer';
import { stripFont } from './pixiText';

function drawCard(zoom: number): Container {
  const card = createTestNode('card', {
    kind: 'architecture',
    size: { width: 180, height: 72 },
    content: { label: 'core/', archProvider: 'Group', archResourceType: 'TypeScript' },
  });
  const page = createTestDocument({ nodes: [card] }).pages[0];
  const renderer = new PixiNodeRenderer();
  renderer.draw(page, createSceneIndex(page));
  // Map boxes hide their 10 px header text below 60 %; the strip behind it must go too (R19).
  renderer.setLabelVisibility(new Set(['card']), zoom);
  return (renderer.labels.children[0] as Container).children[0] as Container;
}

describe('architecture card header strip', () => {
  it('hides with its header text when zoomed out, so no empty grey bar stays above the title', () => {
    const label = drawCard(0.5);
    const strip = label.children.find((child) => child instanceof Graphics && stripFont(child) !== null);
    expect(strip, 'the strip draws with the label').toBeDefined();
    expect(strip!.visible).toBe(false);
    const texts = label.children.filter((child): child is Text => child instanceof Text);
    expect(texts.filter((text) => text.visible).map((text) => text.text)).toEqual(['core/']);
  });

  it('shows with it at 100 %', () => {
    const label = drawCard(1);
    expect(label.children.filter((child) => stripFont(child) !== null).every((child) => child.visible)).toBe(true);
    expect(label.children.filter((child) => child instanceof Text && !child.visible)).toEqual([]);
  });
});
