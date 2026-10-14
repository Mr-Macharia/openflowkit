import { useCallback, useEffect, useRef } from 'react';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { DocumentCommand } from '../../domain/commands/types';
import { commandTouchesPage } from '../../domain/commands/pageTouch';
import { track } from '../../../services/usage/usage';
import type { useV2RepoDocument } from './useV2RepoDocument';
import { insertsNode } from './v2EditorUtil';

/** Every write goes through here: the repo map's lock refuses what touches its page, with no undo entry. */
export function useV2GuardedCommit(session: ReturnType<typeof useDocumentSession>, repo: ReturnType<typeof useV2RepoDocument>, setAnnouncement: (message: string) => void) {
  // Every write goes through here: one that touches the repo's own page (an agent addressing it, a proposal applied after the reader
  // left it) or any write to a document whose lock is broken is refused, with no undo entry.
  const lockRef = useRef({ id: repo.lockedPageId, broken: repo.broken });
  useEffect(() => { lockRef.current = { id: repo.lockedPageId, broken: repo.broken }; });
  const { commit: sessionCommit } = session;
  const writable = useCallback((command: DocumentCommand) => {
    const { id, broken } = lockRef.current;
    if (broken || (id !== null && commandTouchesPage(command, id))) { setAnnouncement('The repo map is read-only'); return false; }
    return true;
  }, [setAnnouncement]);
  const commit = useCallback((command: DocumentCommand) => { if (writable(command)) sessionCommit(command); }, [writable, sessionCommit]);
  // The tools' commit: the first shape on an empty document is a diagram drawn by hand.
  const documentRef = useRef(session.document);
  useEffect(() => { documentRef.current = session.document; });
  const drawCommit = useCallback((command: DocumentCommand) => {
    if (insertsNode(command) && writable(command) && documentRef.current?.pages.every((candidate) => candidate.nodes.length === 0)) track('created_draw');
    commit(command);
  }, [commit, writable]);
  return { writable, commit, drawCommit, documentRef };
}
