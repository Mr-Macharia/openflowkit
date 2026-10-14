import type { ConnectorEndpoint, SceneAnchor, SceneConnector, SceneNode } from '../document/types';
import { applyMatrixToPoint, invertMatrix } from '../geometry/matrix';
import type { Bounds2d, Matrix2d, Point2d } from '../geometry/types';
import { boundsFromPoints } from '../geometry/bounds';
import { transformBounds } from '../geometry/matrix';
import { nodeConnectBounds, nodeOutline } from '../nodes/nodeLabelBounds';
import { nodeWorldCenter } from '../scene/worldGeometry';
import { clearAlong, ROUTE_CLEARANCE } from './obstacleRouting';
import { facingSide, sideAnchor, type ConnectSide } from './connectHandles';

/** Where an automatic orthogonal end meets its node: the side, and how far off its middle. */
export interface SpreadEnd {
  readonly side: ConnectSide;
  readonly offset: number;
}


/** The box edges meet, world-space: the painted silhouette's (an icon tile's plate down to its caption, not the box around it). */
export function connectWorldBounds(node: SceneNode, matrix: Matrix2d): Bounds2d {
  return transformBounds(matrix, nodeConnectBounds(node));
}

const SPREAD_STEP_PX = 24;

/**
 * Where a line in from `side`, `along` px off its middle, first meets the outline
 * (node-local): a diamond's slanted edge, a parallelogram's lean, a circle's rim.
 */
function outlineHit(outline: readonly Point2d[], side: ConnectSide, along: number): Point2d | null {
  const vertical = side === 'top' || side === 'bottom';
  let best: Point2d | null = null;
  outline.forEach((from, index) => {
    const to = outline[(index + 1) % outline.length]!;
    const [a, b] = vertical ? [from.x, to.x] : [from.y, to.y];
    if ((a - along) * (b - along) > 0 || a === b) return;
    const t = (along - a) / (b - a);
    const hit = vertical ? { x: along, y: from.y + t * (to.y - from.y) } : { x: from.x + t * (to.x - from.x), y: along };
    const better = !best || (side === 'top' ? hit.y < best.y : side === 'bottom' ? hit.y > best.y : side === 'left' ? hit.x < best.x : hit.x > best.x);
    if (better) best = hit;
  });
  return best;
}

/**
 * An automatic end's point: `offset` px along `side` from its middle, on the painted
 * outline. A downward end under an icon plate leaves below its caption instead.
 * ponytail: rotated or flipped nodes meet their box side; project onto the outline there too if one shows up.
 */
function outlinePoint(node: SceneNode, matrix: Matrix2d, side: ConnectSide, offset: number): Point2d {
  const outline = nodeOutline(node);
  const connect = nodeConnectBounds(node);
  const painted = boundsFromPoints(outline)!;
  const vertical = side === 'top' || side === 'bottom';
  if (matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) {
    const middle = sideAnchor(transformBounds(matrix, connect), side);
    return vertical ? { x: middle.x + offset, y: middle.y } : { x: middle.x, y: middle.y + offset };
  }
  const along = vertical ? connect.x + connect.width / 2 + offset / matrix.a : painted.y + painted.height / 2 + offset / matrix.d;
  // Only a captioned tile reaches below its outline; its bottom end goes down to the caption's foot.
  const caption = side === 'bottom' && connect.y + connect.height > painted.y + painted.height + 0.5;
  const local = caption ? { x: along, y: connect.y + connect.height }
    : outlineHit(outline, side, along) ?? sideAnchor(side === 'bottom' ? connect : painted, side);
  return applyMatrixToPoint(matrix, local);
}

/**
 * Automatic orthogonal ends that meet the same flat side spread along it, ordered
 * by where their other ends sit, so no two edges share a point or a final run (the
 * "bracket" a fan-in drew when every end took the side's middle).
 */
export function spreadEnds(
  connectors: readonly SceneConnector[],
  nodesById: ReadonlyMap<string, SceneNode>,
  matrices: ReadonlyMap<string, Matrix2d>
): ReadonlyMap<string, SpreadEnd> {
  const bounds = new Map<string, Bounds2d>();
  const boundsOf = (node: SceneNode): Bounds2d => {
    const known = bounds.get(node.id);
    if (known) return known;
    const fresh = connectWorldBounds(node, matrices.get(node.id)!);
    bounds.set(node.id, fresh);
    return fresh;
  };
  const sides = new Map<string, { key: string; node: SceneNode; side: ConnectSide; along: number }[]>();
  for (const connector of connectors) {
    const { source, target } = connector;
    if (connector.route.kind !== 'orthogonal' || connector.waypoints.length > 0 || connector.metadata.hidden === true) continue;
    if (typeof connector.semantics.seqMessageKind === 'string' || !source.nodeId || !target.nodeId || source.nodeId === target.nodeId) continue;
    const sourceNode = nodesById.get(source.nodeId);
    const targetNode = nodesById.get(target.nodeId);
    if (!sourceNode || !targetNode || !matrices.has(sourceNode.id) || !matrices.has(targetNode.id)) continue;
    for (const [end, self, other, which] of [[source, sourceNode, targetNode, 'source'], [target, targetNode, sourceNode, 'target']] as const) {
      if (endAnchor(end, self)) continue;
      const side = facingSide(boundsOf(self), boundsOf(other));
      const otherBounds = boundsOf(other);
      const along = side === 'top' || side === 'bottom' ? otherBounds.x + otherBounds.width / 2 : otherBounds.y + otherBounds.height / 2;
      const group = `${self.id}:${side}`;
      sides.set(group, [...(sides.get(group) ?? []), { key: `${connector.id}:${which}`, node: self, side, along }]);
    }
  }
  const spread = new Map<string, SpreadEnd>();
  for (const ends of sides.values()) {
    const { node, side } = ends[0]!;
    if (ends.length < 2) continue;
    const box = boundsOf(node);
    const length = side === 'top' || side === 'bottom' ? box.width : box.height;
    const step = Math.min(SPREAD_STEP_PX, (length * 0.6) / (ends.length - 1));
    [...ends].sort((a, b) => a.along - b.along).forEach((end, index) => {
      spread.set(end.key, { side, offset: (index - (ends.length - 1) / 2) * step });
    });
  }
  return spread;
}

export function endAnchor(endpoint: ConnectorEndpoint, node: SceneNode): SceneAnchor | null {
  return endpoint.anchor
    ?? node.ports.find((port) => port.id === endpoint.portId)?.anchor
    ?? sideAnchorForDanglingPort(endpoint.portId);
}

export function anchorLocalPoint(node: SceneNode, anchor: SceneAnchor): Point2d {
  if (anchor.kind === 'center') return { x: node.size.width / 2, y: node.size.height / 2 };
  if (anchor.kind === 'normalized') {
    return { x: node.size.width * anchor.x, y: node.size.height * anchor.y };
  }
  const ratio = anchor.ratio;
  // Top and bottom spread along the connect box (an icon tile's reaches down to its caption); the sides along the
  // painted shape. Either way the end sits on the outline, as an automatic end does: a diamond's slanted edge, not the
  // box around it — except under a captioned tile, where it stays below the words.
  const box = nodeConnectBounds(node);
  const outline = nodeOutline(node);
  const painted = boundsFromPoints(outline)!;
  const along = anchor.side === 'top' || anchor.side === 'bottom' ? box.x + box.width * ratio : painted.y + painted.height * ratio;
  const caption = anchor.side === 'bottom' && box.y + box.height > painted.y + painted.height + 0.5;
  const hit = caption ? null : outlineHit(outline, anchor.side, along);
  if (hit) return hit;
  switch (anchor.side) {
    case 'top':
      return { x: box.x + box.width * ratio, y: box.y };
    case 'right':
      return { x: box.x + box.width, y: painted.y + painted.height * ratio };
    case 'bottom':
      return { x: box.x + box.width * ratio, y: box.y + box.height };
    case 'left':
      return { x: box.x, y: painted.y + painted.height * ratio };
  }
}

function automaticBoundaryPoint(
  node: SceneNode,
  matrix: Matrix2d,
  towardWorldPoint: Point2d
): Point2d {
  const inverse = invertMatrix(matrix);
  if (!inverse) return nodeWorldCenter(node, matrix);
  const toward = applyMatrixToPoint(inverse, towardWorldPoint);
  // The ray leaves the painted box (an icon tile's plate), so a side end meets what is drawn; only one that exits
  // through the bottom drops to the connect box's bottom, below the caption, as outlinePoint does.
  const box = boundsFromPoints(nodeOutline(node))!;
  const connect = nodeConnectBounds(node);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const delta = { x: toward.x - center.x, y: toward.y - center.y };
  if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) {
    return applyMatrixToPoint(matrix, center);
  }
  const scaleX = delta.x === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(delta.x);
  const scaleY = delta.y === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(delta.y);
  const scale = Math.min(scaleX, scaleY);
  const exit = { x: center.x + delta.x * scale, y: center.y + delta.y * scale };
  const down = scaleY <= scaleX && delta.y > 0 && connect.y + connect.height > box.y + box.height + 0.5;
  return applyMatrixToPoint(matrix, down ? { x: exit.x, y: connect.y + connect.height } : exit);
}

export function endpointPoint(
  endpoint: ConnectorEndpoint,
  node: SceneNode,
  matrix: Matrix2d,
  toward: Point2d
): Point2d {
  const portAnchor = node.ports.find((port) => port.id === endpoint.portId)?.anchor
    ?? sideAnchorForDanglingPort(endpoint.portId);
  const anchor = endpoint.anchor ?? portAnchor;
  return anchor
    ? applyMatrixToPoint(matrix, anchorLocalPoint(node, anchor))
    : automaticBoundaryPoint(node, matrix, toward);
}

// A side-named portId resolves even when the node record lacks the port
// (bound live mid-drag, ports commit with the gesture): side anchors are
// positional, so synthesis is exact. Anything else falls back to dynamic.
function sideAnchorForDanglingPort(portId: string | null): SceneAnchor | null {
  return portId === 'top' || portId === 'right' || portId === 'bottom' || portId === 'left'
    ? { kind: 'side', side: portId, ratio: 0.5 }
    : null;
}

export interface OrthogonalEnd {
  readonly point: Point2d;
  readonly side: ConnectSide | null;
  /** How far the end sits off its side's middle by spread or by an authored side anchor: what turns nest by. */
  readonly offset: number;
}

export function pointBounds(point: Point2d): Bounds2d {
  return { x: point.x, y: point.y, width: 0, height: 0 };
}

// Where an orthogonal route meets its end. An authored side anchor pins the
// side; anything else faces whatever comes next on the path (first waypoint,
// or the other end), so a node dragged around its partner re-picks its side
// every frame. Free ends are just their point.
export function orthogonalEnd(
  endpoint: ConnectorEndpoint,
  node: SceneNode | undefined,
  matrix: Matrix2d | undefined,
  toward: Bounds2d,
  spread: SpreadEnd | undefined,
  headers: readonly Bounds2d[]
): OrthogonalEnd | null {
  if (endpoint.point) return { point: endpoint.point, side: null, offset: 0 };
  if (!node || !matrix) return null;
  const bounds = connectWorldBounds(node, matrix);
  const anchor = endAnchor(endpoint, node);
  if (anchor) {
    return {
      point: applyMatrixToPoint(matrix, anchorLocalPoint(node, anchor)),
      side: anchor.kind === 'side' ? anchor.side : facingSide(bounds, toward),
      offset: anchor.kind === 'side'
        ? (anchor.ratio - 0.5) * (anchor.side === 'left' || anchor.side === 'right' ? bounds.height : bounds.width) : 0,
    };
  }
  const side = spread?.side ?? facingSide(bounds, toward);
  // An end alone on its side steps clear of a name in its way; a spread end already has its own place.
  const offset = spread ? spread.offset : clearOfHeaders(bounds, toward, side, headers);
  return { point: outlinePoint(node, matrix, side, offset), side, offset: spread?.offset ?? 0 };
}

// Header text keeps its own room: an automatic end whose straight run in from `toward` would read
// through a name takes the nearest position along its side that does not (8px from the corners).
const END_CORNER_PX = 8;

function clearOfHeaders(bounds: Bounds2d, toward: Bounds2d, side: ConnectSide, headers: readonly Bounds2d[]): number {
  const vertical = side === 'top' || side === 'bottom';
  // The run in from `toward` crosses the gap between the two boxes, on the side's own axis.
  const [from, to] = side === 'top' ? [toward.y + toward.height, bounds.y]
    : side === 'bottom' ? [bounds.y + bounds.height, toward.y]
      : side === 'left' ? [toward.x + toward.width, bounds.x]
        : [bounds.x + bounds.width, toward.x];
  const blocked = headers
    .filter((box) => (vertical ? box.y < to && box.y + box.height > from : box.x < to && box.x + box.width > from))
    .map((box) => (vertical ? [box.x - ROUTE_CLEARANCE, box.x + box.width + ROUTE_CLEARANCE] : [box.y - ROUTE_CLEARANCE, box.y + box.height + ROUTE_CLEARANCE]) as [number, number]);
  if (blocked.length === 0) return 0;
  const [start, length] = vertical ? [bounds.x, bounds.width] : [bounds.y, bounds.height];
  const middle = start + length / 2;
  const span: [number, number] = [start + END_CORNER_PX, start + length - END_CORNER_PX];
  return span[0] < span[1] ? clearAlong(span, middle, blocked) - middle : 0;
}
