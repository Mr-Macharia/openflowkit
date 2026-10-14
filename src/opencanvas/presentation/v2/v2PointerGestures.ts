// The pointer gestures v2 knows, as data and pure steps: what each operation
// carries, the geometry it needs, and the command its release commits.
// useV2Pointer owns the event wiring and the state machine around them.
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { quadrantContent, quadrantPointPosition } from '../../domain/nodes/chartNodePresentation';
import type { SceneConnector, SceneNode, ScenePage } from '../../domain/document/types';
import type { TransformHandle } from '../../domain/transforms/types';
import type { Bounds2d, Matrix2d, Point2d } from '../../domain/geometry/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { boundsBetween } from './pointerOperations';
import { pickConnectHandle, type ConnectSide } from '../../domain/connectors/connectHandles';
import { defaultShapeSize } from '../../domain/nodes/shapeNode';
import type { V2ShapeKind } from '../../domain/commands/sceneEdits';
import type { V2Tool } from './V2CreationToolbar';
import { buildNodeWorldMatrices } from '../../domain/scene/worldGeometry';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { FreeformPreviewFrame } from '../../infrastructure/pixi/PixiFreeformPreview';
import type { V2ToolConfig } from './v2ToolCatalog';
import { connectNodes, connectorRoute, inkDefaults, placeShape } from './v2PointerCommands';
import { SQUARE_SIZE, type V2GestureApi, type V2PointerOptions } from './v2PointerCore';

export * from './v2PointerCore';
export { finishGesture } from './v2PointerFinish';
export { stickyAppearance } from './v2PointerCommands';

// Handles sit 22 px outside the node edge; search a box around the press.
const HANDLE_SEARCH_RADIUS_PX = 40;

/** The shape a tool draws, or null when it draws none. Square is a rectangle; only its box differs. */
export function toolShape(tool: V2Tool, config: V2ToolConfig): V2ShapeKind | null {
  return tool === 'shape' ? config.shape : tool === 'square' ? 'rectangle'
    : tool === 'rectangle' || tool === 'ellipse' || tool === 'text' ? tool : null;
}

export const HANDLE_CURSORS: Record<TransformHandle, string> = {
  north: 'ns-resize', south: 'ns-resize', east: 'ew-resize', west: 'ew-resize',
  'north-east': 'nesw-resize', 'south-west': 'nesw-resize',
  'north-west': 'nwse-resize', 'south-east': 'nwse-resize', rotate: 'grab',
};

export function textOrigin(center: Point2d): Point2d {
  const size = defaultShapeSize('text');
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
}

export function nodeCenterWorld(page: ScenePage, nodeId: string): Point2d | null {
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  return {
    x: node.transform.translation.x + node.size.width / 2,
    y: node.transform.translation.y + node.size.height / 2,
  };
}

// A side handle under the pointer, found by searching the neighbourhood:
// handles sit outside node bounds (and touch never hovers first).
export function pickHandleNear(
  host: PixiRendererHost,
  opts: V2PointerOptions,
  point: Point2d,
  states?: ReturnType<typeof buildNodeStateMap>
): { readonly nodeId: string; readonly side: ConnectSide; readonly bounds: Bounds2d } | null {
  const nearby = host.pickNodesInScreenBounds(boundsBetween(
    { x: point.x - HANDLE_SEARCH_RADIUS_PX, y: point.y - HANDLE_SEARCH_RADIUS_PX },
    { x: point.x + HANDLE_SEARCH_RADIUS_PX, y: point.y + HANDLE_SEARCH_RADIUS_PX }
  ));
  const locked = states ?? (opts.pageRef.current ? buildNodeStateMap(opts.pageRef.current) : null);
  for (const nodeId of nearby) {
    if (locked?.get(nodeId)?.locked) continue;
    const bounds = host.getNodesWorldBounds([nodeId]);
    const side = bounds ? pickConnectHandle(bounds, point, opts.cameraRef.current) : null;
    if (bounds && side) return { nodeId, side, bounds };
  }
  return null;
}

// The dragged-out connector as it will commit: routed live,
// so the user sees the real lane and the side it will bind to before letting go.
export function connectorPreview(options: V2PointerOptions, ends: {
  readonly source: { readonly nodeId: string | null; readonly point: Point2d };
  readonly target: { readonly nodeId: string | null; readonly point: Point2d };
}): SceneConnector {
  return {
    id: '__connect-preview',
    source: ends.source.nodeId
      ? { nodeId: ends.source.nodeId, portId: null, anchor: null, point: null }
      : { nodeId: null, portId: null, anchor: null, point: ends.source.point },
    target: ends.target.nodeId
      ? { nodeId: ends.target.nodeId, portId: null, anchor: null, point: null }
      : { nodeId: null, portId: null, anchor: null, point: ends.target.point },
    route: { kind: connectorRoute(options), ownership: 'automatic' },
    waypoints: [],
    labels: [], appearance: { markerEnd: 'arrow' },
    semantics: {}, metadata: {}, extensions: {},
  };
}

/** V2GestureApi's keyboard doors to the two gestures above. */
export function keyboardGestures(opts: () => V2PointerOptions): Pick<V2GestureApi, 'placeShape' | 'connectSelection'> {
  const writablePage = () => (opts().readOnlyRef.current ? null : opts().pageRef.current);
  return {
    placeShape: (at, shape, squareArg) => {
      const page = writablePage();
      const tool = opts().toolRef.current;
      const placed = shape ?? toolShape(tool, opts().toolConfigRef.current);
      const square = squareArg ?? tool === 'square';
      if (!page || !placed) return false;
      // Enter, Enter: each shape steps down-right off the last, never stacked out of sight on it.
      const size = square ? { width: SQUARE_SIZE, height: SQUARE_SIZE } : defaultShapeSize(placed);
      let centre = at;
      const taken = (point: Point2d) => page.nodes.some(({ transform: { translation } }) =>
        translation.x === point.x - size.width / 2 && translation.y === point.y - size.height / 2);
      while (taken(centre)) centre = { x: centre.x + 24, y: centre.y + 24 };
      placeShape(opts(), page, placed, centre, undefined, square);
      return true;
    },
    connectSelection: () => {
      const page = writablePage();
      const ids = opts().selectionRef.current.nodeIds;
      if (!page || ids.length !== 2) return false;
      connectNodes(opts(), page, ids[0]!, ids[1]!);
      return true;
    },
  };
}

// Eraser reach: half the widest stroke it can hit, in world units.
export const ERASE_RADIUS_PX = 10;
// How close a press must land to grab a quadrant point, in screen pixels.
const CHART_POINT_REACH_PX = 14;

/** A quadrant point within reach of the cursor, in a chart under it. */
export function pickChartPoint(
  host: PixiRendererHost, page: ScenePage, point: Point2d, zoom: number
): { readonly node: SceneNode; readonly index: number } | null {
  const world = host.screenToWorld(point);
  const reach = CHART_POINT_REACH_PX / zoom;
  for (const node of page.nodes) {
    const quadrant = quadrantContent(node);
    if (!quadrant) continue;
    const matrix = buildNodeWorldMatrices(page).get(node.id);
    if (!matrix) continue;
    const plot = { x: 48, y: 8, width: node.size.width - 86, height: node.size.height - 30 };
    for (const [index, entry] of quadrant.points.entries()) {
      const local = quadrantPointPosition(quadrant, entry, plot);
      const at = applyMatrixToPoint(matrix, local);
      if (Math.hypot(at.x - world.x, at.y - world.y) <= reach) return { node, index };
    }
  }
  return null;
}

/** The live stroke as the renderer needs it: world points, ink colours. */
export function inkPreview(
  options: V2PointerOptions, stroke: 'pen' | 'highlighter', points: readonly Point2d[]
): FreeformPreviewFrame {
  const preset = inkDefaults(options, stroke);
  return {
    confirmed: [...points],
    predicted: [],
    color: Number.parseInt(String(preset.strokeColor).slice(1), 16),
    width: Number(preset.strokeWidth),
    alpha: Number(preset.transparency),
  };
}

export function strokeWorldPoints(
  node: ScenePage['nodes'][number], matrices: ReadonlyMap<string, Matrix2d>
): Point2d[] {
  const matrix = matrices.get(node.id);
  const raw = node.content.points;
  if (!matrix || !Array.isArray(raw)) return [];
  return raw.flatMap((point) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
    const { x, y } = point as { x?: unknown; y?: unknown };
    return typeof x === 'number' && typeof y === 'number'
      ? [applyMatrixToPoint(matrix, { x, y })] : [];
  });
}
