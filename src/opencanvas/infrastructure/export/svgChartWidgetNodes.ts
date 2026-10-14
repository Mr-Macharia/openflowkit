import { FONT_STACKS, resolveNodeStyle, type NodeStyle } from '../../domain/nodes/nodeStyle';
import type { SceneNode } from '../../domain/document/types';
import type { Matrix2d } from '../../domain/geometry/types';
import { resolveChartPresentation } from '../../domain/nodes/chartNodePresentation';
import {
  resolveWidgetInks, resolveWidgetPresentation, widgetBackdrop, type WidgetInk, type WidgetInkPaint, type WidgetPrimitive,
} from '../../domain/nodes/widgetNodePresentation';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import { matrixAttribute, nodeGroup, number, openPathData, pathData, SVG_BACKGROUND, xml } from './svgMarkup';

// Charts draw exactly what the presentation says, in the same order as Pixi.
export function exportChartNode(
  node: SceneNode,
  matrix: Matrix2d,
  theme: 'light' | 'dark' | 'print',
  frame: { readonly className: string; readonly style: string } | null
): string | null {
  const presentation = resolveChartPresentation(node);
  if (!presentation) return null;
  const style = resolveNodeStyle(node, theme === 'dark' ? SVG_BACKGROUND.dark : SVG_BACKGROUND.light);
  const textColor = style.textColor === 'transparent' ? '#334155' : style.textColor;
  const parts: string[] = [];
  // Points are already in world space, so the card is drawn there too and the
  // group carries no transform.
  const corners = [
    { x: 0, y: 0 }, { x: node.size.width, y: 0 },
    { x: node.size.width, y: node.size.height }, { x: 0, y: node.size.height },
  ].map((point) => applyMatrixToPoint(matrix, point));
  const cardStroke = style.strokeWidth > 0 && style.stroke !== 'transparent'
    ? ` stroke="${xml(style.stroke)}" stroke-width="${number(style.strokeWidth)}"` : '';
  parts.push(`<path d="${pathData(corners)}" fill="${xml(style.fill)}"${cardStroke}/>`);
  for (const mark of presentation.marks) {
    const points = mark.points.map((point) => applyMatrixToPoint(matrix, point));
    if (mark.kind === 'bar' || mark.kind === 'cell' || mark.kind === 'swatch') {
      const [first, second] = points;
      if (!first || !second) continue;
      parts.push(`<rect x="${number(first.x)}" y="${number(first.y)}" width="${number(second.x - first.x)}" height="${number(second.y - first.y)}"${mark.kind === 'swatch' ? ' rx="2"' : ''} fill="${xml(mark.color)}" fill-opacity="${number(mark.opacity)}"${mark.kind === 'cell' ? ` stroke="${xml(style.fill)}" stroke-opacity="0.6"` : ''}/>`);
    } else if (mark.kind === 'point') {
      for (const point of points) {
        parts.push(`<circle cx="${number(point.x)}" cy="${number(point.y)}" r="3.5" fill="${xml(mark.color)}" fill-opacity="${number(mark.opacity)}"/>`);
      }
    } else if (mark.kind === 'line') {
      parts.push(`<path d="${openPathData(points)}" fill="none" stroke="${xml(mark.color)}" stroke-width="2" stroke-opacity="${number(mark.opacity)}" stroke-linejoin="round"/>`);
    } else {
      parts.push(`<path d="${pathData(points)}" fill="${xml(mark.color)}" fill-opacity="${number(mark.opacity)}"${mark.kind === 'area' ? ` stroke="${xml(mark.color)}" stroke-width="1.5"` : ''}/>`);
    }
  }
  for (const rule of presentation.rules) {
    parts.push(`<path d="${openPathData(rule.map((point) => applyMatrixToPoint(matrix, point)))}" fill="none" stroke="${xml(textColor)}" stroke-opacity="0.2" stroke-width="1"/>`);
  }
  if (presentation.table) {
    const { columns, rows } = presentation.table;
    const top = rows[0]!;
    const bottom = rows[rows.length - 1]!;
    const left = columns[0]!;
    const right = columns[columns.length - 1]!;
    const line = (x1: number, y1: number, x2: number, y2: number) =>
      `<path d="${openPathData([applyMatrixToPoint(matrix, { x: x1, y: y1 }), applyMatrixToPoint(matrix, { x: x2, y: y2 })])}" stroke="${xml(textColor)}" stroke-opacity="0.2" stroke-width="1" fill="none"/>`;
    for (const x of columns) parts.push(line(x, top, x, bottom));
    for (const y of rows) parts.push(line(left, y, right, y));
    const header = applyMatrixToPoint(matrix, { x: left, y: top });
    const headerCorner = applyMatrixToPoint(matrix, { x: right, y: rows[1]! });
    parts.push(`<rect x="${number(header.x)}" y="${number(header.y)}" width="${number(headerCorner.x - header.x)}" height="${number(headerCorner.y - header.y)}" fill="${xml(textColor)}" fill-opacity="0.06"/>`);
  }
  for (const label of presentation.labels) {
    if (!label.text) continue;
    const at = applyMatrixToPoint(matrix, label.at);
    const anchor = label.anchor === 'start' ? 'start' : label.anchor === 'end' ? 'end' : 'middle';
    const size = label.role === 'title' ? style.fontSize + 2 : 11;
    parts.push(`<text x="${number(at.x)}" y="${number(at.y)}" text-anchor="${anchor}" dominant-baseline="middle" fill="${xml(label.color ?? textColor)}" font-family="system-ui,sans-serif" font-size="${number(size)}">${xml(label.text)}</text>`);
  }
  return nodeGroup(`data-node-id="${xml(node.id)}" data-node-kind="chart"`, parts.join(''), frame);
}

// Widgets and frame chrome: the same primitives Pixi paints, node-local, so the
// group carries the node matrix.
export function widgetPrimitivesMarkup(
  primitives: readonly WidgetPrimitive[],
  inks: Readonly<Record<WidgetInk, WidgetInkPaint>>,
  style: NodeStyle
): string {
  const paint = (primitive: Exclude<WidgetPrimitive, { kind: 'text' }>): string => {
    const opacity = primitive.opacity ?? 1;
    const fill = primitive.fill ? inks[primitive.fill] : null;
    const stroke = primitive.stroke ? inks[primitive.stroke] : null;
    const width = primitive.strokeWidth ?? style.strokeWidth;
    return (fill ? ` fill="${xml(fill.color)}"${fill.alpha * opacity < 1 ? ` fill-opacity="${number(fill.alpha * opacity)}"` : ''}` : ' fill="none"')
      + (stroke && width > 0
        ? ` stroke="${xml(stroke.color)}" stroke-width="${number(width)}"${stroke.alpha * opacity < 1 ? ` stroke-opacity="${number(stroke.alpha * opacity)}"` : ''} stroke-linecap="round" stroke-linejoin="round"`
        : '');
  };
  return primitives.map((primitive) => {
    if (primitive.kind === 'text') {
      if (!primitive.text) return '';
      const ink = inks[primitive.ink];
      return `<text x="${number(primitive.x)}" y="${number(primitive.y)}" text-anchor="${primitive.anchor}" dominant-baseline="middle" fill="${xml(ink.color)}"${ink.alpha < 1 ? ` fill-opacity="${number(ink.alpha)}"` : ''} font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="${number(primitive.size)}" font-weight="${primitive.weight}">${xml(primitive.text)}</text>`;
    }
    if (primitive.kind === 'rect') {
      if (primitive.width <= 0 || primitive.height <= 0) return '';
      const radius = Math.min(primitive.radius, primitive.width / 2, primitive.height / 2);
      return `<rect x="${number(primitive.x)}" y="${number(primitive.y)}" width="${number(primitive.width)}" height="${number(primitive.height)}"${radius > 0 ? ` rx="${number(radius)}"` : ''}${paint(primitive)}/>`;
    }
    if (primitive.kind === 'circle') {
      return primitive.radius > 0 ? `<circle cx="${number(primitive.x)}" cy="${number(primitive.y)}" r="${number(primitive.radius)}"${paint(primitive)}/>` : '';
    }
    if (primitive.points.length < 2) return '';
    return `<path d="${primitive.closed ? pathData(primitive.points) : openPathData(primitive.points)}"${paint(primitive)}/>`;
  }).join('');
}

export function exportWidgetNode(
  node: SceneNode,
  matrix: Matrix2d,
  theme: 'light' | 'dark' | 'print',
  frame: { readonly className: string; readonly style: string } | null,
  parentOf: (id: string) => SceneNode | undefined
): string | null {
  const presentation = resolveWidgetPresentation(node);
  if (!presentation) return null;
  const background = theme === 'dark' ? SVG_BACKGROUND.dark : SVG_BACKGROUND.light;
  const style = resolveNodeStyle(node, background);
  return nodeGroup(
    `data-node-id="${xml(node.id)}" data-node-kind="widget" transform="${matrixAttribute(matrix)}"${style.opacity < 1 ? ` opacity="${number(style.opacity)}"` : ''}`,
    widgetPrimitivesMarkup(presentation.primitives, resolveWidgetInks(node, style, widgetBackdrop(node, parentOf, background)), style),
    frame
  );
}
