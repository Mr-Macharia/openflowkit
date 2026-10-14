import type { SceneConnector, ScenePage } from '../document/types';
import type { Bounds2d, Matrix2d, Point2d } from '../geometry/types';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../scene/worldGeometry';
import { easeOutCubic } from './frame';
import { autoSequence } from './sequence';

/**
 * An agent's change, built in on the canvas: its new shapes pop in in connector order (the export's Build order), its
 * connectors draw on once their ends are there, and the shapes it moved slide from where they were. A view over the
 * committed page, never the page itself: the change is one undo step and in the document before the first frame.
 */

/** From this many new and moved shapes, the change shows in one quick fade instead of a choreography. */
export const REVEAL_CAP = 60;
/** Past this many, no build-in (a plan with no groups): it draws its shapes a second time, a long task at hundreds (review 2 #3). */
export const REVEAL_MAX = 150;
const POP_MS = 300;
const LINE_MS = 220;
/** A connector starts drawing once its later end is half in. */
const LINE_AFTER_MS = 120;
/** Every node starts within this much of the first, so a change of any size builds in well under a second. */
const STAGGER_BUDGET_MS = 220;
const MAX_STAGGER_MS = 110;
const MORPH_MS = 420;
const FADE_MS = 220;
/** A pop starts at this scale. */
const POP_FROM = 0.92;
/** Past the farthest end, so a line's markers and bends are uncovered before the mask goes. */
const LINE_MARGIN = 40;

export interface RevealGroup {
  readonly nodeIds: readonly string[];
  readonly connectorIds: readonly string[];
  /**
   * pop: fades in and grows from 92 % about `pivot`. line: drawn outward from `pivot` (its source end) to `reach`.
   * morph: slides and resizes from `from` to `to` (its place now). fade: opacity only.
   */
  readonly kind: 'pop' | 'line' | 'morph' | 'fade';
  readonly startMs: number;
  readonly ms: number;
  readonly pivot: Point2d;
  readonly reach: number;
  readonly from?: Bounds2d;
  readonly to?: Bounds2d;
}

export interface RevealPlan {
  readonly groups: readonly RevealGroup[];
  readonly durationMs: number;
  /** Where the change lands, first and last shape built (each at its lower right): the agent cursor's way points, world space. */
  readonly trail: readonly Point2d[];
  /** World bounds of everything the change added or moved. */
  readonly bounds: Bounds2d;
}

/** How a group is drawn at a moment: the layer's opacity, the world point its `pivot` sits at, its scale, and the line's uncovered radius. */
export interface RevealState {
  readonly opacity: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Line only, while it draws: how far from `pivot` it is uncovered. Null once whole (or not a line). */
  readonly radius: number | null;
}

const center = (b: Bounds2d): Point2d => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/** Where a cursor rests on a shape: its lower right, so the arrow and its name pill leave the label readable. */
const aim = (b: Bounds2d): Point2d => ({ x: b.x + b.width * 0.85, y: b.y + b.height * 0.8 });
const same = (a: Bounds2d, b: Bounds2d): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
const union = (all: readonly Bounds2d[]): Bounds2d => {
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return { x, y, width: Math.max(...all.map((b) => b.x + b.width)) - x, height: Math.max(...all.map((b) => b.y + b.height)) - y };
};

function worldBounds(page: ScenePage): Map<string, Bounds2d> {
  const matrices: ReadonlyMap<string, Matrix2d> = buildNodeWorldMatrices(page);
  const out = new Map<string, Bounds2d>();
  for (const node of page.nodes) {
    const matrix = matrices.get(node.id);
    if (matrix) out.set(node.id, nodeWorldBounds(node, matrix));
  }
  return out;
}

const ends = (connector: SceneConnector): string[] =>
  [connector.source.nodeId, connector.target.nodeId].filter((id): id is string => typeof id === 'string');

/**
 * What builds in when `before` becomes `after` (one page, an agent's commit): null when nothing was added or moved
 * (a removal, a restyle). Past `REVEAL_MAX` shapes it has no groups; from `REVEAL_CAP` it is one fade.
 */
export function planAgentReveal(before: ScenePage, after: ScenePage): RevealPlan | null {
  const had = new Map(before.nodes.map((node) => [node.id, node]));
  const was = worldBounds(before);
  const now = worldBounds(after);
  const added = after.nodes.filter((node) => !had.has(node.id) && now.has(node.id));
  const moved = after.nodes.filter((node) => {
    const from = was.get(node.id);
    const to = now.get(node.id);
    return from && to && !same(from, to);
  });
  const oldConnectors = new Map(before.connectors.map((connector) => [connector.id, connector]));
  // A connector re-pointed at other shapes is new to the eye.
  const newConnectors = after.connectors.filter((connector) => {
    const old = oldConnectors.get(connector.id);
    return !old || old.source.nodeId !== connector.source.nodeId || old.target.nodeId !== connector.target.nodeId;
  });
  if (!added.length && !moved.length && !newConnectors.length) return null;
  const touched = [...added, ...moved].map((node) => now.get(node.id)!);
  const connectorEnds = newConnectors.flatMap(ends).map((id) => now.get(id)).filter((b): b is Bounds2d => !!b);
  const bounds = union(touched.length ? touched : connectorEnds.length ? connectorEnds : [{ x: 0, y: 0, width: 0, height: 0 }]);
  const pointOf = (id: string): Point2d => center(now.get(id)!);
  // Too big to build in: the shapes simply show (no groups); the cursor still goes to the change.
  if (added.length + moved.length > REVEAL_MAX) return { groups: [], durationMs: 0, trail: [aim(bounds)], bounds };

  if (added.length + moved.length >= REVEAL_CAP) {
    const group: RevealGroup = {
      nodeIds: added.map((node) => node.id), connectorIds: newConnectors.map((connector) => connector.id),
      kind: 'fade', startMs: 0, ms: FADE_MS, pivot: center(bounds), reach: 0,
    };
    return { groups: [group], durationMs: FADE_MS, trail: [aim(bounds)], bounds };
  }

  const groups: RevealGroup[] = [];
  // Diagram frames are the stage the rest builds on: they come in first, whole.
  const frames = added.filter((node) => node.kind === 'frame');
  if (frames.length) groups.push({ nodeIds: frames.map((node) => node.id), connectorIds: [], kind: 'fade', startMs: 0, ms: POP_MS, pivot: pointOf(frames[0]!.id), reach: 0 });
  // Build order over the new shapes, their ancestors along so positions resolve, and the connectors among them.
  const newIds = new Set(added.filter((node) => node.kind !== 'frame').map((node) => node.id));
  const byId = new Map(after.nodes.map((node) => [node.id, node]));
  const keep = new Set<string>();
  for (const id of newIds) for (let at: string | null | undefined = id; at && !keep.has(at); at = byId.get(at)?.parentId) keep.add(at);
  const sub: ScenePage = {
    ...after,
    nodes: after.nodes.filter((node) => keep.has(node.id)),
    connectors: newConnectors.filter((connector) => ends(connector).every((id) => newIds.has(id))),
  };
  const order = autoSequence(sub).steps.flatMap((step) => step.nodeIds).filter((id) => newIds.has(id));
  const stagger = order.length > 1 ? Math.min(MAX_STAGGER_MS, STAGGER_BUDGET_MS / (order.length - 1)) : 0;
  const startOf = new Map(order.map((id, index) => [id, Math.round(index * stagger)]));
  for (const id of order) {
    groups.push({ nodeIds: [id], connectorIds: [], kind: 'pop', startMs: startOf.get(id)!, ms: POP_MS, pivot: pointOf(id), reach: 0 });
  }
  const movedIds = new Set(moved.map((node) => node.id));
  for (const node of moved) {
    const from = was.get(node.id)!;
    const to = now.get(node.id)!;
    groups.push({ nodeIds: [node.id], connectorIds: [], kind: 'morph', startMs: 0, ms: MORPH_MS, pivot: { x: to.x, y: to.y }, reach: 0, from, to });
  }
  // A moved shape's connectors would sit at its new place while it slides: they come back once it lands.
  const afterMove = after.connectors.filter((connector) => ends(connector).some((id) => movedIds.has(id)));
  if (afterMove.length) {
    groups.push({ nodeIds: [], connectorIds: afterMove.map((connector) => connector.id), kind: 'fade', startMs: Math.round(MORPH_MS * 0.75), ms: FADE_MS, pivot: center(bounds), reach: 0 });
  }
  for (const connector of newConnectors) {
    if (afterMove.includes(connector)) continue;
    const [source, target] = [connector.source, connector.target];
    const from = source.nodeId && now.has(source.nodeId) ? pointOf(source.nodeId) : source.point
      ?? (target.nodeId && now.has(target.nodeId) ? pointOf(target.nodeId) : center(bounds));
    const far = [source, target].flatMap((end) => {
      const box = end.nodeId ? now.get(end.nodeId) : undefined;
      if (box) return [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height }];
      return end.point ? [end.point] : [];
    }).reduce((most, point) => Math.max(most, Math.hypot(point.x - from.x, point.y - from.y)), 0);
    const startMs = Math.max(-LINE_AFTER_MS, ...ends(connector).map((id) => startOf.get(id) ?? -LINE_AFTER_MS)) + LINE_AFTER_MS;
    groups.push({ nodeIds: [], connectorIds: [connector.id], kind: 'line', startMs, ms: LINE_MS, pivot: from, reach: far + LINE_MARGIN });
  }
  const durationMs = Math.max(...groups.map((group) => group.startMs + group.ms));
  const firstId = order[0] ?? moved[0]?.id;
  const lastId = order.at(-1) ?? moved.at(-1)?.id;
  const aimAt = (id: string): Point2d => aim(now.get(id)!);
  const trail = firstId && lastId ? (firstId === lastId ? [aimAt(firstId)] : [aimAt(firstId), aimAt(lastId)]) : [aim(bounds)];
  return { groups, durationMs, trail, bounds };
}

/**
 * The plan for what is on screen (the host's culled ids; null: everything is drawn). A group keeps only those ids and
 * goes when none are left: off screen, the page draws the rest as usual, so the reveal never draws what nobody sees.
 */
export function cullReveal(plan: RevealPlan, nodeIds: ReadonlySet<string> | null, connectorIds: ReadonlySet<string> | null): RevealPlan {
  if (!nodeIds && !connectorIds) return plan;
  const groups = plan.groups.map((group) => ({
    ...group,
    nodeIds: nodeIds ? group.nodeIds.filter((id) => nodeIds.has(id)) : group.nodeIds,
    connectorIds: connectorIds ? group.connectorIds.filter((id) => connectorIds.has(id)) : group.connectorIds,
  })).filter((group) => group.nodeIds.length + group.connectorIds.length > 0);
  return { ...plan, groups };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A group at `tMs` after the reveal started: hidden before its start (a morph waits at its old place), whole after its end. */
export function revealStateAt(group: RevealGroup, tMs: number): RevealState {
  const p = Math.min(1, Math.max(0, (tMs - group.startMs) / group.ms));
  const e = easeOutCubic(p);
  const { pivot } = group;
  if (group.kind === 'morph' && group.from && group.to) {
    const { from, to } = group;
    return {
      opacity: 1, x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e),
      scaleX: lerp(to.width ? from.width / to.width : 1, 1, e), scaleY: lerp(to.height ? from.height / to.height : 1, 1, e), radius: null,
    };
  }
  if (group.kind === 'pop') {
    const scale = POP_FROM + (1 - POP_FROM) * e;
    return { opacity: e, x: pivot.x, y: pivot.y, scaleX: scale, scaleY: scale, radius: null };
  }
  if (group.kind === 'line') {
    // Visible as soon as it starts: the mask, not the opacity, draws it on.
    return { opacity: p > 0 ? Math.min(1, p * 4) : 0, x: pivot.x, y: pivot.y, scaleX: 1, scaleY: 1, radius: p < 1 ? group.reach * e : null };
  }
  return { opacity: e, x: pivot.x, y: pivot.y, scaleX: 1, scaleY: 1, radius: null };
}

/** How long the agent cursor takes to glide `px` screen pixels: calm, never a jump, never a crawl. */
export function cursorGlideMs(px: number): number {
  return Math.round(Math.min(950, Math.max(420, 320 + px * 0.55)));
}
