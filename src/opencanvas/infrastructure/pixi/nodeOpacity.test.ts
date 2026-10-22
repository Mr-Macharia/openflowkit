import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { PixiNodeRenderer } from './PixiNodeRenderer';

describe('Pixi node opacity', () => {
  it('dims the label container of a basic node by appearance.opacity', () => {
    const dimmed = createTestNode('dimmed', { appearance: { opacity: 0.2 } });
    // Beside, not on top: a covering shape would paint in an overlap layer of its own.
    const plain = createTestNode('plain', { transform: { translation: { x: 200, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const page = createTestDocument({ nodes: [dimmed, plain] }).pages[0];
    const renderer = new PixiNodeRenderer();
    renderer.draw(page, createSceneIndex(page));
    // The first child of `labels` holds the text of shapes that no other shape covers.
    const text = renderer.labels.children[0] as Container;
    expect(text.children[0]?.alpha).toBeCloseTo(0.2);
    expect(text.children[1]?.alpha).toBe(1);
  });
});
