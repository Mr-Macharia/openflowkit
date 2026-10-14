import { useEffect, useMemo, type RefObject } from 'react';
import { architectureWorkspaceText } from '../../../dsl/families/architecture/text';
import { archFrameOf } from '../../../dsl/model/model';
import { dslFrameRaw } from '../../../dsl/sceneMeta';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { ToastItem } from '../design-system';
import type { useV2Architecture } from './useV2Architecture';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Camera } from './useV2Camera';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import { useV2FlowPlayback } from './useV2FlowPlayback';
import { useV2WorkspaceFolder } from './useV2WorkspaceFolder';
import { counted } from './v2EditorUtil';

interface ModelWorkspaceInput {
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly page: ScenePage | null;
  readonly architecture: ReturnType<typeof useV2Architecture>;
  readonly architectureActions: ReturnType<typeof useV2ArchitectureActions>;
  readonly perspectiveTags: readonly string[];
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly rendererReady: boolean;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly docReadOnly: boolean;
  readonly mapActive: boolean;
  readonly pendingPageId: string | null;
  readonly setPendingPageId: (pageId: string | null) => void;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly pushToast: (toast: ToastItem) => void;
  readonly focusCanvas: () => void;
}

/** The model as a folder on disk, the page a workspace generate lands on, the flow player, and what it and the perspective tags spotlight. */
export function useV2ModelWorkspace({
  session, page, architecture, architectureActions, perspectiveTags, hostRef, rendererReady, camera, code, docReadOnly, mapActive, pendingPageId, setPendingPageId, setActivePageId, pushToast, focusCanvas,
}: ModelWorkspaceInput) {
  const workspaceFolder = useV2WorkspaceFolder({
    onLoad: (dsl, snaps) => {
      code.setDraft(dsl);
      return code.generate(dsl, snaps).then((committed) => { counted('created_import')(committed); return committed; });
    },
    onToast: (title, tone, description) => pushToast({ id: `workspace-${Date.now()}`, tone, title, ...(description ? { description } : {}) }),
  });
  // Committing a view writes the DSL + snaps back to the open folder. The
  // folder is the git-facing artifact; IndexedDB stays the app's storage.
  // Lines the parser kept verbatim (it could not read them) go back too, so the file never loses them.
  useEffect(() => {
    if (!workspaceFolder.folder || !session.document || docReadOnly || !architecture.model) return;
    const frame = (page && archFrameOf(page)) ?? session.document.pages.map(archFrameOf).find((found) => found !== null) ?? null;
    const kept = frame ? dslFrameRaw(frame).reserved : undefined;
    const reserved = Array.isArray(kept) ? kept.filter((line): line is string => typeof line === 'string') : [];
    const dsl = architectureWorkspaceText(architecture.model) + reserved.map((line) => `${line}\n`).join('');
    const timer = window.setTimeout(() => { void workspaceFolder.save(dsl, session.document!); }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.revision, workspaceFolder.folder, architecture.model, docReadOnly]);
  // A workspace generate commits pages that may not exist yet; land on the
  // requested one as soon as the committed document arrives.
  useEffect(() => {
    if (!pendingPageId || !session.document?.pages.some((candidate) => candidate.id === pendingPageId)) return;
    setActivePageId(pendingPageId);
    setPendingPageId(null);
  }, [pendingPageId, session.document, setActivePageId, setPendingPageId]);
  const playback = useV2FlowPlayback({
    model: architecture.model,
    document: session.document,
    page,
    glideToNodes: camera.glideToNodes,
    onOpenPage: setActivePageId,
  });
  // The player spotlights the Canvas page; Map has its own scene, so switching modes ends the flow.
  const { close: closeFlow } = playback;
  useEffect(() => { if (mapActive) closeFlow(); }, [mapActive, closeFlow]);
  const endFlow = () => { closeFlow(); focusCanvas(); };
  const perspectiveFocus = useMemo(
    () => (playback.flow ? null : architectureActions.perspectiveFocus(perspectiveTags)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [architectureActions, playback.flow, perspectiveTags, page],
  );
  // One spotlight source: flow playback wins while it is open, then tags. Map mode has its own, from its selection.
  useEffect(() => {
    if (rendererReady && !mapActive) hostRef.current?.setFocus(playback.focus ?? perspectiveFocus);
  }, [playback.focus, perspectiveFocus, rendererReady, mapActive, hostRef]);
  return { workspaceFolder, playback, endFlow };
}
