import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { drawioToDocument, looksLikeDrawio } from './drawio';
import flow from './fixtures/drawio/flow.drawio?raw';

const NOW = '2026-10-18T00:00:00.000Z';

async function open(text: string): Promise<{ document: SceneDocumentV1; losses: readonly string[] }> {
  const result = await drawioToDocument(text, 'doc', NOW);
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** How draw.io compresses a page: URI-encode, raw-deflate, base64. */
const compress = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');

describe('looksLikeDrawio', () => {
  it('knows an mxfile and a bare graph model, and nothing else', () => {
    expect(looksLikeDrawio(flow)).toBe(true);
    expect(looksLikeDrawio('<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel><root/></mxGraphModel>')).toBe(true);
    expect(looksLikeDrawio('{"format":"openflowkit.scene"}')).toBe(false);
    expect(looksLikeDrawio('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
  });
});

describe('drawioToDocument', () => {
  it('keeps each page, with its shapes where draw.io put them', async () => {
    const { document } = await open(flow);
    expect(document.pages.map((page) => page.name)).toEqual(['Checkout', 'Services']);
    const [checkout] = document.pages;
    const byId = new Map(checkout!.nodes.map((node) => [node.id, node]));
    expect(byId.get('start')).toMatchObject({
      kind: 'process', content: { shape: 'ellipse', label: 'Start' },
      transform: { translation: { x: 40, y: 40 } }, size: { width: 120, height: 60 },
      appearance: { fill: '#d5e8d4', stroke: '#82b366' },
    });
    expect(byId.get('check')!.content.shape).toBe('diamond');
    expect(byId.get('pay')).toMatchObject({ content: { shape: 'rounded', label: 'Take\npayment' }, appearance: { fontWeight: 700, textColor: '#333333' } });
    expect(byId.get('db')!.content.shape).toBe('cylinder');
  });

  it('turns edges into connectors with their labels, heads, dashes and bends', async () => {
    const { document } = await open(flow);
    const connectors = new Map(document.pages[0]!.connectors.map((connector) => [connector.id, connector]));
    expect(connectors.get('e1')).toMatchObject({
      source: { nodeId: 'start' }, target: { nodeId: 'check' },
      route: { kind: 'orthogonal', ownership: 'automatic' }, appearance: { markerEnd: 'arrow' },
    });
    expect(connectors.get('e2')).toMatchObject({
      labels: [{ text: 'yes', pathRatio: 0.5 }], waypoints: [{ x: 380, y: 20 }],
      route: { kind: 'polyline', ownership: 'imported-fixed' },
      appearance: { markerEnd: 'arrow', dashPattern: 'dashed', stroke: '#ff0000' },
    });
    expect(connectors.get('e3')).toMatchObject({ labels: [{ text: 'writes', pathRatio: 0.25 }], appearance: { markerStart: 'circle' } });
    expect(connectors.get('e3')!.appearance.markerEnd).toBeUndefined();
    // An edge ending on empty canvas keeps its free end.
    expect(connectors.get('loose')!.target).toEqual({ nodeId: null, portId: null, anchor: null, point: { x: 600, y: 300 } });
  });

  it('keeps containers, their children in container space, layers and their visibility', async () => {
    const { document, losses } = await open(flow);
    const services = document.pages[1]!;
    expect(services.layers).toEqual([
      { id: 'layer:1', name: 'Base', visible: true, locked: false },
      { id: 'layer:2', name: 'Annotations', visible: false, locked: false },
    ]);
    const byId = new Map(services.nodes.map((node) => [node.id, node]));
    expect(byId.get('lane')).toMatchObject({ kind: 'swimlane', content: { label: 'Backend' }, parentId: null });
    expect(byId.get('api')).toMatchObject({ parentId: 'lane', transform: { translation: { x: 20, y: 40 } } });
    expect(byId.get('worker')).toMatchObject({ parentId: 'lane', content: { label: 'Worker', shape: 'rectangle' } });
    expect(byId.get('note')).toMatchObject({ kind: 'text', layerId: 'layer:2', content: { label: 'TODO' } });
    // A bend inside a container is container space in draw.io, page space here.
    expect(services.connectors[0]!.waypoints).toEqual([{ x: 240, y: 220 }]);
    expect(losses).toContain('Services: “Worker”: draw.io’s “mxgraph.aws4.lambda_function” shape is drawn as a box');
  });

  it('reads compressed pages the way draw.io writes them', async () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="a" value="Hello &amp; welcome" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>';
    const { document, losses } = await open(`<mxfile><diagram name="Zipped" id="z">${compress(model)}</diagram></mxfile>`);
    expect(document.pages[0]!.nodes[0]).toMatchObject({ id: 'a', content: { label: 'Hello & welcome', shape: 'rectangle' } });
    expect(losses).toEqual([]);
  });

  it('says what came across badly instead of dropping it silently', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { losses } = await open(model(
      '<mxCell id="a" value="A" style="rotation=45;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="e" value="nowhere" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>'
      + '<mxCell id="o" edge="1" style="edgeStyle=orthogonalEdgeStyle;" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="5"/></Array></mxGeometry></mxCell>',
    ));
    expect(losses).toEqual([
      '“A”: rotation was dropped',
      'connector “nowhere”: it has a loose end, so it was left out',
      'connector 1: its bends are re-routed',
    ]);
  });

  it('refuses what it cannot read, saying why', async () => {
    expect(await drawioToDocument('<mxfile><diagram>', 'doc', NOW)).toEqual({ error: 'It isn’t a readable draw.io file (<diagram> is never closed).' });
    expect(await drawioToDocument('<mxfile></mxfile>', 'doc', NOW)).toEqual({ error: 'It has no draw.io pages in it.' });
    expect(await drawioToDocument('<mxfile><diagram name="P">!!!not base64</diagram></mxfile>', 'doc', NOW))
      .toEqual({ error: 'None of its pages could be read: “P”: a page is compressed in a way OpenFlowKit can’t read, so it was left out' });
    expect(await drawioToDocument('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>', 'doc', NOW))
      .toEqual({ error: 'It has no shapes or connectors in it.' });
  });
});
