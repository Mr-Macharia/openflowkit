import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from './execute';
import { buildLayerMoveCommand, layerDropAllowed, layerFrontFirst, layerPaintEdges } from './layerMove';
import type { SceneNode, ScenePage } from '../document/types';
import { createEmptyV2Document } from '../../presentation/v2/v2Document';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';

const at = (x: number, y: number) => ({ translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } });
const pageOf = (nodes: SceneNode[]): ScenePage => createTestDocument({ nodes }).pages[0]!;
const run = (page: ScenePage, command: ReturnType<typeof buildLayerMoveCommand>) =>
  applyDocumentCommand({ ...createEmptyV2Document('d'), pages: [page] }, command!).document.pages[0]!;
const rows = (page: ScenePage, parentId: string | null = null) =>
  page.nodes.filter((node) => node.parentId === parentId).sort(layerFrontFirst).map((node) => node.id);

describe('buildLayerMoveCommand', () => {
  const flat = () => pageOf([createTestNode('a', { zIndex: 0 }), createTestNode('b', { zIndex: 1 }), createTestNode('c', { zIndex: 2 })]);

  it('reorders among siblings as one step; dropping a row where it is does nothing', () => {
    expect(rows(flat())).toEqual(['c', 'b', 'a']);
    const front = buildLayerMoveCommand(flat(), 'a', { parentId: null, index: 0 })!;
    expect(front.kind).toBe('batch');
    expect(rows(run(flat(), front))).toEqual(['a', 'c', 'b']);
    // Between b and a, with no z room between them: the page renumbers, order kept.
    expect(rows(run(flat(), buildLayerMoveCommand(flat(), 'c', { parentId: null, index: 1 })))).toEqual(['b', 'c', 'a']);
    expect(rows(run(flat(), buildLayerMoveCommand(flat(), 'c', { parentId: null, index: 2 })))).toEqual(['b', 'a', 'c']);
    expect(buildLayerMoveCommand(flat(), 'a', { parentId: null, index: 2 })).toBeNull();
  });

  it('drops into a section where the shape stands, in front of its children', () => {
    const page = pageOf([
      createTestNode('section', { kind: 'section', transform: at(100, 100), size: { width: 400, height: 300 }, zIndex: 0 }),
      createTestNode('inside', { parentId: 'section', transform: at(10, 10), zIndex: 5 }),
      createTestNode('loose', { transform: at(150, 160), zIndex: 1 }),
    ]);
    const moved = run(page, buildLayerMoveCommand(page, 'loose', { parentId: 'section', index: 0 }));
    const loose = moved.nodes.find((node) => node.id === 'loose')!;
    expect(loose.parentId).toBe('section');
    expect(loose.transform.translation).toEqual({ x: 50, y: 60 });
    expect(rows(moved, 'section')).toEqual(['loose', 'inside']);
    // And back out to the page, still where it stands.
    const out = run(moved, buildLayerMoveCommand(moved, 'loose', { parentId: null, index: 0 }));
    expect(out.nodes.find((node) => node.id === 'loose')!.transform.translation).toEqual({ x: 150, y: 160 });
  });

  it('a shape dropped into a section from outside it lands in its content area, never outside its parent', () => {
    const page = pageOf([
      createTestNode('section', { kind: 'section', transform: at(100, 100), size: { width: 400, height: 300 }, zIndex: 0 }),
      createTestNode('far', { transform: at(900, 900), zIndex: 1 }),
      createTestNode('beside', { parentId: 'section', transform: at(30, 80), zIndex: 2 }),
    ]);
    // Onto the row, and between its children: both put it top-left of the content, below the title band.
    for (const drop of [{ parentId: 'section', index: 0 }, { parentId: 'section', index: 1 }]) {
      const far = run(page, buildLayerMoveCommand(page, 'far', drop)).nodes.find((node) => node.id === 'far')!;
      expect(far.parentId).toBe('section');
      expect(far.transform.translation).toEqual({ x: 28, y: 72 });
    }
  });

  it('a container dropped among shapes stays in its paint band, under them', () => {
    const page = pageOf([createTestNode('frame', { kind: 'frame', zIndex: 9 }), createTestNode('frame2', { kind: 'frame', zIndex: 0 }), createTestNode('shape', { zIndex: 1 })]);
    expect(rows(page)).toEqual(['shape', 'frame', 'frame2']);
    expect(rows(run(page, buildLayerMoveCommand(page, 'frame2', { parentId: null, index: 0 })))).toEqual(['shape', 'frame2', 'frame']);
  });
});

describe('layerDropAllowed', () => {
  const page = () => pageOf([
    createTestNode('group', { kind: 'group', zIndex: 0 }),
    createTestNode('member', { parentId: 'group' }),
    createTestNode('section', { kind: 'section', zIndex: 1 }),
    createTestNode('inner', { kind: 'section', parentId: 'section' }),
    createTestNode('diagram', { kind: 'frame', metadata: { dsl: { family: 'flowchart' } } }),
    createTestNode('view', { kind: 'frame', metadata: { dsl: { arch: { view: 'landscape' } } } }),
    createTestNode('placed', { parentId: 'view', metadata: { model: { elementId: 'web' } } }),
    createTestNode('locked', { content: { label: 'locked', sectionLocked: true } }),
    createTestNode('hidden', { content: { label: 'hidden', sectionHidden: true } }),
    createTestNode('shut', { kind: 'section', content: { label: 'shut', sectionLocked: true } }),
    createTestNode('free'),
  ]);

  it('follows the canvas drop rules', () => {
    expect(layerDropAllowed(page(), 'free', 'section')).toBe(true);
    expect(layerDropAllowed(page(), 'free', 'group')).toBe(false); // ⌘G groups never adopt
    expect(layerDropAllowed(page(), 'free', 'diagram')).toBe(false); // regenerated from its source
    expect(layerDropAllowed(page(), 'free', 'shut')).toBe(false); // locked target
    expect(layerDropAllowed(page(), 'section', 'inner')).toBe(false); // into its own descendant
    expect(layerDropAllowed(page(), 'section', 'section')).toBe(false);
    expect(layerDropAllowed(page(), 'member', null)).toBe(false); // group members stay in their group
    expect(layerDropAllowed(page(), 'member', 'group')).toBe(true); // …but reorder inside it
    expect(layerDropAllowed(page(), 'placed', null)).toBe(false); // a model placement belongs to its view
    expect(layerDropAllowed(page(), 'placed', 'view')).toBe(true);
    expect(layerDropAllowed(page(), 'view', 'section')).toBe(false); // a C4 view frame stays put
    expect(layerDropAllowed(page(), 'locked', null)).toBe(false);
    expect(layerDropAllowed(page(), 'hidden', null)).toBe(false);
  });
});

describe('layerPaintEdges', () => {
  it('reads front and back within the paint band, so a frame under every shape can still come forward past a frame', () => {
    const page = pageOf([createTestNode('frame', { kind: 'frame', zIndex: 5 }), createTestNode('low', { kind: 'frame', zIndex: 1 }), createTestNode('shape', { zIndex: 0 })]);
    expect(layerPaintEdges(page, 'frame')).toEqual({ front: true, back: false });
    expect(layerPaintEdges(page, 'low')).toEqual({ front: false, back: true });
    expect(layerPaintEdges(page, 'shape')).toEqual({ front: true, back: true });
  });
});
