import { describe, expect, it } from 'vitest';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { applyDocumentCommand } from './execute';
import { createEmptyV2Document } from '../../presentation/v2/v2Document';
import { buildGroupCommand, buildUngroupCommand, buildWrapCommand, refitGroups } from './groupNodes';
import { descendantIds } from '../scene/queries';
import { buildDeleteSelectionCommand, buildDuplicateSelectionCommand } from './sceneEdits';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../scene/worldGeometry';
import type { ScenePage } from '../document/types';

function page(): ScenePage {
  return createTestDocument({ nodes: [
    createTestNode('a', { transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: { width: 100, height: 50 } }),
    createTestNode('b', { transform: { translation: { x: 300, y: 200 }, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: { width: 100, height: 50 } }),
  ] }).pages[0];
}
const run = (p: ScenePage, command: ReturnType<typeof buildGroupCommand>) =>
  applyDocumentCommand({ ...createEmptyV2Document('d'), pages: [p] }, command!);

describe('group / ungroup', () => {
  it('wraps roots in a quiet group, keeps world positions, and ungroup inverts', () => {
    const grouped = run(page(), buildGroupCommand(page(), ['a', 'b'], 'g')).document.pages[0];
    const group = grouped.nodes.find((n) => n.id === 'g')!;
    expect(group).toMatchObject({ kind: 'group', content: { label: '' }, transform: { translation: { x: 84, y: 84 } }, size: { width: 332, height: 182 } });
    const matrices = buildNodeWorldMatrices(grouped);
    expect(nodeWorldBounds(grouped.nodes.find((n) => n.id === 'b')!, matrices.get('b')!)).toMatchObject({ x: 300, y: 200 });
    expect(descendantIds(grouped, ['g'])).toEqual(['a', 'b']);
    // Corrupt parent cycles terminate instead of hanging the walk.
    const cyclic = createTestDocument({ nodes: [
      createTestNode('x', { parentId: 'y' }), createTestNode('y', { parentId: 'x' }),
    ] }).pages[0];
    expect(descendantIds(cyclic, ['x'])).toEqual(['y']);
    expect(buildGroupCommand(grouped, ['a', 'b'], 'g2')).toBeNull(); // nested: not supported
    const ungrouped = run(grouped, buildUngroupCommand(grouped, ['g'])).document.pages[0];
    expect(ungrouped.nodes.map((n) => [n.id, n.parentId])).toEqual([['a', null], ['b', null]]);
    expect(ungrouped.nodes.find((n) => n.id === 'b')!.transform.translation).toEqual({ x: 300, y: 200 });
  });
  it('ungroups two groups in one step and undoes it', () => {
    const four = createTestDocument({ nodes: ['a', 'b', 'c', 'd'].map((id, index) => createTestNode(id, {
      transform: { translation: { x: (index % 2) * 100, y: Math.floor(index / 2) * 300 }, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: { width: 50, height: 50 },
    })) }).pages[0];
    const one = run(four, buildGroupCommand(four, ['a', 'b'], 'g1')).document.pages[0];
    const two = run(one, buildGroupCommand(one, ['c', 'd'], 'g2')).document.pages[0];
    const applied = run(two, buildUngroupCommand(two, ['g1', 'g2']));
    expect(applied.document.pages[0].nodes.map((n) => [n.id, n.parentId])).toEqual([['a', null], ['b', null], ['c', null], ['d', null]]);
    expect(applyDocumentCommand(applied.document, applied.inverse).document.pages[0]).toEqual(two);
  });
  it('duplicate and delete take the subtree; members keep their local transform', () => {
    const grouped = run(page(), buildGroupCommand(page(), ['a', 'b'], 'g')).document.pages[0];
    let n = 0;
    const duplicated = run(grouped, buildDuplicateSelectionCommand(grouped, ['g'], [], () => `copy${n++}`)).document.pages[0];
    expect(duplicated.nodes).toHaveLength(6);
    const copyGroup = duplicated.nodes.find((node) => node.kind === 'group' && node.id !== 'g')!;
    const copyChildren = duplicated.nodes.filter((node) => node.parentId === copyGroup.id);
    expect(copyChildren).toHaveLength(2);
    expect(copyGroup.transform.translation).toEqual({ x: 104, y: 104 });
    expect(copyChildren.map((node) => node.transform.translation)).toEqual([{ x: 16, y: 16 }, { x: 216, y: 116 }]);
    const deleted = run(grouped, buildDeleteSelectionCommand(grouped, ['g'], [])).document.pages[0];
    expect(deleted.nodes).toHaveLength(0);
  });

  it('needs two roots and refuses duplicate ids', () => {
    expect(buildGroupCommand(page(), ['a'], 'g')).toBeNull();
    expect(() => buildGroupCommand(page(), ['a', 'b'], 'a')).toThrow(RangeError);
    expect(buildUngroupCommand(page(), ['a'])).toBeNull();
  });
});

describe('wrap in section', () => {
  it('pads for the title chip, names it, and ungroup dissolves it', () => {
    const page = createTestDocument({ nodes: [
      createTestNode('a', { transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } } }),
    ] }).pages[0];
    const wrap = buildWrapCommand(page, ['a'], 's1', 'section');
    expect(wrap?.kind).toBe('batch');
    const section = wrap && wrap.kind === 'batch' && wrap.commands[0].kind === 'insert-node' ? wrap.commands[0].node : null;
    expect(section).toMatchObject({ kind: 'section', content: { label: 'Section' }, transform: { translation: { x: 76, y: 44 } } });
    expect(section?.size).toEqual({ width: 148, height: 130 });
    const wrapped = { ...page, nodes: [...page.nodes.map((node) => node.id === 'a' ? { ...node, parentId: 's1' } : node), section!] };
    expect(buildUngroupCommand(wrapped, ['s1'])?.commands.map((command) => command.kind)).toEqual(['set-node', 'remove-node']);
  });
});

describe('a group hugs its members', () => {
  it('re-fits when a member moves out of it; every member keeps its place on the canvas', () => {
    const grouped = run(page(), buildGroupCommand(page(), ['a', 'b'], 'g')).document.pages[0];
    const worldOf = (p: ScenePage, id: string) => nodeWorldBounds(p.nodes.find((n) => n.id === id)!, buildNodeWorldMatrices(p).get(id)!);
    const a = grouped.nodes.find((node) => node.id === 'a')!;
    // a (local 16,16) moves 100 left and 50 up: past the group's top-left corner.
    const movedA = { ...a, transform: { ...a.transform, translation: { x: -84, y: -34 } } };
    const { before, after } = refitGroups(grouped, [a], [movedA]);
    expect(before.map((node) => node.id)).toEqual(['a', 'g', 'b']);
    const next = { ...grouped, nodes: grouped.nodes.map((node) => after.find((record) => record.id === node.id) ?? node) };
    expect(worldOf(next, 'a')).toMatchObject({ x: 0, y: 50 });
    expect(worldOf(next, 'b')).toMatchObject({ x: 300, y: 200 });
    expect(worldOf(next, 'g')).toEqual({ x: -16, y: 34, width: 432, height: 232 });
  });

  it('leaves records outside a group, and a moved group itself, as they are', () => {
    const grouped = run(page(), buildGroupCommand(page(), ['a', 'b'], 'g')).document.pages[0];
    const g = grouped.nodes.find((node) => node.id === 'g')!;
    const movedG = { ...g, transform: { ...g.transform, translation: { x: 0, y: 0 } } };
    expect(refitGroups(grouped, [g], [movedG])).toEqual({ before: [g], after: [movedG] });
  });
});
