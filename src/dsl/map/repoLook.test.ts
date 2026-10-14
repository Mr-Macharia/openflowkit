import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import { SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION } from '../../opencanvas/domain/document/types';
import { architectureCardHeight } from '../../opencanvas/domain/nodes/architectureCardLayout';
import { paletteResolver } from '../../opencanvas/domain/nodes/nodePalette';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { budgetEdges } from './edgeBudget';
import { buildMap } from './build';
import { fromElkLayout, toElkGraph, type ElkNode } from './elk';
import { FIXTURE } from './fixture';
import { repoLook } from './repoLook';
import { closedBoxSize, mapScene } from './scene';
import type { Depth } from './types';
import { aggregate, presets } from './view';

const model = buildMap(FIXTURE);
const look = repoLook(model, { swatch: paletteResolver('pastel') });
const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
const JARGON = /\bC4\b|\bContainers?\b|\bContext\b|Software system|External system|\bService\b|Component/;

async function sceneAt(depth: Depth) {
  const shown = presets(model)[depth];
  const edges = budgetEdges(model, aggregate(model, shown).edges).filter((e) => !e.minor);
  const graph = toElkGraph(model, shown, edges, (n) => closedBoxSize(look, n), (t) => t.length * 6);
  const laid = fromElkLayout((await new ELK().layout(graph as never)) as unknown as ElkNode);
  return mapScene(model, shown, { rects: laid.rects, edges }, look);
}

describe('repoLook', () => {
  it.each(['overview', 'detailed', 'everything'] as const)('draws a valid scene at %s with plain words only', async (depth) => {
    const page = await sceneAt(depth);
    const result = validateSceneDocumentV1({
      format: SCENE_DOCUMENT_FORMAT, schemaVersion: SCENE_DOCUMENT_VERSION, id: 'd', name: 'd',
      createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', pages: [page], metadata: {}, extensions: {},
    });
    expect(result.success, JSON.stringify('issues' in result ? result.issues : [])).toBe(true);
    const text = page.nodes.flatMap((n) => [n.content.label, n.content.subLabel]).filter((t): t is string => typeof t === 'string');
    expect(text.filter((t) => JARGON.test(t))).toEqual([]);
  });

  it('draws a closed box as the editor card: a plain kind chip, its language, the size as a quiet note', async () => {
    const page = await sceneAt('everything');
    const node = (id: string) => page.nodes.find((n) => n.id === id)!;
    // An open box is a frame: its footer says the kind and size the way a card does, without brackets.
    expect(node('server/routes').content.subLabel).toBe(`Folder · ${model.nodes['server/routes'].files} files`);
    const file = node('server/routes/r00.ts');
    expect(file.kind).toBe('architecture');
    expect(file.content).toMatchObject({
      label: 'r00.ts', archProviderLabel: 'File', archResourceType: 'TypeScript', icon: 'developer/languages-typescript',
      archEnvironment: `${model.nodes['server/routes/r00.ts'].loc} lines`, assetPresentation: 'card',
    });
    // No brackets anywhere on a card, and its name said once.
    for (const card of page.nodes.filter((n) => n.kind === 'architecture')) {
      const said = strings(card.content);
      expect(said.filter((t) => /[[\]]/.test(t)), card.id).toEqual([]);
      const fields = [card.content.archProviderLabel, card.content.archResourceType, card.content.archEnvironment];
      expect(fields, card.id).not.toContain(card.content.label);
    }
    expect(node('ext:stripe').content).toMatchObject({ archProviderLabel: 'Outside service', icon: 'tabler/brand-stripe' });
    // A more box is leftovers, not a TypeScript thing: no language, its own icon.
    expect(node('server/routes#more').content).toMatchObject({ archProviderLabel: 'More', archResourceType: '', icon: 'tabler/dots' });
  });

  it('follows the theme: a card takes its colours from the palette keys, not a painted fill', async () => {
    const page = await sceneAt('overview');
    const web = page.nodes.find((n) => n.id === 'web')!;
    expect(web.content).toMatchObject({ label: 'Web app', archProviderLabel: 'Module', archResourceType: 'TypeScript', archEnvironment: '4 files' });
    expect(web.appearance).toEqual({});
    // As tall as what it says: no empty lower half, so a map is not larger than its words need.
    expect(web.size.height).toBe(architectureCardHeight(web, resolveNodeStyle(web)));
    expect(web.size.height).toBeLessThan(120);
    // Every colour is a kind's own (washed on a dark canvas), never one an author chose (kept pale there).
    const cards = (await sceneAt('everything')).nodes.filter((n) => n.kind === 'architecture');
    expect(cards.filter((n) => n.content.color && n.content.archKindColor !== n.content.color).map((n) => n.id)).toEqual([]);
    expect(cards.find((n) => n.id === 'ext:stripe')!.content.archKindColor).toBeDefined();
  });

  it('names a part by what discovery found it runs, with that technology\'s icon; a part with no source says no count', () => {
    const m = buildMap({
      files: [{ path: 'vote/app.py', loc: 51 }], imports: [],
      parts: [{ name: 'vote', dir: 'vote', desc: 'container · Python' }, { name: 'worker', dir: 'worker', desc: 'container · .NET' }],
    });
    const l = repoLook(m, { swatch: paletteResolver('pastel') });
    const vote = l.arch.elements.find((e) => e.id === 'vote')!;
    expect(vote).toMatchObject({ tech: 'Python', icon: 'developer/languages-python', desc: '1 file' });
    expect(l.arch.elements.find((e) => e.id === 'worker')).toMatchObject({ tech: '.NET', icon: 'developer/backend-dotnet' });
    expect(l.arch.elements.find((e) => e.id === 'worker')!.desc).toBeUndefined();
  });

  it('tags a part by its language, not by a protocol or runtime discovery noticed', () => {
    const m = buildMap({
      files: [{ path: 'cart/main.go', loc: 40 }, { path: 'web/app.ts', loc: 9 }],
      imports: [], parts: [{ name: 'cart', dir: 'cart', desc: 'container · gRPC' }, { name: 'web', dir: 'web', desc: 'container · Node' }],
    });
    const l = repoLook(m, { swatch: paletteResolver('pastel') });
    expect(l.arch.elements.find((e) => e.id === 'cart')).toMatchObject({ tech: 'Go' });
    expect(l.arch.elements.find((e) => e.id === 'web')).toMatchObject({ tech: 'TypeScript' });
  });

  it('a box with no known language gets its kind\'s plain icon, never none', () => {
    const m = buildMap({ files: [{ path: 'docs/a.md', loc: 3 }, { path: 'lib/x.unknown', loc: 3 }], imports: [] });
    const l = repoLook(m, { swatch: paletteResolver('pastel') });
    expect(l.arch.elements.every((e) => e.icon && e.icon !== 'none')).toBe(true);
  });

  it('draws outside services as the gray external look, and more/group boxes', async () => {
    const page = await sceneAt('everything');
    expect(look.arch.elements.find((e) => e.id === 'ext:stripe')).toMatchObject({ kind: 'external' });
    expect(page.nodes.some((n) => n.id === 'server/routes#more')).toBe(true);
    expect(page.nodes.some((n) => n.id === 'root#outside')).toBe(true);
  });

  it('draws the repo scene at overview', async () => {
    const page = await sceneAt('overview');
    expect(page.nodes.map((n) => [n.id, n.kind, n.parentId, n.size, n.content.label, n.content.subLabel])).toMatchSnapshot();
  });
});

describe('repoLook sizing', () => {
  it('sizes a box for its tag, wider than the same box without tags', () => {
    const long = buildMap({ files: Array.from({ length: 6 }, (_, i) => ({ path: `d/f${i}.ts`, loc: 12345 })), imports: [] });
    const node = long.nodes.d;
    const withTag = repoLook(long, { swatch: paletteResolver('pastel') });
    const tags = new Map([[node.id, 'Folder · 120 files in this folder, all of them']]);
    const wide = closedBoxSize({ ...withTag, tags }, node).width;
    expect(wide).toBeGreaterThan(closedBoxSize({ ...withTag, tags: undefined }, node).width);
  });
});

describe('repoLook words', () => {
  const C4 = /Container|System|Software|Component|Context/i;

  it('never says "0 files" and counts a group by its descendants', () => {
    const notes = look.arch.elements.map((e) => e.desc ?? '');
    expect(notes.filter((t) => /(^|\D)0 files/.test(t))).toEqual([]);
    expect(look.tags!.get('root#outside')).toBe('Group');
    expect(look.arch.elements.find((e) => e.id === 'root#outside')!.desc).toBe('1 service');
    expect(look.arch.elements.find((e) => e.id === 'root#files')!.desc).toMatch(/^\d+ files?$/);
  });

  it('says no line count for a file not read yet (a preview while the repo is read), never "0 lines"', () => {
    const reading = repoLook(buildMap({ files: [{ path: 'src/a.ts', loc: 0 }, { path: 'src/b.ts', loc: 12 }], imports: [] }),
      { swatch: paletteResolver('pastel') });
    expect(reading.arch.elements.find((e) => e.id === 'src/a.ts')!.desc).toBeUndefined();
    expect(reading.arch.elements.find((e) => e.id === 'src/b.ts')!.desc).toBe('12 lines');
  });

  it('leaks no C4 word into any drawn field, even when the host infers icons', async () => {
    const withIcons = repoLook(model, { swatch: paletteResolver('pastel'), inferIcon: () => 'aws/lambda', resolveIcon: () => null });
    expect(withIcons.inferIcon).toBeUndefined();
    const shown = presets(model).everything;
    const edges = budgetEdges(model, aggregate(model, shown).edges).filter((e) => !e.minor);
    const graph = toElkGraph(model, shown, edges, (n) => closedBoxSize(withIcons, n), (t) => t.length * 6);
    const laid = fromElkLayout((await new ELK().layout(graph as never)) as unknown as ElkNode);
    const page = mapScene(model, shown, { rects: laid.rects, edges }, withIcons);
    for (const node of page.nodes) expect(strings(node.content).filter((t) => C4.test(t)), node.id).toEqual([]);
  });
});
