import { describe, expect, it } from 'vitest';
import { createTestNode } from '../../testing/builders/documentBuilder';
import { architectureIconBounds, iconCardLayout, iconCardSize, refitIconCard } from './iconCardLayout';

const tile = (content: Record<string, unknown> = {}, size = { width: 148, height: 116 }, appearance: Record<string, unknown> = {}) => createTestNode('t', {
  kind: 'architecture', size, appearance: appearance as never,
  content: { label: 'API', assetPresentation: 'icon', icon: 'tabler/server', ...content },
});
const row = (content: Record<string, unknown> = {}, size = { width: 200, height: 60 }, appearance: Record<string, unknown> = {}) =>
  tile({ contentLayout: { version: 1, horizontal: 'center', vertical: 'center', iconPlacement: 'left', labelAlignment: 'center', padding: { top: 16, right: 16, bottom: 16, left: 16 }, gap: 8, iconScale: 1, freeIconPosition: { x: 0.5, y: 0.5 } }, ...content }, size, appearance);

describe('iconCardLayout: tile', () => {
  it('puts a 72px plate on top with the art inset 6 and the caption underneath', () => {
    const layout = iconCardLayout(tile());
    expect(layout.chrome).toEqual({ x: 38, y: 4, width: 72, height: 72 });
    expect(layout.icon).toEqual({ x: 44, y: 10, width: 60, height: 60 });
    expect(layout.labelBox).toEqual({ x: 0, y: 84, width: 148, height: 32 });
    expect(layout.text).toMatchObject({ x: 74, anchor: 'middle', lines: ['API'], top: 88, subLines: [] });
    expect(layout.text!.bottom).toBeCloseTo(102.4, 5);
  });

  it('connects from the plate top to the caption bottom, whatever the box height', () => {
    expect(iconCardLayout(tile()).connect.y + iconCardLayout(tile()).connect.height).toBeCloseTo(106.4, 5);
    const tall = iconCardLayout(tile({}, { width: 148, height: 200 }));
    expect(tall.connect).toMatchObject({ x: 38, y: 4, width: 72 });
    expect(tall.connect.y + tall.connect.height).toBeCloseTo(106.4, 5);
  });

  it('wraps a caption that is wider than the box and counts every line', () => {
    const layout = iconCardLayout(tile({ label: 'Customer identity and access management' }));
    expect(layout.text!.lines.length).toBeGreaterThan(1);
    expect(layout.text!.bottom).toBeCloseTo(88 + layout.text!.lines.length * 14.4, 5);
  });

  it('breaks at an explicit newline', () => {
    expect(iconCardLayout(tile({ label: 'one\ntwo' })).text!.lines).toEqual(['one', 'two']);
  });

  it('stacks a sub-label 4px under the label', () => {
    const { text } = iconCardLayout(tile({ subLabel: 'primary' }));
    expect(text!.subLines).toEqual(['primary']);
    expect(text!.subTop).toBeCloseTo(88 + 14.4 + 4, 5);
    expect(text!.bottom).toBeCloseTo(88 + 14.4 + 4 + 13.2, 5);
  });

  it('has no text and ends at the plate with no caption', () => {
    const layout = iconCardLayout(tile({ label: '' }));
    expect(layout.text).toBeNull();
    expect(layout.connect.y + layout.connect.height).toBe(76);
  });

  it('keeps a sub-label alone where a label would sit', () => {
    const { text } = iconCardLayout(tile({ label: '', subLabel: 'only' }));
    expect(text).toMatchObject({ lines: [], subLines: ['only'], subTop: 88 });
  });

  it('grows its lines with the font size', () => {
    const { text } = iconCardLayout(tile({}, undefined, { fontSize: 20 }));
    expect(text!.lineHeight).toBe(24);
    expect(text!.bottom).toBeCloseTo(88 + 24, 5);
  });

  it('anchors at the end padding when end-aligned', () => {
    expect(iconCardLayout(tile({}, undefined, { textAlign: 'end' })).text).toMatchObject({ x: 144, anchor: 'end' });
  });

  it('sits at the bottom of a tall box when bottom-aligned, and the connect box follows it', () => {
    const layout = iconCardLayout(tile({}, { width: 148, height: 200 }, { textVerticalAlign: 'bottom' }));
    expect(layout.text!.bottom).toBe(196);
    expect(layout.connect.y + layout.connect.height).toBe(200);
  });

  it('centres a middle-aligned caption in the band under the plate', () => {
    const { text } = iconCardLayout(tile({}, { width: 148, height: 200 }, { textVerticalAlign: 'middle' }));
    expect(text!.top).toBeCloseTo(84 + (116 - 14.4) / 2, 5);
  });

  it('gives the art its own bounds for a card too', () => {
    expect(architectureIconBounds(tile(), 'provider-icon')).toEqual({ x: 44, y: 10, width: 60, height: 60 });
    expect(architectureIconBounds(tile(), 'architecture-card')).toEqual({ x: 14, y: 12, width: 18, height: 18 });
  });
});

describe('iconCardLayout: row', () => {
  it('puts a 32px icon left, centred, with the text beside it', () => {
    const layout = iconCardLayout(row());
    expect(layout.chrome).toEqual({ x: 0, y: 0, width: 200, height: 60 });
    expect(layout.connect).toEqual(layout.chrome);
    expect(layout.icon).toEqual({ x: 12, y: 14, width: 32, height: 32 });
    expect(layout.text).toMatchObject({ x: 54, anchor: 'start', lines: ['API'] });
    // Centred on the box's middle line.
    expect(layout.text!.top + (layout.text!.bottom - layout.text!.top) / 2).toBeCloseTo(30, 5);
    expect(layout.labelBox).toEqual({ x: 42, y: 0, width: 158, height: 60 });
  });

  it('stacks label and sub-label as one centred block', () => {
    const { text } = iconCardLayout(row({ subLabel: 'Compute Engine' }));
    expect(text!.subLines).toEqual(['Compute Engine']);
    expect(text!.top + (text!.bottom - text!.top) / 2).toBeCloseTo(30, 5);
  });

  it('wraps in the column beside the icon', () => {
    expect(iconCardLayout(row({ label: 'Customer identity and access management' })).text!.lines.length).toBeGreaterThan(1);
  });
});

describe('iconCardSize', () => {
  it('sizes a tile to the plate and one caption line', () => {
    expect(iconCardSize(tile())).toEqual({ width: 148, height: 107 });
  });

  it('keeps a tile with no caption at the plate', () => {
    expect(iconCardSize(tile({ label: '' }))).toEqual({ width: 148, height: 80 });
  });

  it('widens a tile for a long line, up to 232, and wraps the rest', () => {
    const wide = iconCardSize(tile({ label: 'Customer identity and access management' }));
    expect(wide.width).toBe(232);
    expect(wide.height).toBeGreaterThan(107);
  });

  it('counts a sub-label and every explicit line', () => {
    expect(iconCardSize(tile({ label: 'a\nb', subLabel: 'c' })).height).toBe(Math.ceil(88 + 28.8 + 4 + 13.2 + 4));
  });

  it('sizes a row to its art and text, with a floor', () => {
    expect(iconCardSize(row())).toEqual({ width: 160, height: 56 });
    expect(iconCardSize(row({ label: 'Customer identity and access management' })).width).toBeGreaterThan(160);
    expect(iconCardSize(row({ label: 'a\nb\nc', subLabel: 'x' })).height).toBeGreaterThan(56);
  });

  it('measures a bottom-aligned tile as if top-aligned', () => {
    expect(iconCardSize(tile({}, undefined, { textVerticalAlign: 'bottom' }))).toEqual({ width: 148, height: 107 });
  });

describe('refitIconCard', () => {
  const two = { label: 'one\ntwo' };
  it('refits a card that was hugging its caption', () => {
    const before = tile({}, { width: 148, height: 107 });
    expect(refitIconCard({ ...before, content: { ...before.content, ...two } }, before).size).toEqual({ width: 148, height: 121 });
  });

  it('keeps an authored height, and grows it only when the caption no longer fits', () => {
    const tall = tile({}, { width: 148, height: 150 });
    expect(refitIconCard({ ...tall, content: { ...tall.content, ...two } }, tall).size.height).toBe(150);
    const rowCard = row({}, { width: 200, height: 120 });
    expect(refitIconCard({ ...rowCard, content: { ...rowCard.content, label: 'a' } }, rowCard).size.height).toBe(120);
    const small = tile({}, { width: 148, height: 110 });
    expect(refitIconCard({ ...small, content: { ...small.content, label: 'a\nb\nc\nd' } }, small).size.height).toBe(Math.ceil(88 + 4 * 14.4 + 4));
  });
});

describe('iconCardLayout cache', () => {
  it('returns the same layout for the same node', () => {
    const node = tile();
    expect(iconCardLayout(node)).toBe(iconCardLayout(node));
    expect(iconCardLayout({ ...node })).not.toBe(iconCardLayout(node));
  });
});
});
