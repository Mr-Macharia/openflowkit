import { describe, expect, it } from 'vitest';
import { compile, type CompileResult } from './compile';
import { format, serialize } from './serialize';

const fixtures = import.meta.glob('./fixtures/**/*.dsl', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const names = Object.keys(fixtures).sort();

/** Structure and attributes only: geometry, storage ids and parse bookkeeping are not the law. */
function normalize(scene: CompileResult) {
  const parent = (id: string | null) => (id === scene.frame.id ? null : id);
  const label = (node: { content: Record<string, unknown> }) => node.content.label;
  return {
    nodes: scene.nodes
      .filter((node) => !(node.metadata.dsl as { noteFor?: string }).noteFor)
      .map((node) => ({
        id: node.id, kind: node.kind, parentId: parent(node.parentId),
        label: label(node), shape: node.content.shape ?? null, color: node.content.color ?? null,
        colorMode: node.content.colorMode ?? null, icon: node.content.icon ?? null,
        subLabel: node.content.subLabel ?? null,
        appearance: node.appearance, attrs: (node.metadata.dsl as { attrs?: unknown }).attrs ?? null,
        notes: (node.metadata.dsl as { notes?: unknown }).notes ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    groups: scene.groups
      .map((group) => ({ id: group.id, parentId: parent(group.parentId), label: label(group), color: group.content.color ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    connectors: scene.connectors
      .map((connector) => ({
        source: connector.source.nodeId, target: connector.target.nodeId,
        anchors: [connector.source.anchor, connector.target.anchor],
        appearance: connector.appearance, labels: connector.labels.map((item) => item.text),
        attrs: (connector.metadata.dsl as { attrs?: unknown }).attrs ?? null,
      }))
      .sort((a, b) => `${a.source}->${a.target}`.localeCompare(`${b.source}->${b.target}`)),
    comments: (scene.frame.metadata.dsl as { comments?: unknown }).comments ?? null,
    reserved: (scene.frame.metadata.dsl as { reserved?: unknown }).reserved ?? null,
    align: (scene.frame.metadata.dsl as { align?: unknown }).align ?? null,
    animate: (scene.frame.metadata.dsl as { animate?: unknown }).animate ?? null,
  };
}

describe('round-trip laws over fixtures', () => {
  it('has fixtures for the language surface', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it.each(names)('%s: format is idempotent', async (path) => {
    const canonical = await format(fixtures[path]!);
    expect(await format(canonical)).toBe(canonical);
  });

  it.each(names)('%s: serialize(compile) preserves structure and attributes', async (path) => {
    const first = await compile(fixtures[path]!);
    const second = await compile(serialize(first));
    expect(normalize(second)).toEqual(normalize(first));
  });

  // Canonical text is clean text: it may lose a warning the source earned, never gain one.
  it.each(names)('%s: serialized text re-parses without new diagnostics', async (path) => {
    const first = await compile(fixtures[path]!);
    const recompiled = await compile(serialize(first));
    const codes = (scene: CompileResult) => scene.diagnostics.filter((item) => item.severity !== 'info').map((item) => item.code);
    const added = codes(recompiled);
    for (const code of codes(first)) if (added.includes(code)) added.splice(added.indexOf(code), 1);
    expect(added).toEqual([]);
  });
});

describe('iconpos', () => {
  const source = 'architecture\nA [icon: tabler/server, iconpos: left]\n';

  it('turns an icon card into a row card, and writes back what it read', async () => {
    const scene = await compile(source);
    const node = scene.nodes.find((candidate) => candidate.id === 'a')!;
    expect(node.content.contentLayout).toMatchObject({ iconPlacement: 'left' });
    expect(node.size).toEqual({ width: 160, height: 56 });
    expect(serialize(scene)).toContain('A [tabler/server, iconpos: left]');
    expect(await format(serialize(scene))).toBe(serialize(scene));
  });

  it('accepts top as the default and never writes it', async () => {
    const scene = await compile('architecture\nA [icon: tabler/server, iconpos: top]\n');
    expect(scene.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(scene.nodes.find((candidate) => candidate.id === 'a')!.content).not.toHaveProperty('contentLayout');
    expect(serialize(scene)).toContain('A [tabler/server]');
  });

  it('warns on any other value, uses top and keeps what was written', async () => {
    const scene = await compile('architecture\nA [icon: tabler/server, iconpos: bogus]\n');
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({ code: 'W131', message: 'iconpos takes top or left; top used' }));
    expect(scene.nodes.find((candidate) => candidate.id === 'a')!.content).not.toHaveProperty('contentLayout');
    expect(serialize(scene)).toContain('iconpos: bogus');
  });

  it('keeps a person\'s actor layout and only moves its icon', async () => {
    const scene = await compile('architecture\nUser [person, iconpos: left]\n');
    expect(scene.nodes.find((candidate) => candidate.id === 'user')!.content.contentLayout).toMatchObject({ vertical: 'end', iconPlacement: 'left' });
  });

  it('warns when iconpos has no icon to place, and writes nothing for it', async () => {
    const scene = await compile('flowchart\nA [iconpos: left]\n');
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({ code: 'W131', message: expect.stringContaining('needs an icon') }));
    expect(scene.nodes.find((candidate) => candidate.id === 'a')!.content).not.toHaveProperty('contentLayout');
    expect(serialize(scene)).not.toContain('iconpos');
  });

  it('warns that a model element has no icon layout, and keeps the attribute', async () => {
    const scene = await compile('architecture\nmodel {\n  user = person User [iconpos: left]\n}\n');
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({ code: 'W131', message: expect.stringContaining('model elements') }));
    expect(serialize(scene)).toContain('iconpos: left');
  });
});
