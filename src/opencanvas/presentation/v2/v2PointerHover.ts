import type { Point2d } from '../../domain/geometry/types';
import { defaultShapeSize } from '../../domain/nodes/shapeNode';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { enteredGroup, HANDLE_CURSORS, pickHandleNear, SQUARE_SIZE, toolShape, type PointerLike, type V2PointerOptions } from './v2PointerGestures';

/** No gesture in flight: the placement ghost follows a creation tool, hover and the cursor follow the select tool. */
export function hoverIdle(host: PixiRendererHost, opts: V2PointerOptions, event: PointerLike, point: Point2d): void {
    const tool = opts.toolRef.current;
    const shape = toolShape(tool, opts.toolConfigRef.current);
    if (shape && !opts.readOnlyRef.current && event.target instanceof HTMLCanvasElement) {
      // The shape a click will drop, centred on the pointer like the click is.
      const size = tool === 'square' ? { width: SQUARE_SIZE, height: SQUARE_SIZE } : defaultShapeSize(shape);
      const world = host.screenToWorld(point);
      host.setPlacementGhost({ shape, bounds: {
        x: world.x - size.width / 2, y: world.y - size.height / 2, width: size.width, height: size.height,
      } });
      host.setHover(null, null);
      return;
    }
    host.setPlacementGhost(null);
    if (tool === 'select' && event.target instanceof HTMLCanvasElement) {
      const readOnly = opts.readOnlyRef.current;
      const handle = readOnly ? null : host.pickTransformHandle(point);
      // Handles sit outside their node, so a hover over one comes from
      // the neighbourhood search, not from the node under the pointer.
      const handleHit = readOnly ? null : pickHandleNear(host, opts, point);
      const page = opts.pageRef.current;
      const hoverNode = handleHit?.nodeId
        ?? host.pickNode(point, page ? enteredGroup(page, opts.selectionRef.current.nodeIds) : null);
      const hoverSide = handleHit?.side ?? null;
      host.setHover(hoverNode, hoverSide);
      const connectorHandle = host.getSelectedConnectorId() ? host.pickConnectorHandle(point) : null;
      const hoverConnector = hoverNode || handle || connectorHandle ? null : host.pickConnector(point);
      host.setHoveredConnector(hoverConnector);
      const cursor = hoverSide ? 'crosshair'
        : handle ? HANDLE_CURSORS[handle]
          : hoverNode ? (readOnly ? 'pointer' : 'move')
            : connectorHandle ? (connectorHandle.kind === 'endpoint' ? 'crosshair' : 'grab')
              : hoverConnector ? 'pointer' : '';
      event.target.style.cursor = cursor;
    } else {
      host.setHover(null, null);
      host.setHoveredConnector(null);
    }
    return;
}
