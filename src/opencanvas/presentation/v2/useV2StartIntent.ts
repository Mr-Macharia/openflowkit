import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { findStarterTemplate } from '../../../agent/starterTemplates';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2DocumentLoad } from './useV2DocumentLoad';
import type { useV2RepoDocument } from './useV2RepoDocument';
import type { V2StartIntent } from './v2Document';
import { counted } from './v2EditorUtil';

interface StartIntentInput {
  readonly startIntent: V2StartIntent | null;
  readonly pathname: string;
  readonly shared: { readonly document: SceneDocumentV1 } | undefined;
  readonly load: ReturnType<typeof useV2DocumentLoad>;
  readonly page: ScenePage | null;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly repo: ReturnType<typeof useV2RepoDocument>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly commit: (command: DocumentCommand) => void;
  readonly openWorkspace: (mode: Extract<V2StartIntent, { start: unknown }>['start']) => void;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly pushToast: (toast: ToastItem) => void;
}

/** What the editor does once its document is open: tells a shared view it is read-only, and runs what Home asked for. */
export function useV2StartIntent({ startIntent, pathname, shared, load, page, session, repo, code, commit, openWorkspace, setActivePageId, pushToast }: StartIntentInput): void {
  const navigate = useNavigate();
  // The viewer's way in to editing (document bar) is a local, editable copy.
  useEffect(() => {
    if (!shared || load.phase !== 'ready') return;
    pushToast({ id: 'shared-view', tone: 'info', title: 'Shared diagram, read-only' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened link
  }, [load.phase, shared?.document]);

  // Home hands a new diagram what to start with; run it once the empty document is open.
  useEffect(() => {
    if (!startIntent || load.phase !== 'ready' || !page) return;
    navigate(pathname, { replace: true, state: null });
    if ('start' in startIntent) openWorkspace(startIntent.start);
    else if ('source' in startIntent) {
      // The title is set before the draw: the draw forgets undo history, so naming is not an undo step.
      const { name } = startIntent;
      if (name && name !== session.document!.name) commit({ kind: 'set-document-name', id: `rename-document:${session.document!.id}`, label: 'Rename document', before: session.document!.name, after: name });
      void code.startFrom(startIntent.source, { baseline: true }).then(counted(startIntent.via === 'repo' ? 'created_map' : 'created_import'));
    }
    // A repo's address asks for its map, even when the document was last left on a drawing.
    else if ('repoMap' in startIntent) { if (repo.lockedPageId) setActivePageId(repo.lockedPageId); }
    else if ('template' in startIntent) {
      const template = findStarterTemplate(startIntent.template);
      if (template) void code.startFrom(template.dsl, { baseline: true }).then(counted('created_template'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per intent
  }, [startIntent, load.phase, page === null]);
}
