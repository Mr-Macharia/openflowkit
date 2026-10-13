import type { SceneNode, ScenePage } from '../../opencanvas/domain/document/types';
import { createDefaultSceneLayer } from '../../opencanvas/domain/document/defaults';
import { SUBLABEL_FONT, TEXT_PADDING } from '../sizing';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { architectureCardHeight } from '../../opencanvas/domain/nodes/architectureCardLayout';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import type { Point2d, Size2d } from '../../opencanvas/domain/geometry/types';
import { boundaryNode, elementNode, relationConnector, type ElementContext } from '../families/architecture/scene';
import type { ArchElement, ArchModel } from '../model/types';
import type { LaidRect } from './elk';
import type { AggEdge, MapModel, MapNode } from './types';
import { edgeText, visible } from './view';

// The map as an ordinary ScenePage, so the editor's own renderers draw it. Derived from (model, open boxes, layout),
// never stored: closed boxes are the architecture family's nodes (same shapes, icons, palette as a Canvas page),
// open boxes are its boundary frames, arrows are its connectors with the aggregated count as the label.

/**
 * What the architecture node builders need that the map itself does not hold: the C4 elements (the map keeps only names)
 * and the compile's palette and icon resolvers, so a map draws exactly as a Canvas page of the same model.
 */
export interface MapLook extends Omit<ElementContext, 'origin'> {
  arch: ArchModel;
  /** Box id -> the kind tag its card shows ("Folder · 12 files") in place of the C4 kind word; a repo map has no C4 kinds. */
  tags?: ReadonlyMap<string, string>;
}

/** Where each visible box sits (absolute coordinates, as ELK hands them back) and which arrows are drawn. */
interface MapLayout {
  rects: ReadonlyMap<string, LaidRect>;
  edges: readonly AggEdge[];
}

const ORIGIN: Point2d = { x: 0, y: 0 };

/** The boxes the engine invents (`#more`, alphabetical range groups) are no C4 element: they draw as a plain neutral box with no icon. */
const synthetic = (id: string, name: string, desc?: string): ArchElement =>
  ({ id, kind: 'container', name, ...(desc ? { desc } : {}), parent: null, tags: [], links: [], icon: 'none', color: 'gray' });

// The family's card names its kind under the title ("[Service]"); an invented box has none, only its description.
const unlabelled = (node: SceneNode): SceneNode => {
  const { subLabel: _kind, ...content } = node.content;
  const desc = typeof _kind === 'string' ? _kind.split('\n').slice(1).join('\n') : '';
  return { ...node, content: { ...content, ...(desc ? { subLabel: desc } : {}) } };
};

// A repo box says its repo word where the C4 kind word was: on a card, the chip (its note is the card's own detail
// line); on an open box, the frame's footer, with the note beside it ("Folder · 12 files") and no C4 brackets.
// A kind line on a map reads plainly ("Software system · React"), without the Canvas card's brackets.
const unbracketed = (node: SceneNode): SceneNode => {
  const text = node.content.subLabel;
  return typeof text === 'string' && /^\[[^\]\n]*\]/.test(text) ? { ...node, content: { ...node.content, subLabel: text.replace(/^\[([^\]\n]*)\]/, '$1') } } : node;
};

const retag = (node: SceneNode, element: ArchElement, tag: string): SceneNode => {
  const content = node.kind === 'architecture'
    ? { archProviderLabel: tag, subLabel: [[tag, element.tech].filter(Boolean).join(' · '), element.desc].filter(Boolean).join('\n') }
    : node.kind === 'frame' ? { subLabel: [tag, element.desc].filter(Boolean).join(' · ') }
      : { subLabel: [`[${tag}]`, ...String(node.content.subLabel ?? '').split('\n').slice(1)].join('\n') };
  return { ...node, content: { ...node.content, ...content } };
};

export const closedBoxSize = (look: MapLook, node: MapNode): Size2d => {
  const element = look.arch.elements.find((e) => e.id === node.id)
    ?? (node.kind === 'more' || node.kind === 'group' ? synthetic(node.id, node.name, node.desc) : undefined);
  if (!element) throw new Error(`map: no element ${node.id}`);
  // The card is sized for the kind word it would show ("Service"); a repo tag ("Folder · 120 files") can be wider, so the box grows to it.
  const tag = look.tags?.get(node.id);
  const tagWidth = tag ? Math.ceil(measurePortableText(`[${tag}]`, { ...SUBLABEL_FONT, maxWidth: 400, overflow: 'visible' }).width) + 2 * TEXT_PADDING : 0;
  const drawn = elementNode(element, null, 0, { ...look, origin: ORIGIN, measureLabel: (label, kind) => {
    const own = look.measureLabel?.(label, kind);
    return { width: Math.max(own?.width ?? 0, tagWidth), height: own?.height ?? 0 };
  } });
  // A card is as tall as what it says (name, kind, a line or two), not the Canvas card's roomy default.
  return drawn.kind === 'architecture' ? { width: drawn.size.width, height: architectureCardHeight(drawn, resolveNodeStyle(drawn)) } : drawn.size;
};

export function mapScene(model: MapModel, open: ReadonlySet<string>, layout: MapLayout, look: MapLook): ScenePage {
  const elements = new Map(look.arch.elements.map((e) => [e.id, e]));
  const ctx = { ...look, origin: ORIGIN };
  const nodes: SceneNode[] = [];
  visible(model, open).forEach((id, i) => {
    const rect = layout.rects.get(id);
    const node = model.nodes[id];
    const element = elements.get(id) ?? (node.kind === 'more' || node.kind === 'group' ? synthetic(id, node.name, node.desc) : undefined);
    if (!rect || !element) throw new Error(`map: nothing to draw for ${id}`);
    const parent = node.parent;
    const parentRect = parent && parent !== model.root ? layout.rects.get(parent) : undefined;
    const isOpen = open.has(id) && node.children.length;
    const parentId = parentRect ? parent : null;
    const tag = look.tags?.get(id);
    const drawn = isOpen ? boundaryNode(element, parentId, i + 1, ctx) : elementNode(element, parentId, i + 1, ctx);
    const built = unbracketed(tag ? retag(drawn, element, tag) : drawn);
    nodes.push({
      ...(elements.has(id) ? built : unlabelled(built)),
      size: { width: rect.width, height: rect.height },
      // Scene positions are relative to the parent; ELK's are absolute.
      transform: { ...built.transform, translation: { x: rect.x - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0) } },
    });
  });

  for (const e of layout.edges) for (const end of [e.from, e.to]) if (!layout.rects.has(end)) throw new Error(`map: nothing to draw for ${end}`);
  const connectors = layout.edges.map((e) => {
    // Solid only where a relation joins exactly these two boxes: an arrow with at least one such relation is real, one that rides up from deeper boxes is implied.
    const direct = e.links.some((l) => (l.from === e.from && l.to === e.to) || (l.from === e.to && l.to === e.from));
    const built = relationConnector({ id: e.key, from: e.from, to: e.to, label: edgeText(e), tags: [] }, e.from, e.to, e.inferred || !direct || !!e.minor);
    // Direction matters in architecture: every arrow has a head at its target, and a two-way arrow one at each end (the connector's own markerStart/markerEnd).
    const connector = { ...built, appearance: { ...built.appearance, ...(e.both ? { markerStart: 'arrow' } : {}), markerEnd: 'arrow' } };
    // fromArch makes each relation's id its evidence `file`, so the panel can list the relations behind this arrow.
    const relations = [...new Set(e.links.flatMap((l) => l.evidence.map((ev) => ev.file)))].sort();
    return { ...connector, metadata: { ...connector.metadata, map: { count: e.count, minor: !!e.minor, both: e.both, relations } } };
  });

  return {
    id: 'map', name: model.nodes[model.root].name, diagramKind: 'architecture',
    layers: [createDefaultSceneLayer()], nodes, connectors, metadata: {}, extensions: {},
  };
}
