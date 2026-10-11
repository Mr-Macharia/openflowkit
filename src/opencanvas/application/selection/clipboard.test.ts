import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { buildPasteProductionSelectionCommand, copyProductionSelection, pastePlacement } from './clipboard';
import type { ScenePage } from '../../domain/document/types';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../../domain/scene/worldGeometry';

describe('production clipboard', () => {
  it('copies a hierarchy and internal connectors, remaps ids, offsets, and reverses atomically', () => {
    const root = createTestNode('root', { zIndex: 1 });
    const child = createTestNode('child', { parentId: 'root', zIndex: 2 });
    const outside = createTestNode('outside');
    const document = createTestDocument({ nodes: [root, child, outside], connectors: [{
      id: 'edge', source: { nodeId: 'root', portId: null, anchor: null, point: null },
      target: { nodeId: 'child', portId: null, anchor: null, point: null },
      route: { kind: 'direct', ownership: 'automatic' }, waypoints: [], labels: [],
      appearance: {}, semantics: {}, metadata: {}, extensions: {},
    }] });
    const snapshot = copyProductionSelection(document.pages[0], ['root']);
    let sequence = 0;
    const result = buildPasteProductionSelectionCommand(document.pages[0], snapshot,
      (kind) => `${kind}-copy-${++sequence}`, { offset: { x: 10, y: 20 }, keepParents: true });
    const applied = applyDocumentCommand(document, result.command);
    expect(result.pastedNodeIds).toEqual(['node-copy-1', 'node-copy-2']);
    expect(applied.document.pages[0].nodes.at(-1)).toMatchObject({ id: 'node-copy-2', parentId: 'node-copy-1' });
    expect(applied.document.pages[0].connectors.at(-1)).toMatchObject({
      id: 'connector-copy-3', source: { nodeId: 'node-copy-1' }, target: { nodeId: 'node-copy-2' },
    });
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
  });
});

describe('where a paste lands', () => {
  const at = (id: string, x: number, y: number, overrides: Parameters<typeof createTestNode>[1] = {}) =>
    createTestNode(id, { transform: { translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } }, ...overrides });
  const view = { x: 0, y: 0, width: 1000, height: 800 };
  const paste = (page: ScenePage, ids: readonly string[], viewport = view) => {
    const snapshot = copyProductionSelection(page, ids);
    let sequence = 0;
    const result = buildPasteProductionSelectionCommand(page, snapshot, (kind) => `${kind}-p${++sequence}`, pastePlacement(snapshot, viewport));
    const document = createTestDocument({ nodes: [...page.nodes], connectors: [...page.connectors] });
    const applied = applyDocumentCommand(document, result.command);
    const next = applied.document.pages[0]!;
    const world = (id: string) => nodeWorldBounds(next.nodes.find((node) => node.id === id)!, buildNodeWorldMatrices(next).get(id)!);
    const parent = (id: string) => next.nodes.find((node) => node.id === id)!.parentId;
    return { ids: result.pastedNodeIds, world, parent, undone: applyDocumentCommand(applied.document, applied.inverse).document, document };
  };
  // Two sections, each holding one shape: s1 at (100,100) with a at local (24,56); s2 at (500,100) with b at local (24,56).
  const sections = () => createTestDocument({ nodes: [
    at('s1', 100, 100, { kind: 'section', size: { width: 200, height: 160 } }), at('a', 24, 56, { parentId: 's1' }),
    at('s2', 500, 100, { kind: 'section', size: { width: 200, height: 160 } }), at('b', 24, 56, { parentId: 's2' }),
  ] }).pages[0]!;

  it('steps off the original while that spot is in view', () => {
    const page = createTestDocument({ nodes: [at('n', 100, 100)] }).pages[0]!;
    expect(pastePlacement(copyProductionSelection(page, ['n']), view)).toEqual({ offset: { x: 24, y: 24 }, keepParents: true });
  });

  it('lands in the middle of the view, on the page itself, when the original is out of sight (Figma, tldraw)', () => {
    const page = createTestDocument({ nodes: [at('n', 5000, -3000)] }).pages[0]!;
    // The 100×50 node is centred on (500, 400).
    expect(pastePlacement(copyProductionSelection(page, ['n']), view)).toEqual({ offset: { x: 450 - 5000, y: 375 + 3000 }, keepParents: false });
  });

  it('a shape copied out of a section lands a step off where it is on the canvas, in that section (as ⌘D does), one undo', () => {
    const { ids: [copy], world, parent, undone, document } = paste(sections(), ['a']);
    expect(world(copy!)).toMatchObject({ x: 100 + 24 + 24, y: 100 + 56 + 24 });
    expect(parent(copy!)).toBe('s1');
    expect(undone).toEqual(document);
  });

  it('out of sight, it lands at the view centre on the page, at its own size', () => {
    const { ids: [copy], world, parent } = paste(sections(), ['a'], { x: 5000, y: 5000, width: 1000, height: 800 });
    expect(parent(copy!)).toBeNull();
    expect(world(copy!)).toEqual({ x: 5450, y: 5375, width: 100, height: 50 });
  });

  it('a whole section pastes with its children where they were relative to it', () => {
    const { ids, world, parent } = paste(sections(), ['s1']);
    const [section, child] = ids;
    expect(parent(section!)).toBeNull();
    expect(parent(child!)).toBe(section);
    expect(world(section!)).toMatchObject({ x: 124, y: 124 });
    expect(world(child!)).toMatchObject({ x: 148, y: 180 });
  });

  it('a selection across two sections lands each shape a step off itself, in its own section', () => {
    const { ids: [copyA, copyB], world, parent } = paste(sections(), ['a', 'b']);
    expect([parent(copyA!), parent(copyB!)]).toEqual(['s1', 's2']);
    expect(world(copyA!)).toMatchObject({ x: 148, y: 180 });
    expect(world(copyB!)).toMatchObject({ x: 548, y: 180 });
  });

  it('a section that is gone (another page, deleted) leaves the copy on the page at its canvas spot', () => {
    const page = sections();
    const snapshot = copyProductionSelection(page, ['a']);
    const elsewhere = createTestDocument({ nodes: [] }).pages[0]!;
    const result = buildPasteProductionSelectionCommand(elsewhere, snapshot, (kind) => `${kind}-x`, pastePlacement(snapshot, view));
    const inserted = result.command.kind === 'batch' && result.command.commands[0]!.kind === 'insert-node' ? result.command.commands[0].node : null;
    expect(inserted).toMatchObject({ parentId: null, transform: { translation: { x: 148, y: 180 } } });
  });
});
