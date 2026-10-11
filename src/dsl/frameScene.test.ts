import { describe, expect, it } from 'vitest';
import type { ScenePage } from '../opencanvas/domain/document/types';
import { compile } from './compile';
import { frameScene, frameSource } from './frameScene';

async function pageOf(source: string): Promise<ScenePage> {
  const compiled = await compile(source);
  return {
    id: 'page-1', name: 'Page 1', diagramKind: compiled.meta.family,
    layers: [{ id: 'default', name: 'Layer 1', visible: true, locked: false }],
    nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes],
    connectors: compiled.connectors, metadata: {}, extensions: {},
  } as ScenePage;
}

describe('frameSource', () => {
  it('is the text that drew the frame while the canvas still matches it', async () => {
    const source = 'flowchart\n%% the checkout\nCart -> Payment\n';
    const page = await pageOf(source);
    expect(frameSource(frameScene(page, page.nodes[0]!.id)!)).toBe(source);
  });

  it('writes the canvas back as code once the canvas was edited', async () => {
    const page = await pageOf('flowchart\nCart -> Payment\n');
    const edited = { ...page, nodes: page.nodes.map((node) => node.content.label === 'Payment'
      ? { ...node, content: { ...node.content, label: 'Stripe' } } : node) };
    const code = frameSource(frameScene(edited, edited.nodes[0]!.id)!);
    expect(code).toContain('Stripe');
    expect(code).not.toContain('Payment');
  });
});
