import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { Point2d } from '../../domain/geometry/types';
import { panCamera } from '../../domain/camera/camera';
import { addToSelection, clearSelection, replaceSelection } from '../../application/selection/selection';
import { snapToAngle } from '../../domain/geometry/point';
import { beginTransformOperation, boundsBetween, updateTransformOperation, type TransformModifiers } from './pointerOperations';
import { sideAnchor } from '../../domain/connectors/connectHandles';
import { beginConnectorOperation, updateConnectorOperation } from './v2ConnectorOperations';
import { defaultShapeSize } from '../../domain/nodes/shapeNode';
import { buildInsertShapeCommand } from '../../domain/commands/sceneEdits';
import { strokeHitBySegment } from '../../domain/nodes/strokeGeometry';
import { buildNodeWorldMatrices } from '../../domain/scene/worldGeometry';
import {
  CLICK_THRESHOLD_PX, OBJECT_SNAP_PX, HANDLE_CURSORS, modifiersOf, localPoint,
  latestLocalPoint, textOrigin, nodeCenterWorld, pickHandleNear, connectorPreview, stickyAppearance,
  ERASE_RADIUS_PX, pickChartPoint, inkPreview, retargetSample, strokeWorldPoints,
  finishGesture, keyboardGestures, toolShape, dragBox, enteredGroup, SQUARE_SIZE, type V2Operation, type V2PointerOptions, type PointerLike,
} from './v2PointerGestures';
import { useV2Touch } from './useV2Touch';

const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Meta', 'Control']);

export function useV2Pointer(options: V2PointerOptions) {
  const operationRef = useRef<V2Operation | null>(null);
  // One document preview per frame: moves store their latest point, a single
  // rAF computes and previews it. Without this every queued move pays full
  // transform math + a renderer preview and the main thread never catches up.
  const pendingTransformRef = useRef<{
    readonly pointerId: number; readonly world: Point2d; readonly modifiers: TransformModifiers;
  } | null>(null);
  const transformFrameRef = useRef<number | null>(null);
  // Gestures never depend on pointer capture: Chrome drops mouse capture when
  // a trackpad reports the button up a moment before the pointerup arrives
  // (lostpointercapture ~2 ms early, pointerup lands uncaptured, move lost).
  // Capture is only an optimization; window listeners guarantee completion.
  const windowListenersRef = useRef<(() => void) | null>(null);
  // The last move, so a modifier pressed or let go mid-drag re-runs it at once (Figma) instead of on the next move.
  const lastMoveRef = useRef<PointerLike | null>(null);
  const optionsRef = useRef(options);
  const { gestureApiRef } = options;
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const clearPreviews = useCallback(() => {
    const host = optionsRef.current.hostRef.current;
    host?.setMarquee(null);
    host?.setPlacementGhost(null);
    host?.setTransformPreview(null);
    host?.setAlignmentGuides(null);
    host?.setConnectionPreview(null);
    optionsRef.current.onTransformPreview?.(null);
  }, []);

  const detachWindow = useCallback(() => {
    windowListenersRef.current?.();
    windowListenersRef.current = null;
  }, []);

  const cancelTransformFrame = useCallback(() => {
    if (transformFrameRef.current !== null) cancelAnimationFrame(transformFrameRef.current);
    transformFrameRef.current = null;
    pendingTransformRef.current = null;
  }, []);

  // Drops the drag in flight (Escape, window blur, a touch takeover).
  const cancelGesture = useCallback((): boolean => {
    detachWindow();
    cancelTransformFrame();
    if (!operationRef.current) return false;
    operationRef.current = null;
    clearPreviews();
    return true;
  }, [clearPreviews, detachWindow, cancelTransformFrame]);

  useEffect(() => () => {
    detachWindow();
    cancelTransformFrame();
  }, [detachWindow, cancelTransformFrame]);

  useEffect(() => {
    gestureApiRef.current = { cancelGesture, ...keyboardGestures(() => optionsRef.current) };
  }, [gestureApiRef, cancelGesture]);

  const lastPointerTypeRef = useRef<string>('mouse');
  const doubleTapAt = useDoubleTap(optionsRef);
  const { beginTouch, moveTouch, endTouch, resetTouch } = useV2Touch(optionsRef, cancelGesture);

  const applyPendingTransformPreview = useCallback(() => {
    const opts = optionsRef.current;
    const pending = pendingTransformRef.current;
    pendingTransformRef.current = null;
    const operation = operationRef.current;
    const host = opts.hostRef.current;
    if (!pending || !host || !operation || operation.kind !== 'transform'
      || operation.pointerId !== pending.pointerId) return;
    const next = updateTransformOperation(operation, pending.world, Boolean(opts.snapToGrid),
      OBJECT_SNAP_PX / opts.cameraRef.current.zoom, pending.modifiers);
    operationRef.current = next;
    // ⌥ makes a move a copy: the preview leaves the originals drawn where they are.
    host.setTransformPreview(next.result, next.transformKind === 'move' && pending.modifiers.altKey);
    host.setAlignmentGuides(
      next.result?.guideX != null || next.result?.guideY != null
        ? { x: next.result.guideX ?? null, y: next.result.guideY ?? null }
        : null
    );
    opts.onTransformPreview?.(next.result);
  }, []);

  const pointerMove = useCallback(
    (event: PointerLike) => {
      const opts = optionsRef.current;
      const operation = operationRef.current;
      const host = opts.hostRef.current;
      if (!host) return;
      const point = latestLocalPoint(event);
      if (!operation) {
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
      if (operation.pointerId !== event.pointerId) return;
      const sample = event.nativeEvent?.getCoalescedEvents?.()?.at(-1);
      lastMoveRef.current = {
        currentTarget: event.currentTarget, target: event.target, pointerId: event.pointerId,
        clientX: sample?.clientX ?? event.clientX, clientY: sample?.clientY ?? event.clientY,
        shiftKey: event.shiftKey, altKey: event.altKey, metaKey: Boolean(event.metaKey), ctrlKey: Boolean(event.ctrlKey),
        ...(event.pointerType ? { pointerType: event.pointerType } : {}),
      };
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* pointer already released */
        }
      }
      if (operation.kind === 'pan') {
        opts.updateCamera(
          panCamera(opts.cameraRef.current, {
            x: point.x - operation.last.x,
            y: point.y - operation.last.y,
          })
        );
        operationRef.current = { ...operation, last: point };
      } else if (operation.kind === 'transform') {
        const worldPoint = host.screenToWorld(point);
        const distance = Math.hypot(worldPoint.x - operation.start.x, worldPoint.y - operation.start.y)
          * opts.cameraRef.current.zoom;
        if (!operation.result && distance < CLICK_THRESHOLD_PX) return;
        pendingTransformRef.current = {
          pointerId: operation.pointerId, world: worldPoint, modifiers: modifiersOf(event),
        };
        if (transformFrameRef.current === null) {
          transformFrameRef.current = requestAnimationFrame(() => {
            transformFrameRef.current = null;
            applyPendingTransformPreview();
          });
        }
      } else if (operation.kind === 'create') {
        operationRef.current = { ...operation, currentScreen: point };
        const moved = Math.hypot(point.x - operation.startScreen.x, point.y - operation.startScreen.y);
        if (moved >= CLICK_THRESHOLD_PX) {
          // Past the click threshold the ghost is the drag box: what release commits.
          const world = host.screenToWorld(point);
          const { at, size } = dragBox(operation.startWorld, world, operation.square || event.shiftKey, event.altKey);
          host.setPlacementGhost({ shape: operation.shape, bounds: { x: at.x, y: at.y, ...size } });
        }
      } else if (operation.kind === 'ink') {
        const world = host.screenToWorld(point);
        // Coalesced events are the real input rate; a plain mouse move reports
        // one point, a stylus or trackpad reports the whole batch.
        const native = event.nativeEvent?.getCoalescedEvents?.();
        const batch = native && native.length > 0
          ? native.map((sample) => host.screenToWorld(localPoint(retargetSample(event, sample))))
          : [world];
        if (event.shiftKey) {
          // ⇧: a straight line from where the stroke began.
          operation.points.splice(1, operation.points.length, world);
        } else {
          const last = operation.points.at(-1)!;
          for (const sample of batch) {
            if (Math.hypot(sample.x - last.x, sample.y - last.y) > 0.35) operation.points.push(sample);
          }
        }
        host.setFreeformPreview(inkPreview(opts, operation.stroke, operation.points));
      } else if (operation.kind === 'erase') {
        const world = host.screenToWorld(point);
        const radius = ERASE_RADIUS_PX / opts.cameraRef.current.zoom;
        for (const node of operation.page.nodes) {
          if (operation.removed.has(node.id)) continue;
          if (node.kind !== 'pen' && node.kind !== 'highlighter') continue;
          const points = strokeWorldPoints(node, operation.matrices);
          if (points.length < 2) continue;
          if (strokeHitBySegment(points, [operation.from, world], radius)) operation.removed.add(node.id);
        }
        operationRef.current = { ...operation, from: world };
      } else if (operation.kind === 'connect') {
        // ⇧ on a drawn connector: a free end on the nearest 45°, never bound (as ⇧ frees a dragged endpoint).
        const free = event.shiftKey && !operation.sourceSide;
        const raw = host.screenToWorld(point);
        const toWorld = free ? snapToAngle(operation.fromWorld, raw, Math.PI / 4) : raw;
        operationRef.current = { ...operation, toWorld };
        const overNode = free ? null : host.pickNode(point);
        const target = overNode !== operation.sourceNodeId ? overNode : null;
        host.setConnectionPreview(connectorPreview(opts, {
          source: { nodeId: operation.sourceNodeId, point: operation.fromWorld },
          target: { nodeId: target, point: toWorld },
        }));
        host.setDropTarget(target);
      } else if (operation.kind === 'connector-edit') {
        // Shift pins a dragged endpoint to free canvas space instead of binding.
        const overNode = operation.handle.kind === 'endpoint' && !event.shiftKey
          ? host.pickNode(point)
          : null;
        const next = updateConnectorOperation(operation, host.screenToWorld(point), overNode);
        operationRef.current = next;
        host.setConnectorPreview(next.preview);
        host.setDropTarget(overNode);
      } else if (operation.kind === 'marquee') {
        operationRef.current = { ...operation, current: point };
        if (!operation.fromNode) host.setMarquee(boundsBetween(operation.start, point));
      }
    },
    [applyPendingTransformPreview]
  );

  const pointerUp = useCallback(
    (event: PointerLike) => {
      const opts = optionsRef.current;
      const operation = operationRef.current;
      const host = opts.hostRef.current;
      if (!operation || operation.pointerId !== event.pointerId || !host) return;
      operationRef.current = null;
      detachWindow();
      cancelTransformFrame();
      const point = latestLocalPoint(event);
      finishGesture(operation, opts, host, point, event);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    },
    [detachWindow, cancelTransformFrame]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement)) return;
      lastPointerTypeRef.current = event.pointerType;
      if (event.pointerType === 'touch' && !beginTouch(event)) return;
      if (operationRef.current) return;
      const opts = optionsRef.current;
      const host = opts.hostRef.current;
      const page = opts.pageRef.current;
      if ((event.button !== 0 && event.button !== 1) || !host || !page) return;
      event.preventDefault();
      const section = event.currentTarget;
      section.focus({ preventScroll: true });
      try {
        section.setPointerCapture(event.pointerId);
      } catch {
        /* pointer already released */
      }
      detachWindow();
      const retarget = (native: PointerEvent): PointerLike => ({
        currentTarget: section, target: native.target, clientX: native.clientX,
        clientY: native.clientY, pointerId: native.pointerId, altKey: native.altKey,
        shiftKey: native.shiftKey, metaKey: native.metaKey, ctrlKey: native.ctrlKey,
        pointerType: native.pointerType, nativeEvent: native,
      });
      const onWindowMove = (native: PointerEvent) => {
        if (!operationRef.current || section.contains(native.target as Node)) return;
        pointerMove(retarget(native));
      };
      const onWindowUp = (native: PointerEvent) => {
        if (operationRef.current) pointerUp(retarget(native));
      };
      const onWindowKey = (native: KeyboardEvent) => {
        const last = lastMoveRef.current;
        if (!operationRef.current || !last || !MODIFIER_KEYS.has(native.key)) return;
        pointerMove({ ...last, shiftKey: native.shiftKey, altKey: native.altKey, metaKey: native.metaKey, ctrlKey: native.ctrlKey });
      };
      lastMoveRef.current = null;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('keydown', onWindowKey);
      window.addEventListener('keyup', onWindowKey);
      windowListenersRef.current = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('keydown', onWindowKey);
        window.removeEventListener('keyup', onWindowKey);
      };
      const point = localPoint(event);
      const tool = opts.toolRef.current;
      if (tool === 'hand' || opts.spacePanRef.current || event.button === 1) {
        operationRef.current = { kind: 'pan', pointerId: event.pointerId, last: point };
        return;
      }
      // The laser only points: V2LaserTrail draws it, the document never hears of it.
      if (tool === 'laser') return;
      if (opts.readOnlyRef.current) {
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        const fromNode = opts.onNodeDrag && !additive ? host.pickNode(point) : null;
        operationRef.current = {
          kind: 'marquee',
          pointerId: event.pointerId,
          start: point,
          current: point,
          additive,
          ...(fromNode ? { fromNode } : {}),
        };
        return;
      }
      const shape = toolShape(tool, opts.toolConfigRef.current);
      if (shape) {
        const world = host.screenToWorld(point);
        operationRef.current = {
          kind: 'create',
          pointerId: event.pointerId,
          shape,
          square: tool === 'square',
          page,
          startWorld: world,
          startScreen: point,
          currentScreen: point,
        };
        return;
      }
      if (tool === 'pen' || tool === 'highlighter') {
        const world = host.screenToWorld(point);
        operationRef.current = {
          kind: 'ink', pointerId: event.pointerId, page, stroke: tool, points: [world],
        };
        host.setFreeformPreview(inkPreview(opts, tool, [world]));
        return;
      }
      if (tool === 'eraser') {
        operationRef.current = {
          kind: 'erase', pointerId: event.pointerId, page,
          matrices: buildNodeWorldMatrices(page),
          from: host.screenToWorld(point), removed: new Set(),
        };
        return;
      }
      if (tool === 'connector') {
        // Starts anywhere: over a shape binds that end, empty canvas leaves
        // it free (ADR-001), like Excalidraw and tldraw arrows.
        const nodeId = host.pickNode(point);
        const world = host.screenToWorld(point);
        operationRef.current = {
          kind: 'connect',
          pointerId: event.pointerId,
          page,
          sourceNodeId: nodeId,
          sourceSide: null,
          fromWorld: (nodeId && nodeCenterWorld(page, nodeId)) || world,
          startScreen: point,
          toWorld: world,
        };
        return;
      }
      host.setHover(null, null);
      host.setHoveredConnector(null);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const selectedConnectorId = host.getSelectedConnectorId();
      const selectedConnector = selectedConnectorId
        ? page.connectors.find(({ id }) => id === selectedConnectorId) ?? null
        : null;
      const connectorHandle = selectedConnector ? host.pickConnectorHandle(point) : null;
      if (selectedConnector && connectorHandle && !additive) {
        host.setConnectorSelection([selectedConnector.id], connectorHandle);
        operationRef.current = beginConnectorOperation(
          event.pointerId, page, selectedConnector, connectorHandle
        );
        return;
      }
      const states = buildNodeStateMap(page);
      const canTransform = opts.selectionRef.current.nodeIds.every((id) => !states.get(id)?.locked);
      const handle = canTransform ? host.pickTransformHandle(point) : null;
      // A handle is never a selection gesture: ⇧/⌥ held at the grab are the resize's modifiers.
      if (handle && opts.selectionRef.current.nodeIds.length > 0) {
        operationRef.current = beginTransformOperation(event.pointerId, page,
          opts.selectionRef.current.nodeIds, handle, host.screenToWorld(point));
        return;
      }
      // A side handle starts a quick-create drag from that side, whether or
      // not its node is selected; the preview runs from the side anchor.
      // Handles sit outside the node bounds, so search neighbours by
      // proximity (this also covers touch, which never hovers first).
      if (!additive) {
        const hit = pickHandleNear(host, opts, point, states);
        if (hit) {
          if (!opts.selectionRef.current.nodeIds.includes(hit.nodeId)) {
            opts.applyConnectorSelection([]);
            opts.applySelection(replaceSelection([hit.nodeId]));
          }
          operationRef.current = { kind: 'connect', pointerId: event.pointerId, page,
            sourceNodeId: hit.nodeId, sourceSide: hit.side,
            fromWorld: sideAnchor(hit.bounds, hit.side),
            startScreen: point, toWorld: host.screenToWorld(point) };
          return;
        }
      }
      const chartPoint = opts.readOnlyRef.current ? null
        : pickChartPoint(host, page, point, opts.cameraRef.current.zoom);
      if (chartPoint && !additive) {
        opts.applyConnectorSelection([]);
        opts.applySelection(replaceSelection([chartPoint.node.id]));
        operationRef.current = {
          kind: 'chart-point', pointerId: event.pointerId, page,
          node: chartPoint.node, index: chartPoint.index,
        };
        return;
      }
      const nodeId = host.pickNode(point, enteredGroup(page, opts.selectionRef.current.nodeIds));
      // ⇧/⌘ on a shape (Figma): it joins the selection at once and a drag moves them all; a click
      // without a drag on one already selected takes it back out.
      if (nodeId && additive) {
        const current = opts.selectionRef.current;
        const wasSelected = current.nodeIds.includes(nodeId);
        if (![...current.nodeIds, nodeId].some((id) => states.get(id)?.locked)) {
          opts.applyConnectorSelection([]);
          if (!wasSelected) opts.applySelection(addToSelection(current, [nodeId]));
          operationRef.current = {
            ...beginTransformOperation(event.pointerId, page, opts.selectionRef.current.nodeIds, null, host.screenToWorld(point)),
            ...(wasSelected ? { clickSelects: current.nodeIds.filter((id) => id !== nodeId) } : {}),
          };
          return;
        }
      }
      if (nodeId && !additive) {
        if (!opts.selectionRef.current.nodeIds.includes(nodeId)) {
          opts.applyConnectorSelection([]);
          opts.applySelection(replaceSelection([nodeId]));
        }
        if (opts.selectionRef.current.nodeIds.some((id) => states.get(id)?.locked)) return;
        const many = opts.selectionRef.current.nodeIds.length > 1;
        operationRef.current = {
          ...beginTransformOperation(event.pointerId, page, opts.selectionRef.current.nodeIds, null, host.screenToWorld(point)),
          ...(many ? { clickSelects: [nodeId] } : {}),
        };
        return;
      }
      const connectorId = host.pickConnector(point);
      if (connectorId && !nodeId) {
        const connectors = opts.selectedConnectorIdsRef.current;
        if (additive) {
          // ⇧/⌘ toggles a line in or out, the shapes kept.
          opts.applyConnectorSelection(connectors.includes(connectorId)
            ? connectors.filter((id) => id !== connectorId) : [...connectors, connectorId]);
        } else {
          opts.applySelection(clearSelection());
          opts.applyConnectorSelection([connectorId]);
        }
        operationRef.current = null;
        detachWindow();
        try {
          section.releasePointerCapture(event.pointerId);
        } catch {
          /* already released */
        }
        return;
      }
      operationRef.current = {
        kind: 'marquee',
        pointerId: event.pointerId,
        start: point,
        current: point,
        additive,
      };
    },
    [beginTouch, detachWindow, pointerMove, pointerUp]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (moveTouch(event)) return;
      pointerMove(event);
    },
    [moveTouch, pointerMove]
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const tap = endTouch(event);
      pointerUp(event);
      if (tap) doubleTapAt(tap.at);
    },
    [endTouch, pointerUp, doubleTapAt]
  );

  const handlePointerCancel = useCallback(() => {
    resetTouch();
    cancelGesture();
  }, [resetTouch, cancelGesture]);
  // Leaving the canvas for the rail takes the placement ghost with it.
  const handlePointerLeave = useCallback(() => {
    if (!operationRef.current) optionsRef.current.hostRef.current?.setPlacementGhost(null);
    optionsRef.current.hostRef.current?.setHoveredConnector(null);
  }, []);

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement)) return;
      // Touch double-taps are synthesised on release; the dblclick some
      // browsers fire afterwards would open the editor (or add text) twice.
      if (lastPointerTypeRef.current === 'touch') return;
      const bounds = event.currentTarget.getBoundingClientRect();
      doubleTapAt({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    },
    [doubleTapAt]
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleDoubleClick,
    cancelGesture,
  };
}

function useDoubleTap(optionsRef: RefObject<V2PointerOptions>) {
  return useCallback(
    (point: Point2d) => {
      const opts = optionsRef.current;
      const host = opts.hostRef.current;
      if (!host) return;
      if (opts.readOnlyRef.current) {
        const nodeId = opts.onNodeDoubleClick ? host.pickNode(point) : null;
        if (nodeId) opts.onNodeDoubleClick!(nodeId);
        return;
      }
      if (opts.toolRef.current !== 'select') return;
      const page = opts.pageRef.current;
      const nodeId = host.pickNode(point, page ? enteredGroup(page, opts.selectionRef.current.nodeIds) : null);
      // A group draws nothing to edit: a double-click enters it, selecting the member under the pointer (Figma).
      if (nodeId && page?.nodes.find(({ id }) => id === nodeId)?.kind === 'group') {
        const member = host.pickNode(point, nodeId);
        if (member && member !== nodeId) {
          opts.applyConnectorSelection([]);
          opts.applySelection(replaceSelection([member]));
        }
        return;
      }
      if (nodeId) {
        // Charts are data: their double-click edits the numbers, not a label.
        if (opts.onOpenChartData?.(nodeId)) return;
        opts.openEditor(nodeId);
        return;
      }
      const connectorId = host.pickConnector(point);
      if (connectorId) {
        opts.openConnectorEditor(connectorId, point);
        return;
      }
      if (!page) return;
      const id = opts.mintId('node');
      opts.commit(buildInsertShapeCommand(page, {
        kind: 'text', id, label: '', at: textOrigin(host.screenToWorld(point)), appearance: stickyAppearance(opts, 'text'),
      }));
      opts.applyConnectorSelection([]);
      opts.applySelection(replaceSelection([id]));
      opts.openEditor(id, { isNew: true });
    },
    [optionsRef]
  );
}