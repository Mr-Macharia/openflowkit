import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { C4_STARTER } from '../../../agent/starterTemplates';
import { compileWorkspace } from '../../../dsl/compile';
import { budgetEdges } from '../../../dsl/map/edgeBudget';
import { fromElkLayout, toElkGraph, type ElkNode } from '../../../dsl/map/elk';
import { fromArch } from '../../../dsl/map/fromArch';
import { closedBoxSize, mapScene, type MapLook } from '../../../dsl/map/scene';
import { aggregate, presets } from '../../../dsl/map/view';
import { archFrameOf, archModelFromJson } from '../../../dsl/model/model';
import type { ArchModel } from '../../../dsl/model/types';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { createDefaultSceneLayer } from '../../domain/document/defaults';
import { validateSceneDocumentV1 } from '../../domain/document/validation';
import { paletteResolver } from '../../domain/nodes/nodePalette';
import { SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, type SceneDocumentV1, type ScenePage } from '../../domain/document/types';
import { buildArchElementAddCommand, buildWorkspacePagesCommand, modelPages } from '../dsl/architectureCommands';
import {
  agentDrawingRoute, boxesMissing, buildPinPageCommand, buildRefreshDrawingCommand, drawingName, drawingOf, drawingSourceOf, drawingUntouched,
} from './pinPage';

const NESTED = `architecture
model {
  person Customer
  system Shop {
    container Web [tech: React]
    container API [tech: Go] { component Router; component Orders; Router -> Orders }
    store DB [tech: Postgres]
    Web -> API : calls
    API -> DB : reads
  }
  external Stripe
  Customer -> Shop.Web : uses
  Shop.API.Orders -> Stripe : charges [tech: HTTPS]
}
views { view container of Shop }
`;

async function world(text: string) {
  const workspace = await compileWorkspace(text);
  const view = workspace.views[0]!;
  const arch = (view.result.frame.metadata.dsl as { arch: { model: unknown } }).arch.model;
  const model = archModelFromJson(arch)!;
  const page: ScenePage = {
    id: 'p1', name: 'Page 1', diagramKind: 'architecture', layers: [createDefaultSceneLayer()],
    nodes: [view.result.frame, ...view.result.groups, ...view.result.nodes], connectors: view.result.connectors,
    metadata: { view: { id: view.viewId } }, extensions: {},
  };
  const document: SceneDocumentV1 = {
    format: SCENE_DOCUMENT_FORMAT, schemaVersion: SCENE_DOCUMENT_VERSION, id: 'd', name: 'd',
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', pages: [page], metadata: {}, extensions: {},
  };
  return { workspace, model, document };
}

async function mapPageOf(arch: ArchModel, open?: ReadonlySet<string>): Promise<ScenePage> {
  const map = fromArch(arch);
  const shown = open ?? presets(map).overview;
  const look: MapLook = { arch, swatch: paletteResolver('pastel') };
  const edges = budgetEdges(map, aggregate(map, shown).edges).filter((e) => !e.minor);
  const graph = toElkGraph(map, shown, edges, (n) => closedBoxSize(look, n), (t) => t.length * 6);
  const laid = fromElkLayout((await new ELK().layout(graph as never)) as unknown as ElkNode);
  return mapScene(map, shown, { rects: laid.rects, edges }, look);
}

const pin = (document: SceneDocumentV1, mapPage: ScenePage) => buildPinPageCommand(document, mapPage, { pageId: 'pinned', name: 'Shop (pinned)', index: 1 });
const pinnedPage = (command: ReturnType<typeof pin>) => (command as { page: ScenePage }).page;

describe('buildPinPageCommand', () => {
  it('inserts a valid page in one undo step that restores the document exactly', async () => {
    const { model, document } = await world(NESTED);
    const command = pin(document, await mapPageOf(model, new Set(['shop'])));
    expect(command).toMatchObject({ kind: 'insert-page', label: 'Edit map as drawing', index: 1 });
    const applied = applyDocumentCommand(document, command);
    expect(applied.document.pages.map((p) => p.id)).toEqual(['p1', 'pinned']);
    expect(validateSceneDocumentV1(JSON.parse(JSON.stringify(applied.document)))).toEqual({ success: true, document: applied.document });
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
  });

  it('is a plain snapshot: no model, dsl or map metadata, invisible to the model', async () => {
    const { model, document } = await world(NESTED);
    const mapPage = await mapPageOf(model, new Set(['shop']));
    const page = pinnedPage(pin(document, mapPage));
    expect(page.nodes.length).toBe(mapPage.nodes.length);
    expect(page.connectors.length).toBe(mapPage.connectors.length);
    for (const item of [...page.nodes, ...page.connectors]) expect(item.metadata).toEqual({});
    expect(page.metadata).toEqual({});
    expect(archFrameOf(page)).toBeNull();
    expect(page.nodes.find((n) => n.id === 'shop.api')!.parentId).toBe('shop');
    expect(page.nodes.find((n) => n.id === 'shop.web')!.content.label).toBe('Web');
    expect(modelPages(applyDocumentCommand(document, pin(document, mapPage)).document, 'shop.web').map((p) => p.page.id)).toEqual(['p1']);
  });

  it('never brings back an element deleted in code, and survives the regenerate', async () => {
    const { model, document } = await world(NESTED);
    const { document: pinned } = applyDocumentCommand(document, pin(document, await mapPageOf(model, new Set(['shop']))));
    const edited = await compileWorkspace(NESTED.replace('  external Stripe\n', '').replace('  Shop.API.Orders -> Stripe : charges [tech: HTTPS]\n', ''));
    const regen = buildWorkspacePagesCommand(pinned, edited, { mintId: (p) => `${p}-new` });
    const after = regen ? applyDocumentCommand(pinned, regen).document : pinned;
    expect(after.pages.find((p) => p.id === 'pinned')).toEqual(pinned.pages[1]);
    const modelPage = after.pages.find((p) => p.id === 'p1')!;
    expect(JSON.stringify(modelPage)).not.toContain('"stripe"');
    const added = buildArchElementAddCommand(after, 'p1', { parentId: null, kind: 'system', name: 'Extra' })!;
    const done = applyDocumentCommand(after, added.command).document;
    expect(JSON.stringify(done.pages.find((p) => p.id === 'p1'))).not.toContain('"stripe"');
    expect(done.pages.find((p) => p.id === 'pinned')).toEqual(pinned.pages[1]);
  });

  it('keeps the map\'s coordinates, so the switch between them keeps the camera', async () => {
    const { model, document } = await world(C4_STARTER);
    const mapPage = await mapPageOf(model);
    const page = pinnedPage(pin(document, mapPage));
    expect(page.nodes.map((n) => n.transform)).toEqual(mapPage.nodes.map((n) => n.transform));
    expect(page.connectors.map((c) => c.waypoints)).toEqual(mapPage.connectors.map((c) => c.waypoints));
  });

  it('remembers the page it was drawn from; the newest drawing of a page is found, and names never repeat', async () => {
    const { model, document } = await world(C4_STARTER);
    const mapPage = await mapPageOf(model);
    expect(drawingOf(document, 'p1')).toBeNull();
    const first = applyDocumentCommand(document, buildPinPageCommand(document, mapPage, { pageId: 'a', name: drawingName(document, 'Shop'), from: 'p1' })).document;
    const second = applyDocumentCommand(first, buildPinPageCommand(first, mapPage, { pageId: 'b', name: drawingName(first, 'Shop'), from: 'p1' })).document;
    expect(second.pages.map((p) => p.name)).toEqual(['Page 1', 'Shop (drawing)', 'Shop (drawing 2)']);
    expect(drawingSourceOf(second.pages[1]!)).toBe('p1');
    expect(drawingSourceOf(second.pages[0]!)).toBeNull();
    expect(drawingOf(second, 'p1')?.id).toBe('b');
    expect(drawingOf(second, 'a')).toBeNull();
    expect(validateSceneDocumentV1(JSON.parse(JSON.stringify(second))).success).toBe(true);
    // Still invisible to the model: the page knows its source page, never an element.
    expect(archFrameOf(second.pages[2]!)).toBeNull();
  });

  it('keeps solid vs dashed, both heads of a two-way arrow, and the count label', async () => {
    const { model, document } = await world(NESTED.replace('Web -> API : calls', 'Web -> API : calls\n    Web -> API : pings\n    API -> Web : acks'));
    const mapPage = await mapPageOf(model, new Set(['shop']));
    const page = pinnedPage(pin(document, mapPage));
    const byId = (list: ScenePage, c: { id: string }) => list.connectors.find((x) => x.id === c.id)!;
    const two = mapPage.connectors.find((c) => c.source.nodeId === 'shop.web' && c.target.nodeId === 'shop.api')!;
    expect(byId(page, two).appearance).toEqual(two.appearance);
    expect(byId(page, two).appearance).toMatchObject({ markerStart: 'arrow', markerEnd: 'arrow' });
    expect(byId(page, two).appearance.dashPattern).toBeUndefined();
    expect(byId(page, two).labels[0]!.text).toBe('3 links');
    const implied = mapPage.connectors.find((c) => c.source.nodeId === 'shop' && c.target.nodeId === 'stripe')!;
    expect(byId(page, implied).appearance).toMatchObject({ dashPattern: 'dashed', markerEnd: 'arrow' });
  });

  it('refuses a taken page id, an empty id and an empty name; an empty page is fine', async () => {
    const { document } = await world(C4_STARTER);
    const empty: ScenePage = { ...document.pages[0]!, nodes: [], connectors: [] };
    expect(() => buildPinPageCommand(document, empty, { pageId: 'p1', name: 'x' })).toThrow(/unique/);
    expect(() => buildPinPageCommand(document, empty, { pageId: ' ', name: 'x' })).toThrow(/unique/);
    expect(() => buildPinPageCommand(document, empty, { pageId: 'q', name: ' ' })).toThrow(/name/);
    expect(applyDocumentCommand(document, buildPinPageCommand(document, empty, { pageId: 'q', name: 'x' })).document.pages).toHaveLength(2);
  });
});

// F02 (2026-10-14): an agent's change for the repo map goes to the map's drawing, the way Canvas goes there.
describe('a drawing after the map opens more boxes', () => {
  it('an untouched drawing follows the map in one undo step; an edited one only counts what it lacks', async () => {
    const { model, document } = await world(NESTED);
    const before = await mapPageOf(model, new Set(['shop']));
    const after = await mapPageOf(model, new Set(['shop', 'shop.api']));
    const made = buildPinPageCommand(document, before, { pageId: 'dr', name: 'Shop (drawing)', from: 'p1' });
    const drawn = applyDocumentCommand(document, made).document;
    const drawing = drawn.pages[1]!;
    const past = [{ command: made }];
    expect(drawingUntouched(past, 'dr')).toBe(true);
    expect(buildRefreshDrawingCommand(drawing, before)).toBeNull();
    expect(boxesMissing(drawing, after)).toBe(2);

    const refresh = buildRefreshDrawingCommand(drawing, after)!;
    const { document: fresh, inverse } = applyDocumentCommand(drawn, refresh);
    const redrawn = fresh.pages[1]!;
    expect(redrawn).toMatchObject({ id: 'dr', name: 'Shop (drawing)', metadata: { drawingOf: 'p1' } });
    expect(redrawn.nodes.map((n) => n.transform)).toEqual(after.nodes.map((n) => n.transform));
    expect(redrawn.nodes.every((n) => Object.keys(n.metadata).length === 0)).toBe(true);
    expect(applyDocumentCommand(fresh, inverse).document).toEqual(drawn);
    // Still untouched after a refresh; any edit (a user's, an agent's) makes it the reader's own.
    expect(drawingUntouched([...past, { command: refresh }], 'dr')).toBe(true);
    const node = redrawn.nodes[0]!;
    const edit = { kind: 'set-node', id: 'e', label: 'Move', pageId: 'dr', before: node, after: { ...node, transform: { ...node.transform, x: 5 } } } as const;
    expect(drawingUntouched([...past, { command: refresh }, { command: edit }], 'dr')).toBe(false);
    // Unknown history (a reload) never throws an edit away.
    expect(drawingUntouched([], 'dr')).toBe(false);
  });
});

describe('agentDrawingRoute', () => {
  const page = (id: string, drawingOf?: string): ScenePage => ({
    id, name: id, diagramKind: 'architecture', layers: [createDefaultSceneLayer()], nodes: [], connectors: [],
    metadata: drawingOf ? { drawingOf } : {}, extensions: {},
  });
  const doc = (...pages: ScenePage[]): SceneDocumentV1 => ({
    format: SCENE_DOCUMENT_FORMAT, schemaVersion: SCENE_DOCUMENT_VERSION, id: 'd', name: 'd',
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', pages, metadata: {}, extensions: {},
  });

  it('on the map: its Canvas, when it has a drawing or the map on screen can make one; else nowhere', () => {
    expect(agentDrawingRoute(doc(page('map'), page('dr', 'map')), 'map', 'map', false)).toBe('canvas');
    expect(agentDrawingRoute(doc(page('map')), 'map', 'map', true)).toBe('canvas');
    // Still being read, a failed read, a shared view: nothing to copy.
    expect(agentDrawingRoute(doc(page('map')), 'map', 'map', false)).toBe('none');
  });

  it('on the map\'s drawing: that drawing', () => {
    expect(agentDrawingRoute(doc(page('map'), page('dr', 'map'), page('dr2', 'map')), 'map', 'dr', false)).toBe('here');
  });

  it('on another page: the map\'s newest drawing, else nowhere (the map is not on screen to copy)', () => {
    expect(agentDrawingRoute(doc(page('map'), page('dr', 'map'), page('other')), 'map', 'other', true)).toBe('switch');
    expect(agentDrawingRoute(doc(page('map'), page('other'), page('x', 'other')), 'map', 'x', true)).toBe('none');
  });
});
