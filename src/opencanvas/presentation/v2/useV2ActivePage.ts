import { useEffect, useMemo, useRef, useState } from 'react';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { ScenePage } from '../../domain/document/types';
import { firstV2Page, savePageId, savedPageId } from './v2Document';

/** The page on screen: the one picked, else the one this document was left on, else the first. */
export function useV2ActivePage(session: ReturnType<typeof useDocumentSession>) {
  // Pages are documents-in-document: the active page drives the canvas, the
  // context bar and export. Null means "the first page" (single-page default).
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const documentId = session.document?.id;
  // A document reopens on the page it was left on (U2-8); a page since deleted falls back to the first.
  const restoredPageId = useMemo(() => (documentId ? savedPageId(documentId) : null), [documentId]);
  const page = session.document
    ? session.document.pages.find((candidate) => candidate.id === (activePageId ?? restoredPageId)) ?? firstV2Page(session.document)
    : null;
  useEffect(() => {
    if (documentId && page && session.document) savePageId(documentId, page.id === session.document.pages[0]?.id ? null : page.id);
  }, [documentId, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageRef = useRef<ScenePage | null>(null);
  useEffect(() => {
    pageRef.current = page;
  });
  return { activePageId, setActivePageId, documentId, page, pageRef };
}
