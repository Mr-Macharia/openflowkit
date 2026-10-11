import { describe, expect, it } from 'vitest';
import { createTestNode } from '../../testing/builders/documentBuilder';
import { resolveNodeStyle } from './nodeStyle';
import { architectureCardHeight, architectureCardLayout } from './architectureCardLayout';

describe('architecture card text layout', () => {
  it('bounds long titles, technology and descriptions without overlap', () => {
    const node = createTestNode('card', {
      kind: 'architecture',
      size: { width: 240, height: 152 },
      content: {
        label: 'Order processing service with a long descriptive title',
        archProviderLabel: 'Container',
        archResourceType: 'A very long technology choice',
        archEnvironment:
          'This service validates orders and distributes them to downstream services. '.repeat(10),
      },
    });
    const layout = architectureCardLayout(node, resolveNodeStyle(node));
    expect(layout.title.lines.length).toBeLessThanOrEqual(2);
    expect(layout.detail.lines.length).toBeLessThanOrEqual(2);
    expect(layout.detailY).toBeGreaterThan(layout.titleY + layout.title.height);
    expect(layout.detailY + layout.detail.height).toBeLessThan(node.size.height);
    expect(layout.detail.truncated).toBe(true);
    expect(layout.resource.truncated).toBe(true);
  });

  it('gives the element type the header space the technology does not need', () => {
    const node = createTestNode('card', {
      kind: 'architecture',
      size: { width: 240, height: 152 },
      content: { label: 'Shop', archProviderLabel: 'Software system', archResourceType: 'React' },
    });
    const layout = architectureCardLayout(node, resolveNodeStyle(node));
    expect(layout.provider.displayText).toBe('Software system');
    expect(layout.resource.displayText).toBe('React');
    expect(layout.provider.width + layout.resource.width).toBeLessThanOrEqual(240 - 64);
  });

  it('shows a technology whole when the element type leaves it room', () => {
    const node = createTestNode('card', {
      kind: 'architecture',
      size: { width: 240, height: 152 },
      content: { label: 'Checkout Web', archProviderLabel: 'Container', archResourceType: 'React, TypeScript' },
    });
    const layout = architectureCardLayout(node, resolveNodeStyle(node));
    expect(layout.resource.displayText).toBe('React, TypeScript');
    expect(layout.provider.displayText).toBe('Container');
    expect(layout.provider.width + layout.resource.width).toBeLessThanOrEqual(240 - 64);
  });

  it('sizes a card to what it says: the whole title and detail fit, and nothing is left below them', () => {
    const card = (label: string, detail?: string) => createTestNode('card', {
      kind: 'architecture', size: { width: 240, height: 152 },
      content: { label, archProviderLabel: 'Module', archResourceType: 'Python', ...(detail ? { archEnvironment: detail } : {}) },
    });
    for (const node of [card('vote', '1 file'), card('kustomize/components/shopping-assistant/scripts/', '1 file'), card('worker'), card('3 more modules', 'Fewer connections; open to list them.')]) {
      const style = resolveNodeStyle(node);
      const height = architectureCardHeight(node, style);
      expect(height, String(node.content.label)).toBeLessThan(152);
      const fitted = architectureCardLayout({ ...node, size: { ...node.size, height } }, style);
      const roomy = architectureCardLayout({ ...node, size: { ...node.size, height: 1000 } }, style);
      expect(fitted.title.lines).toEqual(roomy.title.lines);
      expect(fitted.detail.lines).toEqual(roomy.detail.lines);
    }
    expect(architectureCardHeight(card('vote', '1 file'), resolveNodeStyle(card('vote', '1 file'))))
      .toBeLessThan(architectureCardHeight(card('kustomize/components/shopping-assistant/scripts/', '1 file'), resolveNodeStyle(card('x'))));
  });
});
