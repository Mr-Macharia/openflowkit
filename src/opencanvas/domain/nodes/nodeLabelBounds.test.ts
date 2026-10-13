import { describe, expect, it } from 'vitest';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { createSceneIndex } from '../scene/spatialIndex';
import { measurePortableText } from '../text/measurement';
import { containerTextBounds, frameNameAt, nodeConnectBounds, nodeLabelBounds, nodeOutline } from './nodeLabelBounds';

describe('nodeLabelBounds', () => {
  it('is the whole node for basic shapes', () => {
    const node = createTestNode('a', { size: { width: 160, height: 72 } });
    expect(nodeLabelBounds(node)).toEqual({ x: 0, y: 0, width: 160, height: 72 });
  });

  it('is the title band for containers', () => {
    const group = createTestNode('g', { kind: 'group', size: { width: 300, height: 200 } });
    expect(nodeLabelBounds(group)).toEqual({ x: 16, y: 0, width: 268, height: 40 });
    const frame = createTestNode('f', { kind: 'frame', size: { width: 300, height: 200 } });
    expect(nodeLabelBounds(frame)).toEqual({ x: 16, y: 0, width: 268, height: 40 });
  });

  it('finds the preset frame whose name sits under a point above its top edge', () => {
    const at = { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } };
    const frame = createTestNode('f', { kind: 'frame', size: { width: 300, height: 200 }, transform: at, content: { preset: 'frame', label: 'VPC' } });
    const section = createTestNode('s', { kind: 'section', size: { width: 300, height: 200 }, transform: { ...at, translation: { x: 600, y: 100 } } });
    const index = createSceneIndex(createTestDocument({ nodes: [frame, section] }).pages[0]!);
    expect(frameNameAt(index, { x: 115, y: 90 })).toBe('f');
    expect(frameNameAt(index, { x: 115, y: 150 })).toBeNull();
    expect(frameNameAt(index, { x: 615, y: 90 })).toBeNull();
    // Only the name's own width: the rest of the strip above the frame stays canvas (marquee, connectors).
    expect(frameNameAt(index, { x: 300, y: 90 })).toBeNull();
  });

  it('sits under the plate for icon nodes', () => {
    const icon = createTestNode('i', {
      kind: 'architecture', size: { width: 120, height: 110 }, content: { assetPresentation: 'icon', label: 'S3' },
    });
    expect(nodeLabelBounds(icon)).toEqual({ x: 0, y: 84, width: 120, height: 26 });
  });

  it('meets an icon tile from its plate to its caption, and any other node at its silhouette', () => {
    const icon = createTestNode('i', {
      kind: 'architecture', size: { width: 148, height: 116 }, content: { assetPresentation: 'icon', label: 'S3' },
    });
    expect(nodeConnectBounds(icon)).toMatchObject({ x: 38, y: 4, width: 72 });
    expect(nodeConnectBounds(icon).height).toBeCloseTo(102.4, 5);
    expect(nodeOutline(icon)).toEqual([{ x: 38, y: 4 }, { x: 110, y: 4 }, { x: 110, y: 76 }, { x: 38, y: 76 }]);
    expect(nodeConnectBounds(createTestNode('a', { size: { width: 160, height: 72 } }))).toEqual({ x: 0, y: 0, width: 160, height: 72 });
  });
});

describe('containerTextBounds', () => {
  const title = (label: string) => measurePortableText(label, { fontSize: 14, fontWeight: 700, lineHeight: 14 * 1.2 });

  it('is the visible header text, centred in the 40px band, as wide as the words', () => {
    const group = createTestNode('g', { kind: 'group', size: { width: 300, height: 200 }, content: { label: 'Fulfilment' } });
    const [text, ...rest] = containerTextBounds(group);
    expect(rest).toEqual([]);
    expect(text!.x).toBe(16);
    expect(text!.width).toBeCloseTo(title('Fulfilment').width, 0);
    expect(text!.y + text!.height / 2).toBeCloseTo(20, 5);
    expect(text!.height).toBeGreaterThan(10);
    expect(text!.height).toBeLessThanOrEqual(40);
  });

  it('never runs past the band when the title is long', () => {
    const group = createTestNode('g', { kind: 'group', size: { width: 160, height: 200 }, content: { label: 'A title far too long for this narrow group to hold on one line' } });
    const [text] = containerTextBounds(group);
    expect(text!.x + text!.width).toBeLessThanOrEqual(160 - 16);
  });

  it('adds the kind tag drawn at the foot of a C4 boundary', () => {
    const boundary = createTestNode('b', { kind: 'frame', size: { width: 300, height: 200 }, content: { label: 'Shop', subLabel: '[Software system]' } });
    const [, tag] = containerTextBounds(boundary);
    expect(tag).toMatchObject({ x: 12, y: 178 });
    expect(tag!.width).toBeGreaterThan(40);
  });

  it('is nothing when there is no header to read: a hidden one, an untitled frame, a preset, a plain node', () => {
    expect(containerTextBounds(createTestNode('g', { kind: 'group', size: { width: 300, height: 200 }, content: { label: 'X', showHeader: false } }))).toEqual([]);
    expect(containerTextBounds(createTestNode('f', { kind: 'frame', size: { width: 300, height: 200 }, content: { label: '' } }))).toEqual([]);
    expect(containerTextBounds(createTestNode('p', { kind: 'frame', size: { width: 300, height: 200 }, content: { preset: 'frame', label: 'VPC' } }))).toEqual([]);
    expect(containerTextBounds(createTestNode('n', { size: { width: 160, height: 72 }, content: { label: 'Node' } }))).toEqual([]);
  });
});
