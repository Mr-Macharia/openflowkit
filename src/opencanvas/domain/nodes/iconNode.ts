import type { SceneNode, ScenePage } from '../document/types';
import type { Point2d, Size2d } from '../geometry/types';
import { areStructurallyEqual } from '../commands/equality';
import { isJsonObject, type JsonObject } from '../document/json';
import { DEFAULT_NODE_CONTENT_LAYOUT } from '../node-layout/model';
import type { IconCardPlacement } from './architectureNodePresentation';
import { iconCardSize } from './iconCardLayout';
import { nextNodeZIndex } from './shapeNode';

/** One icon from a provider pack (AWS, Azure, GCP, CNCF, developer, Tabler). */
export interface IconChoice {
  readonly provider: string;
  readonly packId: string;
  readonly shapeId: string;
  readonly label: string;
}

/** The keys that pick the glyph alone: a card's own look (header label, tech, layout) is left as it is. */
function glyphContent(icon: IconChoice): Record<string, string> {
  return {
    icon: `${icon.provider}/${icon.shapeId}`,
    archProvider: icon.provider,
    archIconPackId: icon.packId,
    archIconShapeId: icon.shapeId,
  };
}

// The content keys the DSL compiler writes for `Name [aws/lambda]`, so an icon
// picked on the canvas serialises back to the same line and re-renders through
// the same architecture presentation.
export function iconContent(icon: IconChoice): Record<string, string> {
  return { ...glyphContent(icon), archResourceType: icon.shapeId, assetPresentation: 'icon' };
}

/** `node` at `size` with its visual centre where it was: the translation is the rotation's pivot, so the shift turns with the node. */
export function resizedAroundCentre(node: SceneNode, size: Size2d): SceneNode {
  const { rotationRadians, scale, translation } = node.transform;
  const dx = (node.size.width - size.width) / 2 * scale.x;
  const dy = (node.size.height - size.height) / 2 * scale.y;
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  return {
    ...node, size,
    transform: { ...node.transform, translation: { x: translation.x + cosine * dx - sine * dy, y: translation.y + sine * dx + cosine * dy } },
  };
}

export function withIcon(node: SceneNode, icon: IconChoice): SceneNode {
  // A card keeps being a card and only its glyph changes; anything else becomes an icon tile.
  const card = node.kind === 'architecture' && node.content.assetPresentation !== 'icon';
  const next = { ...node, kind: 'architecture', content: { ...node.content, ...(card ? glyphContent(icon) : iconContent(icon)) } };
  // A plain shape turning into a tile takes the size its caption hugs, so the plate and caption sit inside its box.
  return card || node.content.assetPresentation === 'icon' ? next : resizedAroundCentre(next, iconCardSize(next));
}

function iconTile(id: string, layerId: string, zIndex: number, at: Point2d, icon: IconChoice, label: string): SceneNode {
  return {
    id,
    kind: 'architecture',
    parentId: null,
    layerId,
    zIndex,
    transform: { translation: { ...at }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { width: 1, height: 1 },
    content: { label, ...iconContent(icon) },
    appearance: {},
    ports: [],
    metadata: {},
    extensions: {},
  };
}

/** The size an icon tile takes from its caption: what the DSL compiler gives the same label. */
export function iconNodeSize(icon: IconChoice, label = icon.label): Size2d {
  return iconCardSize(iconTile('', '', 0, { x: 0, y: 0 }, icon, label));
}

/** `content` with its icon placement set. The default placement is not stored: a tile with no layout is a tile. */
export function withIconPlacement(content: SceneNode['content'], placement: IconCardPlacement): SceneNode['content'] {
  const { contentLayout, ...rest } = content;
  const layout: JsonObject = { ...(isJsonObject(contentLayout) ? contentLayout : DEFAULT_NODE_CONTENT_LAYOUT as unknown as JsonObject), iconPlacement: placement };
  return areStructurallyEqual(layout, DEFAULT_NODE_CONTENT_LAYOUT) ? rest : { ...rest, contentLayout: layout };
}

export function createIconNode(page: ScenePage, options: {
  readonly id: string; readonly at: Point2d; readonly icon: IconChoice; readonly label?: string;
}): SceneNode {
  const node = iconTile(options.id, page.layers[0]?.id ?? 'default', nextNodeZIndex(page), options.at, options.icon, options.label ?? options.icon.label);
  return { ...node, size: iconCardSize(node) };
}
