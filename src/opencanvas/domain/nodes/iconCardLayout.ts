import type { SceneNode } from '../document/types';
import { createBounds2d } from '../geometry/bounds';
import type { Bounds2d, Size2d } from '../geometry/types';
import { resolveNodeSizingPolicy } from '../node-sizing/model';
import { measurePortableText, SUBLABEL_FONT } from '../text/measurement';
import { resolveArchitectureNodePresentation } from './architectureNodePresentation';
import { resolveNodeStyle, type NodeStyle } from './nodeStyle';

/** The painted plate of an icon tile, the art inside it, and the band under it that holds the caption. */
const PLATE = 72;
const PLATE_TOP = 4;
const CAPTION_TOP = 84;
/** A row card: the art, and the gap before its text. */
const ROW_ICON = 32;
const ROW_GAP = 10;
const SUB_LINE_HEIGHT = SUBLABEL_FONT.fontSize * 1.2;
/** Label and sub-label stack 4px apart. */
const STACK_GAP = 4;
const MAX_TEXT_WIDTH = 200;

export interface IconCardText {
  /** Where the lines anchor horizontally, and how. */
  readonly x: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly lines: readonly string[];
  readonly lineHeight: number;
  readonly subLines: readonly string[];
  readonly subLineHeight: number;
  /** Top of the first label line, and of the first sub-label line (when there is one). */
  readonly top: number;
  readonly subTop: number;
  /** Bottom of the whole text block. */
  readonly bottom: number;
}

export interface IconCardLayout {
  /** What the style paints: the 72px plate of a tile, the whole card of a row. */
  readonly chrome: Bounds2d;
  /** The icon art. */
  readonly icon: Bounds2d;
  /** The label editor's rect. */
  readonly labelBox: Bounds2d;
  readonly text: IconCardText | null;
  /** The box connector ends meet: the plate down to the caption bottom for a tile, the whole box for a row. */
  readonly connect: Bounds2d;
}

/**
 * Where the icon art sits, node-local: centred in the 72px plate of an icon tile, at the left of a row card,
 * or the small badge in an architecture card's header. The canvas and every export place it here.
 */
export function architectureIconBounds(node: SceneNode, display: 'architecture-card' | 'provider-icon'): Bounds2d {
  return display === 'provider-icon' ? iconCardLayout(node).icon : createBounds2d(14, 12, 18, 18);
}

function row(node: SceneNode): boolean {
  return resolveArchitectureNodePresentation(node)?.iconPlacement === 'left';
}

// ponytail: line breaks come from the portable text estimate, not the real font — a long caption can wrap one
// word differently on the canvas; measure with real glyphs if that ever shows.
function laidOut(node: SceneNode, style: NodeStyle) {
  const label = resolveArchitectureNodePresentation(node)?.label ?? '';
  const subLabel = typeof node.content.subLabel === 'string' ? node.content.subLabel : '';
  const pad = style.textPadding;
  const asRow = row(node);
  const { width, height } = node.size;
  // The column the text sits in, and the band it aligns within.
  const left = asRow ? pad + ROW_ICON + ROW_GAP : pad;
  const right = width - pad;
  const bandTop = asRow ? 0 : CAPTION_TOP;
  const maxWidth = Math.max(1, right - left);
  const maxLines = resolveNodeSizingPolicy(node).maxLines ?? 4;
  const lineHeight = style.fontSize * style.lineHeight;
  const lines = label ? measurePortableText(label, {
    fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight, maxWidth, maxLines, overflow: 'wrap',
  }).lines : [];
  const subLines = subLabel ? measurePortableText(subLabel, {
    ...SUBLABEL_FONT, lineHeight: SUB_LINE_HEIGHT, maxWidth, maxLines, overflow: 'wrap',
  }).lines : [];
  const box = createBounds2d(asRow ? left - pad : 0, bandTop, asRow ? width - left + pad : width, Math.max(1, height - bandTop));
  if (lines.length === 0 && subLines.length === 0) return { box, text: null };
  const labelHeight = lines.length * lineHeight;
  const block = labelHeight + (subLines.length ? (lines.length ? STACK_GAP : 0) + subLines.length * SUB_LINE_HEIGHT : 0);
  const top = style.textVerticalAlign === 'top' ? bandTop + pad
    : style.textVerticalAlign === 'bottom' ? height - pad - block
      : bandTop + (height - bandTop - block) / 2;
  const x = style.textAlign === 'start' ? left : style.textAlign === 'end' ? right : (left + right) / 2;
  return {
    box,
    text: {
      x, anchor: style.textAlign === 'start' ? 'start' : style.textAlign === 'end' ? 'end' : 'middle',
      lines, lineHeight, subLines, subLineHeight: SUB_LINE_HEIGHT,
      top, subTop: top + labelHeight + (lines.length ? STACK_GAP : 0), bottom: top + block,
    } satisfies IconCardText,
  };
}

/** What the style paints, with no text measured: a tile's 72px plate, a row card's whole box. */
export function iconCardChrome(node: SceneNode): Bounds2d {
  const { width, height } = node.size;
  return row(node) ? createBounds2d(0, 0, width, height) : createBounds2d((width - PLATE) / 2, PLATE_TOP, PLATE, PLATE);
}

// Nodes are immutable records (resolveNodeStyle caches on them the same way), so a layout is measured once per node.
const layouts = new WeakMap<SceneNode, IconCardLayout>();

/**
 * The geometry of an icon tile (art above its caption) or row card (art left of its text), from one place for the
 * canvas, the editor, connectors and every export. `style` only ever differs from the node's own in colour (a canvas
 * ink), so the layout is cached on the node.
 * ponytail: the cache ignores `style` — a caller passing a different font or padding gets the first layout; key the
 * cache by style too if one ever does.
 */
export function iconCardLayout(node: SceneNode, style?: NodeStyle): IconCardLayout {
  const known = layouts.get(node);
  if (known) return known;
  const made = measureIconCard(node, style ?? resolveNodeStyle(node));
  layouts.set(node, made);
  return made;
}

function measureIconCard(node: SceneNode, style: NodeStyle): IconCardLayout {
  const { width, height } = node.size;
  const { box, text } = laidOut(node, style);
  if (row(node)) {
    const whole = createBounds2d(0, 0, width, height);
    const pad = style.textPadding;
    return { chrome: whole, icon: createBounds2d(pad, (height - ROW_ICON) / 2, ROW_ICON, ROW_ICON), labelBox: box, text, connect: whole };
  }
  const plate = createBounds2d((width - PLATE) / 2, PLATE_TOP, PLATE, PLATE);
  const bottom = text ? Math.max(PLATE_TOP + PLATE, text.bottom + style.textPadding) : PLATE_TOP + PLATE;
  return {
    chrome: plate,
    icon: createBounds2d(plate.x + 6, plate.y + 6, PLATE - 12, PLATE - 12),
    labelBox: box,
    text,
    connect: createBounds2d(plate.x, PLATE_TOP, PLATE, bottom - PLATE_TOP),
  };
}

/**
 * The size an icon card hugs its text at: a tile as wide as its widest line (148 to 232) and as tall as the plate
 * plus the caption; a row card as wide as its art and text (at least 160) and as tall as its text (at least 56).
 */
export function iconCardSize(node: SceneNode, style: NodeStyle = resolveNodeStyle(node)): Size2d {
  const asRow = row(node);
  const pad = style.textPadding;
  const label = resolveArchitectureNodePresentation(node)?.label ?? '';
  const subLabel = typeof node.content.subLabel === 'string' ? node.content.subLabel : '';
  const widest = Math.max(0,
    ...(label ? [measurePortableText(label, { fontSize: style.fontSize, fontWeight: style.fontWeight, maxWidth: MAX_TEXT_WIDTH, overflow: 'visible' }).width] : []),
    ...(subLabel ? [measurePortableText(subLabel, { ...SUBLABEL_FONT, maxWidth: MAX_TEXT_WIDTH, overflow: 'visible' }).width] : []));
  const width = Math.ceil(asRow ? Math.max(160, pad + ROW_ICON + ROW_GAP + widest + pad) : Math.max(148, widest + 32));
  return { width, height: iconCardHeight({ ...node, size: { width, height: 1 } }, style) };
}

/** The height an icon card hugs its text at, keeping its own width: a caption narrower than it wants wraps into more lines. */
export function iconCardHeight(node: SceneNode, style: NodeStyle = resolveNodeStyle(node)): number {
  // The block is measured top-aligned: a middle or bottom caption depends on the height this finds.
  const { text } = laidOut(node, { ...style, textVerticalAlign: 'top' });
  const pad = style.textPadding;
  if (row(node)) return Math.ceil(Math.max(56, text ? text.bottom + pad : 0));
  return Math.ceil(text ? text.bottom + pad : PLATE_TOP + PLATE + 4);
}

/** An icon card refit to its text after the text changed (`before` is the card as it was): the height only, so its width and top-left stay where the author put them; a height the author chose is kept unless the text no longer fits. Anything else comes back as it was. */
export function refitIconCard(node: SceneNode, before: SceneNode = node): SceneNode {
  if (resolveArchitectureNodePresentation(node)?.display !== 'provider-icon') return node;
  const hugged = iconCardHeight(node);
  // A card the author made taller (or shorter, down to what fits) keeps that height; only one that was hugging follows its text.
  const hugging = Math.abs(before.size.height - iconCardHeight(before)) <= 0.5;
  const height = hugging ? hugged : Math.max(node.size.height, hugged);
  return height === node.size.height ? node : { ...node, size: { width: node.size.width, height } };
}
