import { architectureCardLayout } from '../../domain/nodes/architectureCardLayout';
import { FONT_STACKS, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { resolveNodeVisualStyle } from '@/theme';
import { nodePaletteName } from '../../domain/nodes/nodePalette';
import type { SceneNode } from '../../domain/document/types';
import type { Matrix2d, Point2d } from '../../domain/geometry/types';
import { resolveArchitectureNodePresentation } from '../../domain/nodes/architectureNodePresentation';
import { architectureIconBounds } from '../../domain/nodes/iconCardLayout';
import { measurePortableText, truncateTextToWidth } from '../../domain/text/measurement';
import { SEQUENCE_ACTIVATION_WIDTH, sequenceHeadShape } from '../../domain/nodes/sequenceNodePresentation';
import { isJsonObject } from '../../domain/document/json';
import { sequenceNodeColors } from '../pixi/sequenceNodeVisual';
import { classEntityNodeColors } from '../pixi/classEntityNodeVisual';
import { classEntityLayout, CLASS_ENTITY_HEADER_HEIGHT } from '../../domain/nodes/classEntityRows';
import { iconMarkup, type IconSheet } from './svgIcons';
import {
  elementFrameStyle, fillAttributes, matrixAttribute, nodeGroup, number, openPathData, pathData, safeColor, SVG_BACKGROUND, textElement, xml,
} from './svgMarkup';

/** Semantic C4 cards use the same header, title and metadata as the canvas. */
export function exportArchitectureCard(node: SceneNode, matrix: Matrix2d, style: NodeStyle, wrapper: ReturnType<typeof elementFrameStyle>, icons: IconSheet): string | null {
  const presentation = resolveArchitectureNodePresentation(node);
  if (presentation?.display !== 'architecture-card') return null;
  const font = `fill="${style.textColor}" font-family="${xml(FONT_STACKS[style.fontFamily])}"`;
  const subFont = style.subTextColor ? `fill="${safeColor(style.subTextColor, '#cbd5e1')}" font-family="${xml(FONT_STACKS[style.fontFamily])}"` : font;
  const layout = architectureCardLayout(node, style);
  // As the canvas draws it: on a dark wash the header takes the card's hue and the icon keeps a light tile.
  const washed = Boolean(style.subTextColor);
  const icon = architectureIconBounds(node, 'architecture-card');
  const tile = washed
    ? `<rect x="${number(icon.x)}" y="${number(icon.y)}" width="${number(icon.width)}" height="${number(icon.height)}" rx="6" fill="${safeColor(resolveNodeVisualStyle(presentation.colorKey, presentation.colorMode, presentation.customColor, nodePaletteName(node)).iconBg, '#f1f5f9')}"/>`
    : '';
  return nodeGroup(`data-node-id="${xml(node.id)}" transform="${matrixAttribute(matrix)}"`,
    `<rect width="${number(node.size.width)}" height="${number(node.size.height)}" rx="${number(style.cornerRadius)}" ${fillAttributes(style.fill, '#f8fafc')} stroke="${safeColor(style.stroke, '#cbd5e1')}" stroke-width="${number(style.strokeWidth)}"/>`
    + `<rect x="10" y="8" width="${number(node.size.width - 20)}" height="26" rx="7" fill="${safeColor(style.stroke, '#cbd5e1')}" opacity="${washed ? '0.3' : '0.12'}"/>`
    + tile
    + textElement(layout.provider.displayText, 38, 15, `${subFont} font-size="10" font-weight="700" dominant-baseline="hanging"`, 12)
    + textElement(layout.resource.displayText, node.size.width - 16, 15, `${subFont} font-size="10" font-weight="600" text-anchor="end" dominant-baseline="hanging"`, 12)
    + textElement(layout.title.displayText, layout.titleX, layout.titleY, `${font} font-size="${number(style.fontSize)}" font-weight="${style.fontWeight}" dominant-baseline="hanging"`, style.fontSize * style.lineHeight)
    + textElement(layout.detail.displayText, 12, layout.detailY, `${subFont} font-size="10" font-weight="500" dominant-baseline="hanging"`, 12)
    + iconMarkup(node, icons), wrapper);
}

/** Sequence participants and notes, drawn as PixiSequenceNodeRenderer draws them (same geometry, same ink). */
export function exportSequenceNode(node: SceneNode, matrix: Matrix2d, theme: 'light' | 'dark' | 'print', wrapper: ReturnType<typeof elementFrameStyle>): string | null {
  const colors = sequenceNodeColors(node, theme === 'dark' ? SVG_BACKGROUND.dark : undefined);
  const presentation = colors?.presentation;
  if (!colors || !presentation) return null;
  const ink = `stroke="${colors.stroke}"`;
  const font = `font-family="${xml(FONT_STACKS.sans)}"`;
  const group = (body: string) => nodeGroup(`data-node-id="${xml(node.id)}" transform="${matrixAttribute(matrix)}"`, body, wrapper);
  const { width, height } = node.size;
  if (presentation.kind === 'sequence_fragment') {
    // One frame per block: an `else`/`and` branch opens on a dashed divider (no tag), and a branch
    // the next one continues leaves its bottom edge to that divider. Tag and guard share the header row.
    const edge = (x1: number, y1: number, x2: number, y2: number, dash = '') =>
      `<line x1="${number(x1)}" y1="${number(y1)}" x2="${number(x2)}" y2="${number(y2)}" ${ink} stroke-width="1.25"${dash}/>`;
    const guard = node.content.seqGuard;
    const box = isJsonObject(guard) && typeof guard.x === 'number' && typeof guard.width === 'number'
      ? { x: guard.x, width: guard.width } : { x: 82, width: width - 92 };
    const header = (text: string, x: number, size: string) =>
      `<text x="${number(x)}" y="6" dominant-baseline="text-before-edge" ${font} font-size="10" ${size}>${xml(text)}</text>`;
    return group(`<rect width="${number(width)}" height="${number(height)}" fill="${colors.fill}" fill-opacity="0.3"/>`
      + edge(0, 0, 0, height) + edge(width, 0, width, height)
      + (presentation.continued ? '' : edge(0, height, width, height))
      + (presentation.divider ? edge(0, 0, width, 0, ' stroke-dasharray="5 5"')
        : edge(0, 0, width, 0) + `<rect width="${number(Math.min(72, width))}" height="24" fill="${colors.accentFill}" ${ink} stroke-width="1"/>`
          + header(truncateTextToWidth(presentation.label, 60, 6.2), 8, `font-weight="700" fill="${colors.text}"`))
      + (presentation.condition
        ? header(truncateTextToWidth(presentation.divider ? `[${presentation.condition}]` : presentation.condition, box.width, 6.2), box.x, `font-weight="500" fill="${colors.subText}"`)
        : ''));
  }
  if (presentation.kind === 'sequence_note') {
    const text = measurePortableText(presentation.label, { fontSize: 11, fontWeight: 500, maxWidth: Math.max(40, node.size.width - 24), overflow: 'wrap' });
    return group(`<rect width="${number(node.size.width)}" height="${number(node.size.height)}" rx="8" fill="${colors.fill}" ${ink} stroke-width="1.25"/>`
      // Centred top to bottom, as the canvas draws it (PixiSequenceNodeRenderer).
      + textElement(text.displayText, 12, Math.max(8, (node.size.height - text.height) / 2), `fill="${colors.text}" ${font} font-size="11" font-weight="500" dominant-baseline="hanging"`, 13));
  }
  const actor = presentation.participantKind === 'actor';
  const top = actor ? SEQUENCE_ACTOR_HEIGHT : 0;
  const centerX = node.size.width / 2;
  const lifelineStart = top + SEQUENCE_HEADER_HEIGHT;
  const activations = presentation.activations.flatMap(({ startOrder, endOrder }) => {
    const y = lifelineStart + SEQUENCE_MESSAGE_OFFSET + startOrder * SEQUENCE_MESSAGE_SPACING;
    if (y >= node.size.height) return [];
    const bar = Math.min(Math.max(12, (endOrder - startOrder) * SEQUENCE_MESSAGE_SPACING), node.size.height - y);
    return [`<rect x="${number(centerX - SEQUENCE_ACTIVATION_WIDTH / 2)}" y="${number(y)}" width="${SEQUENCE_ACTIVATION_WIDTH}" height="${number(bar)}" rx="2" fill="${colors.accentFill}" ${ink}/>`];
  });
  const figure = actor
    ? `<circle cx="${number(centerX)}" cy="9" r="5" fill="none" ${ink} stroke-width="1.5"/>`
      + `<path d="M${number(centerX)} 14V28M${number(centerX - 9)} 20H${number(centerX + 9)}M${number(centerX)} 28L${number(centerX - 8)} 37M${number(centerX)} 28L${number(centerX + 8)} 37" fill="none" ${ink} stroke-width="1.5"/>`
    : '';
  // A cylinder's rim takes the top of the head and a queue's its right end; the name sits in the body.
  const titleY = top + SEQUENCE_HEADER_HEIGHT / 2 - (presentation.alias ? 6 : 0) + (presentation.head === 'cylinder' ? 6 : 0);
  const titleX = centerX - (presentation.head === 'queue' ? 6 : 0);
  const shift = (points: readonly Point2d[]) => points.map((point) => ({ x: point.x, y: point.y + top }));
  const head = presentation.head === 'box'
    ? `<rect y="${number(top)}" width="${number(width)}" height="${SEQUENCE_HEADER_HEIGHT}" rx="5" fill="${colors.fill}" ${ink} stroke-width="1.5"/>`
    : (({ outline, rim }) => `<path d="${pathData(shift(outline))}" fill="${colors.fill}" ${ink} stroke-width="1.5"/>`
      + `<path d="${openPathData(shift(rim))}" fill="none" ${ink} stroke-width="1.5"/>`)(sequenceHeadShape(presentation.head, width));
  return group(head
    + `<line x1="${number(centerX)}" y1="${number(lifelineStart)}" x2="${number(centerX)}" y2="${number(node.size.height)}" ${ink} stroke-width="1.5" stroke-dasharray="6 6"/>`
    + activations.join('') + figure
    + textElement(truncateTextToWidth(presentation.label, width - 24, 7), titleX, titleY, `fill="${colors.text}" ${font} font-size="12" font-weight="600" text-anchor="middle" dominant-baseline="central"`, 14)
    + (presentation.alias ? textElement(truncateTextToWidth(presentation.alias, width - 28, 5.5), centerX, top + SEQUENCE_HEADER_HEIGHT / 2 + 10, `fill="${colors.subText}" ${font} font-size="9" font-weight="500" text-anchor="middle" dominant-baseline="central"`, 11) : ''));
}

/** Classes and ER entities, drawn as PixiClassEntityNodeRenderer draws them: one layout, one palette. */
export function exportClassEntityNode(node: SceneNode, matrix: Matrix2d, wrapper: ReturnType<typeof elementFrameStyle>): string | null {
  const colors = classEntityNodeColors(node);
  const layout = classEntityLayout(node);
  if (!colors || !layout) return null;
  const { width, height } = node.size;
  const texts = layout.texts.filter(({ text }) => text).map((run) =>
    `<text x="${number(run.x)}" y="${number(run.y)}" text-anchor="${run.anchor}" dominant-baseline="text-before-edge" fill="${colors[run.ink]}" font-family="${xml(run.family)}" font-size="${run.size}" font-weight="${run.weight}">${xml(run.text)}</text>`);
  return nodeGroup(`data-node-id="${xml(node.id)}" data-node-kind="${node.kind}" transform="${matrixAttribute(matrix)}"`,
    `<rect width="${number(width)}" height="${number(height)}" rx="${number(Math.min(12, width / 2, height / 2))}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`
    + `<rect x="1" y="1" width="${number(Math.max(0, width - 2))}" height="${CLASS_ENTITY_HEADER_HEIGHT - 1}" rx="11" fill="${colors.headerFill}"/>`
    + layout.dividers.map((y) => `<rect y="${number(y)}" width="${number(width)}" height="1" fill="${colors.stroke}"/>`).join('')
    + texts.join(''), wrapper);
}

// The sequence renderer's geometry (PixiSequenceNodeRenderer, routeProjection): header, actor room, message rows.
const SEQUENCE_HEADER_HEIGHT = 48;
const SEQUENCE_ACTOR_HEIGHT = 40;
const SEQUENCE_MESSAGE_OFFSET = 44;
const SEQUENCE_MESSAGE_SPACING = 52;
