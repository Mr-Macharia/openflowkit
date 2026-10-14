import type { DocumentCommand } from '../../domain/commands/types';
import type { ConnectorRouteKind, ScenePage } from '../../domain/document/types';
import type { JsonObject } from '../../domain/document/json';
import { replaceSelection, clearSelection } from '../../application/selection/selection';
import type { SceneNode } from '../../domain/document/types';
import type { Point2d } from '../../domain/geometry/types';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { ConnectSide } from '../../domain/connectors/connectHandles';
import { defaultShapeSize } from '../../domain/nodes/shapeNode';
import { buildInsertConnectorCommand, buildInsertShapeCommand, buildQuickCreateCommand, buildDeleteSelectionCommand, buildDuplicateSelectionCommand, type V2ShapeKind } from '../../domain/commands/sceneEdits';
import { simplifyStroke, strokeBounds } from '../../domain/nodes/strokeGeometry';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../../domain/scene/worldGeometry';
import { clearance, panToUncover } from './map/mapMode';
import { CONNECTOR_ROUTE } from './v2ToolCatalog';
import { SQUARE_SIZE, type V2ConnectOperation, type V2EraseOperation, type V2InkOperation, type V2PointerOptions } from './v2PointerCore';

/** A shape tool's click (default size centred on `centre`) or drag (`box`): one step, selected, tool back to select. */
export function placeShape(
  opts: V2PointerOptions, page: ScenePage, shape: V2ShapeKind, centre: Point2d,
  box?: { readonly at: Point2d; readonly size: { readonly width: number; readonly height: number } },
  square = false,
): void {
  const id = opts.mintId('node');
  const size = box?.size ?? (square ? { width: SQUARE_SIZE, height: SQUARE_SIZE } : defaultShapeSize(shape));
  opts.commit(buildInsertShapeCommand(page, {
    kind: shape, id, size, appearance: stickyAppearance(opts, shape),
    at: box?.at ?? { x: centre.x - size.width / 2, y: centre.y - size.height / 2 },
  }));
  opts.applyConnectorSelection([]);
  opts.applySelection(replaceSelection([id]));
  opts.onToolChange('select');
  if (shape === 'text') opts.openEditor(id, { isNew: true });
}

/** A connector between two nodes, as drawn: one step (a C4 view adds its relation), the connector selected. */
export function connectNodes(opts: V2PointerOptions, page: ScenePage, sourceNodeId: string, targetNodeId: string): void {
  const id = opts.mintId('connector');
  const command = buildInsertConnectorCommand(page, {
    id, source: { nodeId: sourceNodeId }, target: { nodeId: targetNodeId },
    route: connectorRoute(opts), appearance: connectorAppearance(opts),
  });
  opts.commit(opts.extendConnectorCommand?.(command, sourceNodeId, targetNodeId) ?? command);
  opts.applySelection(clearSelection());
  opts.applyConnectorSelection([id]);
  opts.onToolChange('select');
}

export function stickyAppearance(options: V2PointerOptions, shape: V2ShapeKind): JsonObject | undefined {
  return options.stylePresetsRef?.current[shape === 'text' ? 'text' : 'shape'];
}

// The picked connector tool decides the route; sticky style carries the rest,
// and every new connector points at its target.
export function connectorAppearance(options: V2PointerOptions): JsonObject {
  return { ...options.stylePresetsRef?.current.connector, markerEnd: 'arrow' };
}

export function connectorRoute(options: V2PointerOptions): ConnectorRouteKind {
  return CONNECTOR_ROUTE[options.toolConfigRef.current.connector];
}

// Ink defaults, overridden by the style bar's last ink pick. Numbers stay in
// the catalogue's range so a stroke and a catalog star look like siblings.
export function inkDefaults(options: V2PointerOptions, stroke: 'pen' | 'highlighter'): JsonObject {
  const preset = options.stylePresetsRef?.current.ink;
  return stroke === 'highlighter'
    ? { strokeColor: '#fde047', strokeWidth: 16, transparency: 0.45, ...preset }
    : { strokeColor: '#334155', strokeWidth: 3, transparency: 1, ...preset };
}

/** One insert-node per stroke: the points are local to the node's own box. */
export function buildInkCommand(options: V2PointerOptions, operation: V2InkOperation): DocumentCommand | null {
  const tolerance = 0.75 / options.cameraRef.current.zoom;
  const simplified = simplifyStroke(operation.points, tolerance);
  if (simplified.length < 2) return null;
  const bounds = strokeBounds(simplified);
  const id = options.mintId('node');
  const local = simplified.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
  return {
    kind: 'insert-node',
    id: `create-node:${id}`,
    label: operation.stroke === 'pen' ? 'Draw' : 'Highlight',
    pageId: operation.page.id,
    index: operation.page.nodes.length,
    node: {
      id,
      kind: operation.stroke,
      parentId: null,
      layerId: operation.page.layers[0]?.id ?? 'default',
      zIndex: operation.page.nodes.reduce((max, node) => Math.max(max, node.zIndex), -1) + 1,
      transform: {
        translation: { x: bounds.x, y: bounds.y },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
      },
      size: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
      content: { ...inkDefaults(options, operation.stroke), points: local },
      appearance: {},
      ports: [],
      metadata: {},
      extensions: {},
    },
  };
}

/** Every stroke the eraser has crossed so far, as one undo step. */
export function buildEraseCommand(operation: V2EraseOperation): DocumentCommand | null {
  if (operation.removed.size === 0) return null;
  return buildDeleteSelectionCommand(operation.page, [...operation.removed], []);
}

/** A quadrant point's new 0–1 coordinates from a world position. */
export function quadrantValueAt(node: SceneNode, world: Point2d): { x: number; y: number } {
  const inverse = { a: 1, b: 0, c: 0, d: 1, tx: -node.transform.translation.x, ty: -node.transform.translation.y };
  const local = applyMatrixToPoint(inverse, world);
  const plot = { x: 48, y: 8, width: node.size.width - 86, height: node.size.height - 30 };
  return {
    x: Math.min(1, Math.max(0, (local.x - plot.x) / Math.max(1, plot.width))),
    y: Math.min(1, Math.max(0, 1 - (local.y - plot.y) / Math.max(1, plot.height))),
  };
}

// Handle flow released on empty canvas (or clicked without dragging): the new
// same-kind node at the fixed gap, side-bound, selected, label editing open.
export function commitQuickCreateDelivery(
  options: V2PointerOptions,
  host: PixiRendererHost,
  operation: V2ConnectOperation,
  sourceNodeId: string,
  sourceSide: ConnectSide,
  dropAt?: Point2d
): void {
  const nodeId = options.mintId('node');
  const connectorId = options.mintId('connector');
  const command = buildQuickCreateCommand(operation.page, {
    sourceNodeId, sourceSide, newNodeId: nodeId, connectorId, ...(dropAt ? { dropAt } : {}),
  });
  options.commit(command);
  // A box made under the rail or off-screen is panned clear, the least it takes, zoom kept: the next click finds it.
  const insert = command.commands[0];
  if (insert?.kind === 'insert-node') {
    const placed = { ...operation.page, nodes: [...operation.page.nodes, insert.node] };
    const pan = panToUncover(nodeWorldBounds(insert.node, buildNodeWorldMatrices(placed).get(nodeId)!), options.cameraRef.current, clearance(host));
    if (pan) options.updateCamera(pan);
  }
  options.applyConnectorSelection([]);
  options.applySelection(replaceSelection([nodeId]));
  options.onToolChange('select');
  options.openEditor(nodeId, { isNew: true });
}

/** ⌥-drag: the originals stay, a copy lands `delta` away, as one step; the copies (their roots) end up selected. */
export function altDragCopy(opts: V2PointerOptions, page: ScenePage, nodeIds: readonly string[], delta: Point2d): void {
  // ponytail: the copy keeps its original's parent, like ⌘D; a drop into another section is a second move.
  const command = buildDuplicateSelectionCommand(page, nodeIds, opts.selectedConnectorIdsRef.current, opts.mintId, delta);
  opts.commit(command);
  const inserted = command.commands.flatMap((child) => (child.kind === 'insert-node' ? [child.node] : []));
  const copies = new Set(inserted.map(({ id }) => id));
  opts.applySelection(replaceSelection(inserted.filter((node) => !copies.has(node.parentId ?? '')).map(({ id }) => id)));
  opts.applyConnectorSelection(command.commands.flatMap((child) => (child.kind === 'insert-connector' ? [child.connector.id] : [])));
}
