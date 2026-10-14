import { commandTouchesPage } from '../../domain/commands/pageTouch';
import type { DocumentCommand, SetPageCommand } from '../../domain/commands/types';
import { createDefaultSceneLayer } from '../../domain/document/defaults';
import type { SceneDocumentV1, SceneNode, ScenePage } from '../../domain/document/types';

// "Pin as page": the Map view frozen into an ordinary Canvas page, one insert-page = one undo step. It is a plain
// snapshot: no model/dsl/map metadata on its shapes, so nothing (modelPages, regenerate, Add element, autosave) can
// ever tie it back to the model and bring old data back. Cost: a later rename does not reach it.
// The page alone remembers which page it was drawn from (`drawingOf`, a page id, never an element id): its Canvas | Map
// switch goes back there, and that page's Canvas comes here. It keeps the map's coordinates, so the switch keeps the camera.

/** The page a drawing was copied from, or null for any other page. */
export const drawingSourceOf = (page: ScenePage): string | null =>
  typeof page.metadata.drawingOf === 'string' ? page.metadata.drawingOf : null;

/** The newest drawing of `sourceId` still in the document (the last in page order), or null. */
export const drawingOf = (document: SceneDocumentV1, sourceId: string): ScenePage | null =>
  [...document.pages].reverse().find((page) => drawingSourceOf(page) === sourceId) ?? null;

/**
 * Where an agent's change for the map page `mapId` goes, the map itself never being written: the drawing on screen
 * ('here'); the map's Canvas when the tab shows the map and it has a drawing or the map on screen can be copied
 * ('canvas'); from any other page, the map's newest drawing ('switch'); else nowhere ('none').
 */
export function agentDrawingRoute(document: SceneDocumentV1, mapId: string, shownId: string, canMake: boolean): 'here' | 'canvas' | 'switch' | 'none' {
  const shown = document.pages.find((page) => page.id === shownId);
  if (shown && drawingSourceOf(shown) === mapId) return 'here';
  if (shownId === mapId) return drawingOf(document, mapId) || canMake ? 'canvas' : 'none';
  return drawingOf(document, mapId) ? 'switch' : 'none';
}

/** "<base> (drawing)", numbered from 2 when a page already has that name. */
export function drawingName(document: SceneDocumentV1, base: string): string {
  const names = new Set(document.pages.map((page) => page.name));
  for (let n = 1; ; n += 1) {
    const name = `${base} (drawing${n === 1 ? '' : ` ${n}`})`;
    if (!names.has(name)) return name;
  }
}

// The map's boxes and lines with nothing that ties them back to the model.
const snapshot = (mapPage: ScenePage): Pick<ScenePage, 'nodes' | 'connectors'> => ({
  nodes: mapPage.nodes.map((node): SceneNode => ({ ...node, metadata: {} })),
  connectors: mapPage.connectors.map((connector) => ({ ...connector, metadata: {} })),
});

const REFRESH = 'refresh-drawing:';

/**
 * Whether the drawing `drawingId` is still the map's copy as made: the last step in `past` that wrote to it made it
 * (or refreshed it). Unknown history (a reload, a forgotten history) counts as edited, so an edit is never thrown away.
 */
export function drawingUntouched(past: readonly { readonly command: DocumentCommand }[], drawingId: string): boolean {
  const last = past.findLast(({ command }) => commandTouchesPage(command, drawingId))?.command;
  return (last?.kind === 'insert-page' && last.page.id === drawingId) || (last?.kind === 'set-page' && last.id === REFRESH + drawingId);
}

/** The untouched drawing redrawn from the map as it is now (one undo step), or null when it already matches. */
export function buildRefreshDrawingCommand(drawing: ScenePage, mapPage: ScenePage): SetPageCommand | null {
  const after = { ...drawing, ...structuredClone(snapshot(mapPage)) };
  return JSON.stringify(after) === JSON.stringify(drawing) ? null
    : { kind: 'set-page', id: REFRESH + drawing.id, label: 'Update drawing from map', pageId: drawing.id, before: drawing, after };
}

/** How many boxes the map shows that the drawing has not got (opened since it was copied, or deleted from it). */
export const boxesMissing = (drawing: ScenePage, mapPage: ScenePage): number => {
  const have = new Set(drawing.nodes.map((node) => node.id));
  return mapPage.nodes.filter((node) => !have.has(node.id)).length;
};

export function buildPinPageCommand(
  document: SceneDocumentV1,
  mapPage: ScenePage,
  opts: { pageId: string; name: string; index?: number; from?: string },
): DocumentCommand {
  if (!opts.pageId.trim() || document.pages.some((page) => page.id === opts.pageId)) throw new Error('Page ID must be non-empty and unique.');
  const name = opts.name.trim();
  if (!name) throw new Error('Page name must not be empty.');

  const page: ScenePage = {
    id: opts.pageId, name, diagramKind: 'architecture',
    layers: [createDefaultSceneLayer()], ...snapshot(mapPage), metadata: opts.from ? { drawingOf: opts.from } : {}, extensions: {},
  };
  return {
    kind: 'insert-page', id: `pin-map:${opts.pageId}`, label: 'Edit map as drawing',
    index: opts.index ?? document.pages.length, page: structuredClone(page),
  };
}
