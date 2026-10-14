import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import {
  boxesMissing, buildPinPageCommand, buildRefreshDrawingCommand, drawingName, drawingOf, drawingSourceOf, drawingUntouched,
} from '../../application/map/pinPage';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import { saveDrawing, savedDrawing } from './map/mapDepth';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2Panels } from './useV2Panels';
import type { useV2RepoDocument } from './useV2RepoDocument';
import { mintV2Id } from './v2Document';
import { platformKeys } from './v2Shortcuts';

interface RepoDrawingInput {
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly repo: ReturnType<typeof useV2RepoDocument>;
  readonly readOnly: boolean;
  readonly page: ScenePage | null;
  readonly activePageId: string | null;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly pinnable: boolean;
  readonly repoPage: boolean;
  readonly documentRef: MutableRefObject<SceneDocumentV1 | null | undefined>;
  readonly commit: (command: DocumentCommand) => void;
  readonly pushToast: (toast: ToastItem) => void;
  readonly dismissToast: (toastId: string) => void;
  readonly notify: (message: string) => void;
  readonly setAnnouncement: (message: string) => void;
  /** Called from Map mode: the page keeps it in a ref made before the map, which takes it. */
  readonly openDrawingRef: RefObject<() => boolean>;
}

/** The repo map ↔ drawing flow: Canvas on a map opens (or makes) its drawing, and the drawing's way back. */
export function useV2RepoDrawing(input: RepoDrawingInput) {
  const {
    session, map, panels, repo, readOnly, page, activePageId, setActivePageId, pinnable, repoPage, documentRef,
    commit, pushToast, dismissToast, notify, setAnnouncement, openDrawingRef,
  } = input;
  const documentId = session.document?.id;
  const { openWorkspace } = panels;
  // A map and its drawing share coordinates: switching between them is not a page switch that re-frames the camera.
  const keepCameraOnPage = useRef<string | null>(null);
  const modelPanelAway = useRef(false);
  // The drawing each map was last left for (kept in this browser): Canvas goes back to that one, not just the last in page order.
  // Canvas asked for while the repo was still being read: once it is drawn, a toast offers it.
  const canvasAsked = useRef(false);
  // Drawings made this visit, by the page they came from: undoing one lands back on that page's Map.
  const drawnFrom = useRef(new Map<string, string>());
  /** Map → the drawing `pageId`: the drawing has the map's coordinates, so the camera stays and the boxes stay put. */
  const showDrawing = (pageId: string) => {
    // The model panel has nothing to say about a drawing (it would offer to start a C4 model on it): it steps aside, and
    // comes back with the map.
    modelPanelAway.current = panels.workspace === 'model';
    if (modelPanelAway.current) panels.closeWorkspace();
    // Map's "read from the code" note (and its Edit as drawing button) is spent once the drawing is on screen.
    dismissToast('map-read-only');
    keepCameraOnPage.current = pageId;
    if (page && documentId) saveDrawing(documentId, page.id, pageId);
    setActivePageId(pageId);
    map.setMode('canvas', { keep: true });
  };
  const pin = () => {
    const document = session.document;
    const mapPage = map.mapPage;
    if (!pinnable || !document || !mapPage || !page) return;
    const open = map.state().open;
    const single = open.length === 1 && map.model ? map.model.nodes[open[0]!]?.name : undefined;
    const pageId = mintV2Id('page');
    commit(buildPinPageCommand(document, mapPage, { pageId, name: drawingName(document, single ?? document.name), from: page.id }));
    drawnFrom.current.set(pageId, page.id);
    showDrawing(pageId);
    const back = platformKeys('M');
    setAnnouncement(`Editing a copy of the map. Map (${back}) goes back to it.`);
    pushToast({ id: 'map-drawing', tone: 'info', title: 'Editing a copy of the map', description: `The map stays as it is. Map (${back}) goes back to it.` });
  };
  // A fresh drawing of `mapPage` from the Canvas of an edited one (the map as it was when Canvas was chosen).
  const copyMap = (source: string, mapPage: ScenePage) => {
    const document = documentRef.current;
    if (!document?.pages.some((candidate) => candidate.id === source)) return;
    const pageId = mintV2Id('page');
    commit(buildPinPageCommand(document, mapPage, { pageId, name: drawingName(document, document.name), from: source }));
    drawnFrom.current.set(pageId, source);
    if (documentId) saveDrawing(documentId, source, pageId);
    dismissToast('map-drawing');
    keepCameraOnPage.current = pageId;
    setActivePageId(pageId);
  };
  const openDrawing = (): boolean => {
    const document = session.document;
    if (!document || !page) return false;
    const last = savedDrawing(document.id, page.id);
    const existing = (last ? document.pages.find((candidate) => candidate.id === last && drawingSourceOf(candidate) === page.id) : undefined)
      ?? drawingOf(document, page.id);
    if (existing) {
      // The map has changed since the copy (boxes opened or closed): a drawing nobody has edited follows it; an edited
      // one is the reader's own and stays as it is, with a fresh copy one click away.
      const mapPage = pinnable ? map.mapPage : null;
      const refresh = mapPage && drawingUntouched(session.session?.history.past ?? [], existing.id) ? buildRefreshDrawingCommand(existing, mapPage) : null;
      if (refresh) commit(refresh);
      showDrawing(existing.id);
      const missing = mapPage && !refresh ? boxesMissing(existing, mapPage) : 0;
      const source = page.id;
      if (refresh) pushToast({ id: 'map-drawing', tone: 'info', title: 'Drawing updated from the map', description: 'It follows the map until you edit it.' });
      else if (mapPage && missing > 0) {
        pushToast({
          id: 'map-drawing', tone: 'info', title: `The map shows ${missing} ${missing === 1 ? 'box' : 'boxes'} this drawing has not got`,
          description: 'Your edits keep this drawing as it was.', action: { label: 'New copy', onClick: () => copyMap(source, mapPage) },
        });
      }
      return true;
    }
    if (pinnable) { pin(); return true; }
    // Nothing to copy yet (still reading, a failed read, a shared view): Map stays, and says why.
    canvasAsked.current = repo.state.status === 'loading';
    notify(repo.state.status === 'loading' ? 'The map is still being read. Canvas can open once it is drawn.'
      : readOnly ? 'This shared map has no drawing. Use Edit to make your own copy.' : 'There is no map to draw on yet.');
    return true;
  };
  // This repo map already has a drawing (its Canvas opens it even when the repo cannot be read now).
  const repoDrawing = repoPage && session.document && page ? drawingOf(session.document, page.id) !== null : false;
  // A drawing's way back: the page it was copied from, in Map, the camera kept.
  const drawingSource = page ? drawingSourceOf(page) : null;
  const backTo = drawingSource && session.document?.pages.some((candidate) => candidate.id === drawingSource) ? drawingSource : null;
  const backToMap = (): boolean => {
    if (!backTo || !page) return false;
    if (documentId) saveDrawing(documentId, backTo, page.id);
    map.returnTo(backTo);
    dismissToast('map-drawing');
    keepCameraOnPage.current = backTo;
    setActivePageId(backTo);
    if (modelPanelAway.current && panels.workspace === null) openWorkspace('model');
    modelPanelAway.current = false;
    return true;
  };
  // Undo of a drawing made this visit: back to the page it came from, in Map (not the document's first page).
  useEffect(() => {
    if (!activePageId || !session.document || session.document.pages.some((candidate) => candidate.id === activePageId)) return;
    const from = drawnFrom.current.get(activePageId);
    if (!from || !session.document.pages.some((candidate) => candidate.id === from)) return;
    map.returnTo(from);
    setActivePageId(from);
  }, [activePageId, session.document, map, setActivePageId]);
  // The map asked for on Canvas is drawn now: say so, with the way in (never a switch the reader did not see coming).
  useEffect(() => {
    // Asked on the repo page, for this read: a failed read or another page drops it.
    if (!repoPage || repo.state.status === 'problem') { canvasAsked.current = false; return; }
    if (!canvasAsked.current || !pinnable) return;
    canvasAsked.current = false;
    pushToast({ id: 'map-canvas-ready', tone: 'info', title: 'The map is drawn', action: { label: 'Open Canvas', onClick: () => { openDrawingRef.current(); } } });
  }, [pinnable, pushToast, repoPage, repo.state.status, openDrawingRef]);

  return { showDrawing, repoDrawing, backTo, backToMap, keepCameraOnPage, pin, openDrawing };
}
