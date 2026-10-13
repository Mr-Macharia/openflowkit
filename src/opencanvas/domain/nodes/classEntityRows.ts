import type { Bounds2d, Point2d } from '../geometry/types';
import type { SceneNode } from '../document/types';
import { truncateTextToWidth } from '../text/measurement';
import { FONT_STACKS } from './nodeStyle';
import {
  isClassEntityNodeKind, resolveClassEntityNodePresentation,
  type ClassMemberPresentation, type EntityFieldPresentation,
} from './classEntityNodePresentation';

// Shared by the Pixi renderer (drawing) and the surface (row hit-testing).
export const CLASS_ENTITY_HEADER_HEIGHT = 44;
export const CLASS_ENTITY_ROW_HEIGHT = 18;
export const CLASS_ENTITY_CONTENT_PADDING = 10;
/** The line between a class's attributes and its methods takes this much room, not a whole row. */
const CLASS_ENTITY_DIVIDER_GAP = 6;

export type ClassEntityList = 'classAttributes' | 'classMethods' | 'erFields';

export interface ClassEntityRow {
  readonly list: ClassEntityList;
  /** Index into the list; equal to its length for the empty "add" row. */
  readonly index: number;
  /** Row rectangle in node-local coordinates. */
  readonly bounds: Bounds2d;
}

function listLength(node: SceneNode, list: ClassEntityList): number {
  const value = node.content[list];
  return Array.isArray(value) ? value.length : 0;
}

/** How a class box of this height splits between attributes and methods, in node-local y. */
export function classCompartments(height: number) {
  const availableRows = Math.max(2, Math.floor((height - CLASS_ENTITY_HEADER_HEIGHT - CLASS_ENTITY_CONTENT_PADDING * 2) / CLASS_ENTITY_ROW_HEIGHT));
  const attributeSlots = Math.max(1, Math.ceil(availableRows / 2));
  const dividerY = CLASS_ENTITY_HEADER_HEIGHT + CLASS_ENTITY_CONTENT_PADDING + attributeSlots * CLASS_ENTITY_ROW_HEIGHT;
  return {
    attributeSlots,
    methodSlots: Math.max(1, availableRows - attributeSlots),
    dividerY: dividerY + CLASS_ENTITY_DIVIDER_GAP / 2,
    methodsTop: dividerY + CLASS_ENTITY_DIVIDER_GAP,
  };
}

/** The visible member rows of a class or entity node, top to bottom. */
export function classEntityRows(node: SceneNode): readonly ClassEntityRow[] {
  if (!isClassEntityNodeKind(node.kind)) return [];
  const width = node.size.width - CLASS_ENTITY_CONTENT_PADDING * 2;
  const top = CLASS_ENTITY_HEADER_HEIGHT + CLASS_ENTITY_CONTENT_PADDING;
  const row = (list: ClassEntityList, index: number, y: number): ClassEntityRow => ({
    list, index, bounds: { x: CLASS_ENTITY_CONTENT_PADDING, y, width, height: CLASS_ENTITY_ROW_HEIGHT },
  });
  const usable = node.size.height - CLASS_ENTITY_HEADER_HEIGHT - CLASS_ENTITY_CONTENT_PADDING * 2;
  if (node.kind === 'er_entity') {
    const slots = Math.max(1, Math.floor(usable / CLASS_ENTITY_ROW_HEIGHT));
    const count = Math.min(listLength(node, 'erFields') + 1, slots);
    return Array.from({ length: count }, (_, index) =>
      row('erFields', index, top + index * CLASS_ENTITY_ROW_HEIGHT));
  }
  const { attributeSlots, methodSlots, methodsTop } = classCompartments(node.size.height);
  const attributes = Math.min(listLength(node, 'classAttributes') + 1, attributeSlots);
  const methods = Math.min(listLength(node, 'classMethods') + 1, methodSlots);
  return [
    ...Array.from({ length: attributes }, (_, index) =>
      row('classAttributes', index, top + index * CLASS_ENTITY_ROW_HEIGHT)),
    ...Array.from({ length: methods }, (_, index) =>
      row('classMethods', index, methodsTop + index * CLASS_ENTITY_ROW_HEIGHT)),
  ];
}

// ponytail: node-local point ignores rotation; rotated class nodes fall back
// to the inspector.
export function classEntityRowAt(node: SceneNode, local: Point2d): ClassEntityRow | null {
  return classEntityRows(node).find(({ bounds }) =>
    local.x >= bounds.x && local.x <= bounds.x + bounds.width
    && local.y >= bounds.y && local.y <= bounds.y + bounds.height) ?? null;
}

const ENTITY_KEY_COLUMN_WIDTH = 54;
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/** One text run of a class or entity box; `y` is the top of the text box, as the canvas places it. */
export interface ClassEntityText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly size: number;
  readonly weight: 400 | 500 | 600 | 700;
  readonly ink: 'text' | 'subText';
  readonly family: string;
}

/** Everything a class or entity box draws inside its outline: one layout for the canvas and the SVG export. */
export interface ClassEntityLayout {
  /** Node-local y of each full-width 1px rule: under the header, and a class's compartment divider. */
  readonly dividers: readonly number[];
  readonly texts: readonly ClassEntityText[];
}

function visibleRowCount(totalRows: number, availableSlots: number): number {
  return totalRows <= availableSlots ? totalRows : Math.max(0, availableSlots - 1);
}

function overflowText(remaining: number, x: number, y: number): ClassEntityText[] {
  return remaining > 0
    ? [{ text: `… ${remaining} more`, x, y: y + 2, anchor: 'start', size: 10, weight: 500, ink: 'subText', family: MONO_FONT }]
    : [];
}

function memberTexts(rows: readonly ClassMemberPresentation[], slots: number, x: number, y: number, width: number): ClassEntityText[] {
  const visible = visibleRowCount(rows.length, slots);
  return [
    ...rows.slice(0, visible).flatMap((row, index): ClassEntityText[] => [
      { text: row.symbol, x, y: y + index * CLASS_ENTITY_ROW_HEIGHT + 1, anchor: 'start', size: 11, weight: 700, ink: 'subText', family: MONO_FONT },
      { text: truncateTextToWidth(row.signature, width - 18), x: x + 16, y: y + index * CLASS_ENTITY_ROW_HEIGHT + 1, anchor: 'start', size: 11, weight: 400, ink: 'text', family: MONO_FONT },
    ]),
    ...overflowText(rows.length - visible, x, y + visible * CLASS_ENTITY_ROW_HEIGHT),
  ];
}

function entityKeyLabel(field: EntityFieldPresentation): string {
  return [field.isPrimaryKey ? 'PK' : '', field.isForeignKey ? 'FK' : '', field.isUnique ? 'UQ' : '', field.isNotNull ? 'NN' : '', field.isNullable ? 'NULL' : '']
    .filter(Boolean).join('·');
}

function fieldTexts(fields: readonly EntityFieldPresentation[], width: number, height: number): ClassEntityText[] {
  const top = CLASS_ENTITY_HEADER_HEIGHT + CLASS_ENTITY_CONTENT_PADDING;
  const slots = Math.max(1, Math.floor((height - CLASS_ENTITY_HEADER_HEIGHT - CLASS_ENTITY_CONTENT_PADDING * 2) / CLASS_ENTITY_ROW_HEIGHT));
  const visible = visibleRowCount(fields.length, slots);
  return [
    ...fields.slice(0, visible).flatMap((field, index): ClassEntityText[] => {
      const y = top + index * CLASS_ENTITY_ROW_HEIGHT;
      return [
        { text: entityKeyLabel(field), x: CLASS_ENTITY_CONTENT_PADDING, y: y + 2, anchor: 'start', size: 9, weight: 700, ink: 'subText', family: MONO_FONT },
        { text: truncateTextToWidth(field.name || 'field', Math.max(20, width * 0.48 - 42)), x: CLASS_ENTITY_CONTENT_PADDING + ENTITY_KEY_COLUMN_WIDTH, y: y + 1, anchor: 'start', size: 11, weight: 500, ink: 'text', family: MONO_FONT },
        { text: truncateTextToWidth(field.dataType, Math.max(20, width * 0.4)), x: width - CLASS_ENTITY_CONTENT_PADDING, y: y + 2, anchor: 'end', size: 10, weight: 400, ink: 'subText', family: MONO_FONT },
      ];
    }),
    ...overflowText(fields.length - visible, CLASS_ENTITY_CONTENT_PADDING, top + visible * CLASS_ENTITY_ROW_HEIGHT),
  ];
}

export function classEntityLayout(node: SceneNode): ClassEntityLayout | null {
  const presentation = resolveClassEntityNodePresentation(node);
  if (!presentation) return null;
  const { width, height } = node.size;
  const header: ClassEntityText[] = [
    { text: presentation.kind === 'class' && presentation.stereotype ? `«${presentation.stereotype}»` : presentation.kind === 'class' ? 'Class' : 'Entity',
      x: width / 2, y: 6, anchor: 'middle', size: 9, weight: 600, ink: 'subText', family: FONT_STACKS.sans },
    { text: truncateTextToWidth(presentation.label, width - 24, 7.2), x: width / 2, y: 21, anchor: 'middle', size: 13, weight: 700, ink: 'text', family: FONT_STACKS.sans },
  ];
  if (presentation.kind === 'er_entity') {
    return { dividers: [CLASS_ENTITY_HEADER_HEIGHT], texts: [...header, ...fieldTexts(presentation.fields, width, height)] };
  }
  const { attributeSlots, methodSlots, methodsTop, dividerY } = classCompartments(height);
  const rowWidth = width - CLASS_ENTITY_CONTENT_PADDING * 2;
  return {
    dividers: [CLASS_ENTITY_HEADER_HEIGHT, dividerY],
    texts: [
      ...header,
      ...memberTexts(presentation.attributes, attributeSlots, CLASS_ENTITY_CONTENT_PADDING, CLASS_ENTITY_HEADER_HEIGHT + CLASS_ENTITY_CONTENT_PADDING, rowWidth),
      ...memberTexts(presentation.methods, methodSlots, CLASS_ENTITY_CONTENT_PADDING, methodsTop, rowWidth),
    ],
  };
}
