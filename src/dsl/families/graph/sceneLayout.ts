import type { SceneConnector, SceneNode } from '../../../opencanvas/domain/document/types';
import type { Point2d, Size2d } from '../../../opencanvas/domain/geometry/types';
import type { TypedAttributes } from '../../attributes';
import { slugifyDslId } from '../../text';
import { GROUP_INSETS } from '../../layout';
import { SHAPE_WORDS, dslShapeWord } from '../../vocabulary';

export const NOTE_GAP = 36;
// ponytail: the room is reserved to the right of the node only, so a noted node sits a little left of its row's centre — a centred reservation doubled the frame width.

/**
 * The room a node's notes take to its right, as the box the layout reserves. The node
 * sits `dy` below the box's top when its notes stack taller than it.
 */
export function noteSlots(
  drafts: readonly { id: string; targetId: string }[],
  nodes: readonly SceneNode[],
): Map<string, { box: Size2d; dy: number }> {
  const slots = new Map<string, { box: Size2d; dy: number }>();
  const size = (id: string) => nodes.find((node) => node.id === id)!.size;
  for (const targetId of new Set(drafts.map((draft) => draft.targetId))) {
    const notes = drafts.filter((draft) => draft.targetId === targetId).map(({ id }) => size(id));
    const target = size(targetId);
    const reach = NOTE_GAP + Math.max(...notes.map(({ width }) => width));
    const stack = notes.reduce((sum, { height }) => sum + height + NOTE_GAP / 2, -NOTE_GAP / 2);
    const height = Math.max(target.height, stack);
    slots.set(targetId, { box: { width: target.width + reach, height }, dy: (height - target.height) / 2 });
  }
  return slots;
}

export type Box = { parentId: string | null; at: Point2d; size: Size2d };

/** A box's top-left corner in the frame, through the groups it sits in. */
export function worldOrigin(boxes: ReadonlyMap<string, Box>, id: string): Point2d | null {
  let box = boxes.get(id);
  if (!box) return null;
  let x = 0;
  let y = 0;
  while (box) {
    x += box.at.x;
    y += box.at.y;
    box = box.parentId ? boxes.get(box.parentId) : undefined;
  }
  return { x, y };
}

/**
 * Opposite edges (`A -> B`, `B --> A`) would draw on one line. Once the layout has placed the nodes, each
 * gets its own lane on the two sides that face, at two heights. Edges with a side of their own are left alone.
 */
export function separateLanes(connectors: readonly SceneConnector[], boxes: ReadonlyMap<string, Box>): SceneConnector[] {
  const centre = (id: string): Point2d | null => {
    const box = boxes.get(id);
    const origin = worldOrigin(boxes, id);
    return box && origin ? { x: origin.x + box.size.width / 2, y: origin.y + box.size.height / 2 } : null;
  };
  const free = (connector: SceneConnector) => connector.source.anchor === null && connector.target.anchor === null && connector.source.nodeId && connector.target.nodeId;
  return connectors.map((connector, index) => {
    if (!free(connector)) return connector;
    const from = connector.source.nodeId!;
    const to = connector.target.nodeId!;
    if (from === to) return connector;
    const twin = connectors.findIndex((other) => free(other) && other.source.nodeId === to && other.target.nodeId === from);
    const [a, b] = [centre(from), centre(to)];
    if (twin < 0 || !a || !b) return connector;
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const out = horizontal ? (b.x >= a.x ? 'right' : 'left') : (b.y >= a.y ? 'bottom' : 'top');
    const into = ({ right: 'left', left: 'right', bottom: 'top', top: 'bottom' } as const)[out];
    // Both ends of a lane sit at the same spot across the two nodes' overlap, so it runs straight whatever
    // their widths; the earlier edge takes the first lane. Nodes that do not overlap fall back to one ratio.
    const lane = index < twin ? 0.3 : 0.7;
    const [oa, ob, sa, sb] = [worldOrigin(boxes, from)!, worldOrigin(boxes, to)!, boxes.get(from)!.size, boxes.get(to)!.size];
    const [aLow, aLength, bLow, bLength] = horizontal ? [oa.y, sa.height, ob.y, sb.height] : [oa.x, sa.width, ob.x, sb.width];
    const low = Math.max(aLow, bLow);
    const length = Math.min(aLow + aLength, bLow + bLength) - low;
    const at = (start: number, size: number) => length > 8 ? Math.min(0.95, Math.max(0.05, (low + length * lane - start) / size)) : lane;
    return { ...connector, source: endpoint(from, out, at(aLow, aLength)), target: endpoint(to, into, at(bLow, bLength)) };
  });
}

/** The bump a self-loop makes out of the right side (see `selfLoopPath`), plus the label on it. */
export function loopReach(edges: readonly { sourceId: string; targetId: string; label?: string }[]): Map<string, number> {
  const reach = new Map<string, number>();
  for (const edge of edges) {
    if (edge.sourceId !== edge.targetId) continue;
    reach.set(edge.sourceId, Math.max(reach.get(edge.sourceId) ?? 0, 48 + (edge.label ? Math.min(220, edge.label.length * 7 + 14) : 0)));
  }
  return reach;
}

export const withLoopRoom = (size: Size2d, reach = 0): Size2d => (reach ? { ...size, width: size.width + reach } : size);

/** `align row A, B` / `align column A, B`: one coordinate shared after layout; groups are obstacles too. */
export function applyAlignDirectives(
  alignLines: readonly string[],
  positions: Map<string, Point2d>,
  nodes: readonly SceneNode[],
  groups: readonly SceneNode[],
): void {
  const obstacles = [...nodes, ...groups];
  for (const line of alignLines) {
    const match = /^align\s+(row|column)\s+(.+)$/i.exec(line);
    if (!match) continue;
    const names = match[2]!.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
    const members = nodes.filter((node) => names.includes(node.id) || names.includes(slugifyDslId(String(node.content.label))));
    if (members.length < 2) continue;
    const row = match[1]!.toLowerCase() === 'row';
    const anchor = positions.get(members[0]!.id) ?? { x: 0, y: 0 };
    for (const node of members) {
      const current = positions.get(node.id) ?? { x: 0, y: 0 };
      let at = row ? { x: current.x, y: anchor.y } : { x: anchor.x, y: current.y };
      // Snapped onto another layer, a node can land on a sibling there (D under C, aligned with B,
      // lands on C): it moves on along the aligned axis until it is clear.
      for (let tries = 0; tries < nodes.length; tries += 1) {
        const hit = obstacles.find((other) => other !== node && other.parentId === node.parentId && overlaps(at, node.size, positions.get(other.id), other.size));
        if (!hit) break;
        const there = positions.get(hit.id)!;
        at = row ? { x: there.x + hit.size.width + ALIGN_GAP, y: at.y } : { x: at.x, y: there.y + hit.size.height + ALIGN_GAP };
      }
      positions.set(node.id, at);
    }
  }
}

const ALIGN_GAP = 48;

/** Groups grown (innermost first) to hold children that `align` or `pin` moved past their edge. */
export function holdChildren(groups: readonly SceneNode[], nodes: readonly SceneNode[], positions: ReadonlyMap<string, Point2d>): SceneNode[] {
  const parentOf = new Map(groups.map((group) => [group.id, group.parentId]));
  const depth = (id: string) => {
    let levels = 0;
    for (let at = parentOf.get(id); at && parentOf.has(at); at = parentOf.get(at)) levels += 1;
    return levels;
  };
  const sizes = new Map(groups.map((group) => [group.id, group.size]));
  for (const group of [...groups].sort((a, b) => depth(b.id) - depth(a.id))) {
    const children = [...nodes, ...groups].filter((child) => child.parentId === group.id);
    sizes.set(group.id, children.reduce((size, child) => {
      const at = positions.get(child.id) ?? { x: 0, y: 0 };
      const box = sizes.get(child.id) ?? child.size;
      return {
        width: Math.max(size.width, at.x + box.width + GROUP_INSETS.right),
        height: Math.max(size.height, at.y + box.height + GROUP_INSETS.bottom),
      };
    }, sizes.get(group.id)!));
  }
  return groups.map((group) => ({ ...group, size: sizes.get(group.id)! }));
}

function overlaps(at: Point2d, size: Size2d, other: Point2d | undefined, otherSize: Size2d): boolean {
  return Boolean(other) && at.x < other!.x + otherSize.width && other!.x < at.x + size.width
    && at.y < other!.y + otherSize.height && other!.y < at.y + size.height;
}

/** Shapes whose DSL word the renderer cannot infer back from the scene shape alone. */
export function isLossyShape(word: string, kind: string): boolean {
  const spec = SHAPE_WORDS[word];
  return Boolean(spec) && spec!.kind === kind && dslShapeWord(spec!.kind, spec!.shape) !== word;
}

export function endpoint(nodeId: string, side: TypedAttributes['from'], ratio = 0.5): SceneConnector['source'] {
  const anchor = side ? { kind: 'side' as const, side, ratio } : null;
  return { nodeId, portId: null, anchor, point: null };
}

export function marker(value: string): string {
  if (value === 'circle') return 'circle';
  if (value === 'cross') return 'cross';
  if (value === 'diamond') return 'diamond-open';
  return 'arrow';
}

export function iconProvider(icon: string): string {
  const [provider] = icon.split(/[/:-]/);
  return provider || 'custom';
}

export function iconResource(icon: string): string {
  const [, ...rest] = icon.split(/[/:-]/);
  return rest.join('-') || icon;
}

