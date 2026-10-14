import type { MouseEvent } from 'react';
import { clearSelection, replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { ContextMenuTarget } from './V2ContextMenu';

interface CanvasContextMenuState {
  readonly editing: unknown;
  readonly connectorEditing: unknown;
  readonly selection: CanvasSelection;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  /** Right-click: the host has already selected the target; the page shows the menu. */
  readonly onContextMenu: (target: ContextMenuTarget) => void;
}

/** Right-click on the canvas: selects what is under the pointer (a shape, or a connector) and asks the page for its menu. */
export function openCanvasContextMenu(event: MouseEvent<HTMLElement>, host: PixiRendererHost | null, props: CanvasContextMenuState): void {
  if (!host || props.editing || props.connectorEditing) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const at = { x: event.clientX, y: event.clientY };
  const nodeId = host.pickNode(point);
  if (nodeId) {
    if (!props.selection.nodeIds.includes(nodeId)) {
      props.applyConnectorSelection([]);
      props.applySelection(replaceSelection([nodeId]));
    }
    props.onContextMenu({ kind: 'nodes', ...at });
    return;
  }
  const connectorId = host.pickConnector(point);
  if (connectorId) {
    props.applySelection(clearSelection());
    props.applyConnectorSelection([connectorId]);
    props.onContextMenu({ kind: 'connector', id: connectorId, ...at });
    return;
  }
  props.onContextMenu({ kind: 'canvas', ...at });
}
