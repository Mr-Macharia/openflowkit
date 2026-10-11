import { describe, expect, it } from 'vitest';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { applyDocumentCommand } from './execute';
import { resolveArchitectureNodePresentation } from '../nodes/architectureNodePresentation';
import { buildInsertIconCommand, buildSetIconCommand, buildSetIconPlacementCommand } from './iconCommands';

const s3 = { provider: 'aws', packId: 'aws-official-starter-v1', shapeId: 'storage-s3', label: 'S3' };

describe('icon commands', () => {
  it('changes icons on unlocked selected nodes only', () => {
    const page = createTestDocument({ nodes: [
      createTestNode('a'), createTestNode('b', { content: { sectionLocked: true } }), createTestNode('c'),
    ] }).pages[0];
    const command = buildSetIconCommand(page, ['a', 'b'], s3);
    expect(command?.kind).toBe('batch');
    expect(command && command.kind === 'batch' ? command.commands.map((c) => c.id) : []).toEqual(['icon:a']);
    expect(buildSetIconCommand(page, ['zzz'], s3)).toBeNull();
  });

  it('inserts an icon dropped on a frame as the frame\'s child', () => {
    const frame = createTestNode('f', { kind: 'section', size: { width: 400, height: 300 }, transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const page = createTestDocument({ nodes: [frame] }).pages[0]!;
    const command = buildInsertIconCommand(page, { id: 'n', at: { x: 150, y: 150 }, icon: s3 });
    expect(command.node.parentId).toBe('f');
    expect(command.node.transform.translation).toEqual({ x: 50, y: 50 });
  });

  it('inserts an icon node at the point', () => {
    const page = createTestDocument().pages[0];
    const command = buildInsertIconCommand(page, { id: 'n', at: { x: 5, y: 6 }, icon: s3 });
    expect(command.node.transform.translation).toEqual({ x: 5, y: 6 });
    expect(command.node.content.label).toBe('S3');
  });

  describe('icon placement', () => {
    const at = (x: number, y: number) => ({ translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } });
    const tile = (id: string, extra: Record<string, unknown> = {}) => createTestNode(id, {
      kind: 'architecture', size: { width: 148, height: 107 }, transform: at(100, 100),
      content: { label: 'API', assetPresentation: 'icon', icon: 'tabler/server', ...extra },
    });
    const document = createTestDocument({ nodes: [tile('a'), tile('b'), createTestNode('plain'), tile('locked', { sectionLocked: true })] });
    const page = document.pages[0]!;

    it('moves every selected tile to a row card in one batch and one undo step', () => {
      const command = buildSetIconPlacementCommand(page, ['a', 'b'], 'left')!;
      expect(command.kind === 'batch' ? command.commands.map((c) => c.id) : []).toEqual(['icon-placement:a', 'icon-placement:b']);
      const applied = applyDocumentCommand(document, command);
      const a = applied.document.pages[0]!.nodes.find((node) => node.id === 'a')!;
      expect(resolveArchitectureNodePresentation(a)!.iconPlacement).toBe('left');
      expect(a.size).toEqual({ width: 160, height: 56 });
      expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
    });

    it('keeps the card\'s centre', () => {
      const applied = applyDocumentCommand(document, buildSetIconPlacementCommand(page, ['a'], 'left')!);
      const a = applied.document.pages[0]!.nodes.find((node) => node.id === 'a')!;
      expect(a.transform.translation.x + a.size.width / 2).toBe(100 + 74);
      expect(a.transform.translation.y + a.size.height / 2).toBe(100 + 53.5);
    });

    it('skips locked cards and nodes that are not icon cards', () => {
      expect(buildSetIconPlacementCommand(page, ['locked', 'plain'], 'left')).toBeNull();
    });

    it('is null when every selected card already has that placement, and top writes no layout back', () => {
      expect(buildSetIconPlacementCommand(page, ['a'], 'top')).toBeNull();
      const left = applyDocumentCommand(document, buildSetIconPlacementCommand(page, ['a'], 'left')!).document;
      expect(buildSetIconPlacementCommand(left.pages[0]!, ['a'], 'left')).toBeNull();
      const back = applyDocumentCommand(left, buildSetIconPlacementCommand(left.pages[0]!, ['a'], 'top')!).document;
      expect(back.pages[0]!.nodes[0]!.content).not.toHaveProperty('contentLayout');
      expect(back.pages[0]!.nodes[0]!.size).toEqual({ width: 148, height: 107 });
    });
  });

  it('keeps a rotated card\'s visual centre when its size changes', () => {
    const turned = createTestNode('r', {
      kind: 'architecture', size: { width: 148, height: 107 },
      transform: { translation: { x: 300, y: 100 }, rotationRadians: Math.PI / 2, scale: { x: 1, y: 1 } },
      content: { label: 'API', assetPresentation: 'icon', icon: 'tabler/server' },
    });
    const document = createTestDocument({ nodes: [turned] });
    const after = applyDocumentCommand(document, buildSetIconPlacementCommand(document.pages[0]!, ['r'], 'left')!).document.pages[0]!.nodes[0]!;
    const centre = (node: typeof turned) => ({ x: node.transform.translation.x - node.size.height / 2, y: node.transform.translation.y + node.size.width / 2 });
    expect(centre(after).x).toBeCloseTo(centre(turned).x, 5);
    expect(centre(after).y).toBeCloseTo(centre(turned).y, 5);
  });
});
