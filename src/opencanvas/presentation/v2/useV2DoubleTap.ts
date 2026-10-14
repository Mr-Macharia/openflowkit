import { useCallback, type RefObject } from 'react';
import type { Point2d } from '../../domain/geometry/types';
import { replaceSelection } from '../../application/selection/selection';
import { buildInsertShapeCommand } from '../../domain/commands/sceneEdits';
import { enteredGroup, stickyAppearance, textOrigin, type V2PointerOptions } from './v2PointerGestures';

/** A double-click or double-tap at `point`: enter a group, edit a label or a chart's data, or add text on empty canvas. */
export function useV2DoubleTap(optionsRef: RefObject<V2PointerOptions>) {
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
