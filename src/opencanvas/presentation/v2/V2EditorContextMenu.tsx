import type { RefObject } from 'react';
import type { CanvasSelection } from '../../application/selection/selection';
import { hasIcon } from '../../application/dsl/iconCommands';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneNode, ScenePage } from '../../domain/document/types';
import { V2ContextMenu, type ContextMenuTarget } from './V2ContextMenu';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Camera } from './useV2Camera';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2EditActions } from './useV2EditActions';
import { diagramIconsOn, iconToggleFrame, type useV2IconActions } from './useV2IconActions';
import type { useV2Selection } from './useV2Selection';

interface EditorContextMenuProps {
  readonly target: ContextMenuTarget | null;
  readonly page: ScenePage;
  readonly viewPage: ScenePage;
  readonly selection: CanvasSelection;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectionApi: ReturnType<typeof useV2Selection>;
  readonly selectedNode: SceneNode | undefined;
  readonly selectedElementId: string | null;
  readonly editLocked: boolean;
  readonly docReadOnly: boolean;
  readonly editActions: ReturnType<typeof useV2EditActions>;
  readonly iconActions: ReturnType<typeof useV2IconActions>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly architectureActions: ReturnType<typeof useV2ArchitectureActions>;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly commit: (command: DocumentCommand) => void;
  readonly openEditor: (nodeId: string) => void;
  readonly editSelectedConnectorLabel: () => void;
  readonly openWorkspace: (mode: 'inspect') => void;
  /** Drops the menu; `close` also hands focus back to the canvas. */
  readonly dismiss: () => void;
  readonly close: () => void;
  readonly mapActive: boolean;
  readonly zoomInto: unknown;
  readonly inMap: { onShowOnCanvas?: () => void; onCopyToCanvas?: () => void } | null;
  readonly editInModel: (elementId: string) => void;
  readonly openElementExport: () => void;
  readonly fitAll: () => void;
  readonly showGrid: boolean;
  readonly snapToGrid: boolean;
  readonly onToggleGrid: () => void;
  readonly onToggleSnap: () => void;
}

/** The right-click menu with what this selection offers it (icons, model actions, Map's few). */
export function V2EditorContextMenu(p: EditorContextMenuProps): React.JSX.Element {
  const { target, page, selection, selectionRef, selectedNode, selectedElementId, iconActions, architectureActions, camera } = p;
  return (
    <V2ContextMenu target={target} page={p.viewPage} selectionCount={selection.nodeIds.length} selectedNodeId={selection.primaryNodeId}
      readOnly={p.editLocked} actions={p.editActions} commit={p.commit}
      onEditLabel={() => {
        const primary = selectionRef.current.primaryNodeId;
        if (primary) p.openEditor(primary); else p.editSelectedConnectorLabel();
      }}
      onInspect={() => p.openWorkspace('inspect')}
      onEditAsCode={(frameId) => { p.code.openFrame(frameId); p.dismiss(); }}
      // Only worked out while the menu is open: both walk the page.
      iconCount={target ? page.nodes.filter((node) => selection.nodeIds.includes(node.id) && hasIcon(node)).length : 0}
      onRemoveIcons={() => iconActions.removeIcons(selectionRef.current.nodeIds)}
      diagramIcons={target && selection.nodeIds.length === 1 && iconToggleFrame(page, selection.nodeIds[0]!)
        ? { on: diagramIconsOn(page, selection.nodeIds[0]!) } : null}
      onToggleDiagramIcons={() => {
        const frameId = selectionRef.current.nodeIds[0];
        if (frameId) void iconActions.setDiagramIcons(frameId, !diagramIconsOn(page, frameId));
      }}
      modelElement={selectedElementId && selectedNode ? {
        id: selectedElementId,
        name: selectedNode.content.label as string ?? selectedElementId,
        // Opening a deeper view is Canvas behaviour: it would switch the page under the map.
        childView: !p.mapActive && p.zoomInto !== null,
        editable: !p.docReadOnly,
      } : null}
      onEditInModel={() => { if (selectedElementId) p.editInModel(selectedElementId); }}
      inMap={p.inMap}
      onDrillInto={() => { if (selectedElementId) architectureActions.drillToMap(selectedElementId); }}
      onUnplace={() => architectureActions.unplaceSelection(selectionRef.current.nodeIds)}
      onRemoveElement={() => { if (selectedElementId) architectureActions.removeElement(selectedElementId); }}
      onSelectAll={() => p.selectionApi.selectAll(p.viewPage)}
      onExport={p.openElementExport}
      onZoomToFit={p.fitAll}
      onZoomToSelection={() => camera.fitView(selectionRef.current.nodeIds)}
      onZoomTo100={camera.resetZoom}
      showGrid={p.showGrid} snapToGrid={p.snapToGrid}
      onToggleGrid={p.onToggleGrid}
      onToggleSnap={p.onToggleSnap}
      onClose={p.close}
    />
  );
}
