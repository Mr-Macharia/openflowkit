import { resolveContainerVisualStyle } from '@/theme';
import { normalizeHex } from '@/lib/colorUtils';
import { nodePaletteName } from '../../domain/nodes/nodePalette';
import type { SceneNode } from '../../domain/document/types';
import {
  resolveClassEntityNodePresentation,
  type ClassEntityNodePresentation,
} from '../../domain/nodes/classEntityNodePresentation';
import { pixiHexColor } from './pixiColor';

export interface PixiClassEntityNodeVisual {
  readonly presentation: ClassEntityNodePresentation;
  readonly fill: number;
  readonly stroke: number;
  readonly text: number;
  readonly subText: number;
  readonly headerFill: number;
  readonly alternateFill: number;
}

/** Class and entity ink as hex, shared by the canvas and the SVG export so the two cannot drift. */
export interface ClassEntityNodeColors {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
  readonly subText: string;
  readonly headerFill: string;
  readonly alternateFill: string;
}

const pick = (value: string, fallback: string) => normalizeHex(value) ?? fallback;

function colorsFor(presentation: ClassEntityNodePresentation, node: SceneNode): ClassEntityNodeColors {
  const colors = resolveContainerVisualStyle(
    presentation.colorKey,
    presentation.colorMode,
    presentation.customColor,
    'slate',
    nodePaletteName(node)
  );
  return {
    fill: pick(colors.bg, '#f8fafc'),
    stroke: pick(colors.border, '#94a3b8'),
    text: pick(colors.text, '#0f172a'),
    subText: pick(colors.subText, '#475569'),
    headerFill: pick(colors.accentBg, '#e2e8f0'),
    alternateFill: pick(colors.hoverBg, '#f1f5f9'),
  };
}

export function classEntityNodeColors(node: SceneNode): ClassEntityNodeColors | null {
  const presentation = resolveClassEntityNodePresentation(node);
  return presentation ? colorsFor(presentation, node) : null;
}

export function projectClassEntityNodeVisual(node: SceneNode): PixiClassEntityNodeVisual | null {
  const presentation = resolveClassEntityNodePresentation(node);
  if (!presentation) return null;
  const colors = colorsFor(presentation, node);
  return {
    presentation,
    fill: pixiHexColor(colors.fill, 0xf8fafc),
    stroke: pixiHexColor(colors.stroke, 0x94a3b8),
    text: pixiHexColor(colors.text, 0x0f172a),
    subText: pixiHexColor(colors.subText, 0x475569),
    headerFill: pixiHexColor(colors.headerFill, 0xe2e8f0),
    alternateFill: pixiHexColor(colors.alternateFill, 0xf1f5f9),
  };
}
