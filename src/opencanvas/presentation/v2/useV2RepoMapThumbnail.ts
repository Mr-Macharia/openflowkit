import { useCallback, useEffect, useRef } from 'react';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { createV2Repository } from '../../../services/storage/v2/v2Repository';
import { firstMapVisit } from './map/mapDepth';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2RepoDocument } from './useV2RepoDocument';
import { scheduleV2Thumbnail } from './v2Thumbnail';

interface RepoMapThumbnailInput {
  readonly id: string | undefined;
  readonly repoPage: boolean;
  readonly page: ScenePage | null;
  readonly repoReadable: boolean;
  readonly repo: ReturnType<typeof useV2RepoDocument>;
  readonly document: SceneDocumentV1 | null;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly repository: ReturnType<typeof createV2Repository>;
  readonly openWorkspace: (mode: 'model') => void;
}

/** A repo map's Recents card pictures the map; returns what swaps the map in for the stored (empty) page. */
export function useV2RepoMapThumbnail({ id, repoPage, page, repoReadable, repo, document: sessionDocument, map, repository, openWorkspace }: RepoMapThumbnailInput) {
  // A repo map's card in Recents always pictures the map (its stored page holds no nodes): the map as last drawn this visit stands
  // in for that page whenever a thumbnail is made — once when the read is done (a visit that only looks never saves), and on
  // every save (a drawing's edit), so the card never flips between the map and a drawing.
  const repoMapScene = useRef<{ pageId: string; page: ScenePage } | null>(null);
  const withMapScene = useCallback((document: SceneDocumentV1): SceneDocumentV1 => {
    const shown = repoMapScene.current;
    return shown ? { ...document, pages: document.pages.map((candidate) => (candidate.id === shown.pageId ? { ...candidate, nodes: shown.page.nodes, connectors: shown.page.connectors } : candidate)) } : document;
  }, []);
  const mapThumbed = useRef<string | null>(null);
  useEffect(() => {
    const document = sessionDocument;
    const scene = map.mapPage;
    if (!id || !repoPage || !page || !repoReadable || repo.state.status !== 'ready' || !document || !scene || scene.nodes.length === 0) return;
    repoMapScene.current = { pageId: page.id, page: scene };
    if (mapThumbed.current === id) return;
    mapThumbed.current = id;
    scheduleV2Thumbnail(repository, id, withMapScene(document));
  }, [id, repoPage, page, repoReadable, repo.state.status, sessionDocument, map.mapPage, repository, withMapScene]);
  // A repo map's first visit opens its outline beside it, once there is a map: a state screen (failure, empty repo) has no side panel.
  useEffect(() => {
    if (repoPage && map.active && repoReadable && sessionDocument && firstMapVisit(sessionDocument.id)) openWorkspace('model');
  }, [repoPage, map.active, repoReadable, sessionDocument, openWorkspace]);
  return withMapScene;
}
