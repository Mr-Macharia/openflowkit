import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { placedElementId } from '../../../dsl/model/model';
import { drawingOf } from '../../application/map/pinPage';
import { replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2Panels } from './useV2Panels';
import { useV2RepoPanel, type useV2RepoDocument } from './useV2RepoDocument';
import { platformKeys } from './v2Shortcuts';

interface MapHandoffInput {
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly panels: ReturnType<typeof useV2Panels>;
  /** Asks the model panel to open on this element with its name ready to type (the page keeps the request until the panel closes). */
  readonly setRenameRequest: (request: { readonly id: string }) => void;
  readonly document: SceneDocumentV1 | null;
  readonly page: ScenePage | null;
  readonly viewPage: ScenePage | null;
  readonly docReadOnly: boolean;
  readonly loadReadOnly: boolean;
  readonly repoSource: ReturnType<typeof useV2RepoDocument>['source'];
  readonly pinnable: boolean;
  readonly selection: CanvasSelection;
  readonly selectedConnectorId: string | null;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly selectedElementId: string | null;
  readonly pushToast: (toast: ToastItem) => void;
  readonly pinRef: RefObject<() => void>;
  readonly openDrawingRef: RefObject<() => boolean>;
}

/** Where Map hands the reader to Canvas or the model panel: which elements are placed where, and why a blocked edit was blocked. */
export function useV2MapHandoff(input: MapHandoffInput) {
  const { map, panels, setRenameRequest, document: sessionDocument, page, viewPage, docReadOnly, loadReadOnly, repoSource, pinnable, selectedElementId, pushToast, pinRef, openDrawingRef,
    selection, selectedConnectorId, applySelection, applyConnectorSelection } = input;
  const { openWorkspace } = panels;
  const placedElementIds = useMemo(() => new Set(
    (viewPage?.nodes ?? []).flatMap((node) => {
      const elementId = placedElementId(node);
      return elementId ? [elementId] : [];
    }),
  ), [viewPage]);
  const canvasElementIds = useMemo(() => new Set((page?.nodes ?? []).flatMap((node) => {
    const elementId = placedElementId(node);
    return elementId ? [elementId] : [];
  })), [page]);
  const showOnCanvas = (elementId: string) => map.choose('canvas', elementId);
  // "Edit in model": the model panel opens on the element's card with its name ready to type.
  const editInModel = (elementId: string) => { setRenameRequest({ id: elementId }); openWorkspace('model'); };
  // A double-click on a Map box: the drawing cannot change, so the box opens where it can (a repo box has only details).
  const editBox = (id: string) => {
    const box = map.mapPage?.nodes.find((node) => node.id === id);
    const elementId = box ? placedElementId(box) : null;
    if (elementId && !docReadOnly) editInModel(elementId); else openWorkspace('model');
  };
  // Once per visit to Map: the first edit that cannot happen says why, and where it can.
  const explainedMap = useRef(false);
  useEffect(() => { if (!map.active) explainedMap.current = false; }, [map.active]);
  const explainMap = () => {
    if (explainedMap.current || loadReadOnly) return;
    explainedMap.current = true;
    const elementId = !docReadOnly ? selectedElementId : null;
    const copy = pinnable ? { action: { label: 'Edit as drawing', onClick: () => pinRef.current() } } : {};
    pushToast(repoSource
      ? { id: 'map-read-only', tone: 'info', title: 'This map is read from the code',
        description: `To move boxes and draw, switch to Canvas (${platformKeys('M')}): it opens an editable copy.`,
        ...(pinnable || (sessionDocument && page && drawingOf(sessionDocument, page.id)) ? { action: { label: 'Open Canvas', onClick: () => { openDrawingRef.current(); } } } : {}) }
      : { id: 'map-read-only', tone: 'info', title: 'Map lays itself out',
        description: 'Edit boxes in the model panel, or use Edit as drawing to move them.',
        ...(elementId ? { action: { label: 'Edit in model', onClick: () => editInModel(elementId) } } : copy) });
  };
  const repoPanel = useV2RepoPanel({
    source: repoSource, map, selectedConnectorId,
    selectedBoxId: selection.nodeIds.length === 1 ? selection.nodeIds[0]! : null,
    selectArrow: (key) => { applySelection(replaceSelection([])); applyConnectorSelection([key]); },
  });
  // A Map arrow stands for every relation between the two boxes and their insides; the Model panel lists them.
  const c4Arrow = useMemo(() => {
    const connector = map.active && !repoSource && selectedConnectorId ? viewPage?.connectors.find((c) => c.id === selectedConnectorId) : undefined;
    const meta = connector?.metadata.map as { relations?: string[]; both?: boolean } | undefined;
    const relations = meta?.relations;
    return connector?.source.nodeId && connector.target.nodeId && relations
      ? { from: connector.source.nodeId, to: connector.target.nodeId, relationIds: relations, both: meta?.both === true } : null;
  }, [map.active, repoSource, selectedConnectorId, viewPage]);
  const mapArrow = repoPanel.arrow ?? c4Arrow;
  useEffect(() => { if (mapArrow) openWorkspace('model'); }, [mapArrow, openWorkspace]);
  return { placedElementIds, canvasElementIds, showOnCanvas, editInModel, editBox, repoPanel, mapArrow, explainMap };
}
