import { worldToScreen } from '../../domain/camera/camera';
import { createBounds2d, unionBounds } from '../../domain/geometry/bounds';
import type { Bounds2d, Point2d } from '../../domain/geometry/types';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import { frameNameAt, nodeLabelBounds } from '../../domain/nodes/nodeLabelBounds';
import {
  connectorEditHandles, MIN_SEGMENT_HANDLE_PX,
  pickConnectorAtPoint,
  pickConnectorEditHandle as pickEditHandle,
  type ConnectorEditHandle,
} from '../../domain/connectors/editing';
import { querySceneBounds } from '../../domain/scene/queries';
import { nodeWorldBounds } from '../../domain/scene/worldGeometry';
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import type { TransformHandle } from '../../domain/transforms/types';
import { pickTransformHandle as pickHandle } from './PixiTransformOverlay';
import type { PixiRendererHost } from './PixiRendererHost';
import { getSelectedConnector } from './pixiHostScene';

/** `scope`: a group the selection is inside; a hit within it resolves to its member, not to the group. */
export function pickNode(h: PixiRendererHost, screenPoint: Point2d, scope: string | null): string | null {
  if (!h.index) return null;
  const point = h.screenToWorld(screenPoint);
  // Containers are pickable too, but ordering puts them under their
  // children so a click inside a section still finds the child first.
  const hits = querySceneBounds(h.index, createBounds2d(point.x, point.y, 0, 0), {
    kinds: new Set(['node', 'container']),
  });
  // Locked nodes stay selectable (their menu is how they get unlocked);
  // the pointer flow refuses to move them.
  const hit = [...hits].reverse().find((hit) => hit.visible) ?? null;
  // A frame's name sits above its box: over it, the frame is what's under the pointer (a line drawn across it still wins).
  const named = hit?.kind === 'node' ? null : frameNameAt(h.index, point);
  if (named && !pickConnector(h, screenPoint)) return outermostGroup(h, named, scope);
  if (!hit) return null;
  // A connector drawn across a container is painted on top of it, so a click
  // on the line belongs to the line. Without this, nothing inside a section
  // or frame — every imported diagram — could ever select its own arrows.
  if (hit.kind === 'container' && pickConnector(h, screenPoint)) return null;
  return outermostGroup(h, hit.id, scope);
}

// ⌘G groups select as one: a click on a member picks the top-most group,
// or the top-most below `scope` once the selection is inside one (double-click enters).
function outermostGroup(h: PixiRendererHost, nodeId: string, scope: string | null): string {
  let result = nodeId;
  let parentId = h.index?.nodesById.get(nodeId)?.parentId ?? null;
  while (parentId) {
    const parent = h.index?.nodesById.get(parentId);
    if (!parent || parent.kind !== 'group' || parent.id === scope) break;
    result = parent.id;
    parentId = parent.parentId;
  }
  return result;
}

export function pickConnector(h: PixiRendererHost, screenPoint: Point2d): string | null {
  if (!h.page || !h.connectorModelEnabled) return null;
  const states = buildNodeStateMap(h.page);
  const editable = (nodeId: string | null): boolean => {
    if (nodeId === null) return true;
    const state = states.get(nodeId);
    return state?.visible === true && state.locked === false;
  };
  const editablePage = {
    ...h.page,
    connectors: h.page.connectors.filter(
      (connector) => editable(connector.source.nodeId) && editable(connector.target.nodeId)
    ),
  };
  return pickConnectorAtPoint(editablePage, h.screenToWorld(screenPoint), 10 / h.camera.zoom);
}

export function pickConnectorHandle(h: PixiRendererHost, screenPoint: Point2d): ConnectorEditHandle | null {
  const connector = getSelectedConnector(h);
  if (!h.page || !connector || !h.editable) return null;
  return pickEditHandle(
    connectorEditHandles(h.page, connector, MIN_SEGMENT_HANDLE_PX / h.camera.zoom),
    h.screenToWorld(screenPoint),
    9 / h.camera.zoom
  );
}

export function pickTransformHandle(h: PixiRendererHost, screenPoint: Point2d): TransformHandle | null {
  const bounds = h.editable ? h.getSelectionWorldBounds() : null;
  return bounds ? pickHandle(bounds, screenPoint, h.camera) : null;
}

export function pickInScreenBounds(h: PixiRendererHost, screenBounds: Bounds2d, kind: 'node' | 'connector'): readonly string[] {
  if (!h.index) return [];
  const topLeft = h.screenToWorld(screenBounds);
  const bottomRight = h.screenToWorld({
    x: screenBounds.x + screenBounds.width,
    y: screenBounds.y + screenBounds.height,
  });
  const worldBounds = createBounds2d(
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.y, bottomRight.y),
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y)
  );
  return querySceneBounds(h.index, worldBounds, { kinds: new Set([kind]) }).map((object) => object.id);
}

/** World bounds of all nodes, or of `nodeIds` only (zoom to selection). */
export function getContentBounds(h: PixiRendererHost, nodeIds?: readonly string[]): Bounds2d | null {
  if (!h.index) return null;
  const only = nodeIds ? new Set(nodeIds) : null;
  const nodeBounds = [...h.index.objectsByKey.values()]
    .filter((object) => (object.kind === 'node' || object.kind === 'container') && (!only || only.has(object.id)))
    .map((object) => object.bounds);
  return nodeBounds.reduce<Bounds2d | null>(
    (combined, bounds) => (combined ? unionBounds(combined, bounds) : bounds),
    null
  );
}

export function getNodeScreenBounds(h: PixiRendererHost, nodeId: string): DOMRect | null {
  if (!h.page || !h.index) return null;
  const node = h.index.nodesById.get(nodeId);
  const matrix = h.index.worldMatricesByNodeId.get(nodeId);
  if (!node || !matrix) return null;
  return screenRect(h, nodeWorldBounds(node, matrix));
}

/** Where the label editor opens: the title band of a frame, under the plate of an icon node. */
export function getNodeLabelScreenBounds(h: PixiRendererHost, nodeId: string): DOMRect | null {
  if (!h.page || !h.index) return null;
  const node = h.index.nodesById.get(nodeId);
  const matrix = h.index.worldMatricesByNodeId.get(nodeId);
  if (!node || !matrix) return null;
  const local = nodeLabelBounds(node);
  const origin = applyMatrixToPoint(matrix, { x: local.x, y: local.y });
  return screenRect(h, createBounds2d(origin.x, origin.y, local.width * matrix.a, local.height * matrix.d));
}

function screenRect(h: PixiRendererHost, bounds: Bounds2d): DOMRect {
  const topLeft = worldToScreen(h.camera, bounds);
  return new DOMRect(topLeft.x, topLeft.y, bounds.width * h.camera.zoom, bounds.height * h.camera.zoom);
}
