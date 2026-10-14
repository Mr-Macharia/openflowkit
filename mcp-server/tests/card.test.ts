import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { clientShowsApps, diagramCard, MAX_CARD_SVG_BYTES, MCP_APPS_EXTENSION, PREVIEW_TOOL, PREVIEW_TOOL_META, VIEWER_MIME, VIEWER_URI } from '../src/lib/card.js';
import { createServerWithDeps } from '../src/server.js';
import { LiveBridge } from '../src/lib/bridge.js';
import { bridgeUrls, type BridgeRequest } from '../src/lib/agent.js';
import { decodeDslPayload } from '../src/lib/openLink.js';

// The diagram card: one shape for the local and the remote server, shown only to hosts that said they can.

const UI = { extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: [VIEWER_MIME] } } };
const FLOW = 'flowchart\nCart -> Pay\nPay -> Done';
const base = { title: 'T', dsl: 'A -> B', nodes: 2, connectors: 1, diagnostics: [], losses: [], appOrigin: 'https://app.test' };

describe('diagramCard', () => {
  it('carries the picture and a link that decodes back to the DSL', () => {
    const card = diagramCard({ ...base, svg: '<svg/>' });
    expect(card.svg).toBe('<svg/>');
    expect(card.noPreview).toBeUndefined();
    expect(decodeDslPayload(card.openUrl!.split('?d=')[1]!)).toBe('A -> B');
  });

  it('drops a picture over the cap and says why, keeping the link', () => {
    const card = diagramCard({ ...base, svg: `<svg>${'x'.repeat(MAX_CARD_SVG_BYTES)}</svg>` });
    expect(card.svg).toBeUndefined();
    expect(card.noPreview).toMatch(/too large to show here/);
    expect(card.openUrl).toMatch(/^https:\/\/app\.test\/#\/from\/dsl\?d=/);
  });

  it('stamps every card with the server time and a rising sequence (the viewer greys out older cards by it)', () => {
    const first = diagramCard({ ...base, svg: '<svg/>' });
    const second = diagramCard({ ...base, svg: null });
    expect(Number.isFinite(first.createdAt)).toBe(true);
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt);
    expect(second.seq).toBe(first.seq + 1);
  });

  it('says there is no preview when the export failed', () => {
    expect(diagramCard({ ...base, svg: null }).noPreview).toBe('No preview is available for this diagram.');
  });

  it('notes a DSL too long for a link', () => {
    const dsl = Array.from({ length: 20_000 }, (_, i) => `N${i}${Math.random().toString(36)} -> M${i}`).join('\n');
    const card = diagramCard({ ...base, svg: '<svg/>', dsl });
    expect(card.openUrl).toBeNull();
    expect(card.losses.at(-1)).toMatch(/too large to open by link/);
  });
});

describe('clientShowsApps', () => {
  it('is true only for a host that advertised the MCP Apps extension', () => {
    expect(clientShowsApps(UI)).toBe(true);
    expect(clientShowsApps({ extensions: { [MCP_APPS_EXTENSION]: {} } })).toBe(true);
    expect(clientShowsApps({ extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: ['text/html'] } } })).toBe(false);
    expect(clientShowsApps({ extensions: {} })).toBe(false);
    expect(clientShowsApps({})).toBe(false);
    expect(clientShowsApps(undefined)).toBe(false);
  });
});

async function connect(capabilities: object, deps: Parameters<typeof createServerWithDeps>[0] = {}): Promise<Client> {
  const { server } = createServerWithDeps({ log: () => undefined, ...deps });
  const client = new Client({ name: 'test', version: '0' }, { capabilities });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

const textOf = (result: { content?: unknown }) => JSON.parse((result.content as { text: string }[])[0]!.text) as Record<string, unknown>;

describe('local server, file mode', () => {
  it('marks the drawing tools with the viewer and serves the real viewer page', async () => {
    const client = await connect(UI);
    const { tools } = await client.listTools();
    for (const name of ['create_diagram', 'update_diagram']) {
      expect(tools.find((tool) => tool.name === name)!._meta).toEqual({ ui: { resourceUri: VIEWER_URI } });
    }
    expect(tools.find((tool) => tool.name === 'move')!._meta).toBeUndefined();
    const { contents } = await client.readResource({ uri: VIEWER_URI });
    expect(contents[0]!.mimeType).toBe(VIEWER_MIME);
    expect(contents[0]!.text).toBe(readFileSync(new URL('../src/viewer/viewer.html', import.meta.url), 'utf8'));
    await client.close();
  });

  it('gives a host that shows apps the card, with the frame as its picture', async () => {
    const client = await connect(UI);
    await client.callTool({ name: 'openflow_create', arguments: { name: 'Shop' } });
    const result = await client.callTool({ name: 'create_diagram', arguments: { dsl: FLOW } });
    expect(result.isError).toBeFalsy();
    const card = result.structuredContent as { svg: string; dsl: string; openUrl: string; nodes: number; connectors: number; title: string };
    expect(card.svg.startsWith('<svg')).toBe(true);
    expect(card.svg).toContain('Cart');
    expect(card).toMatchObject({ dsl: FLOW, nodes: 3, connectors: 2 });
    expect(decodeDslPayload(card.openUrl.split('?d=')[1]!)).toBe(FLOW);
    // The model still gets the same JSON text as before, never the SVG.
    expect((result.content as { text: string }[])[0]!.text).not.toContain('<svg');

    const frameId = (textOf(result).output as { frameId: string }).frameId;
    const updated = await client.callTool({ name: 'update_diagram', arguments: { frameId, dsl: 'flowchart\nCart -> Ship' } });
    expect((updated.structuredContent as { svg: string }).svg).toContain('Ship');
    await client.close();
  });

  it('offers the card-only preview tool to a host that shows apps, and keeps it from one that does not', async () => {
    const apps = await connect(UI);
    const listed = (await apps.listTools()).tools.find((tool) => tool.name === PREVIEW_TOOL);
    expect(listed?._meta).toEqual(PREVIEW_TOOL_META);
    const preview = await apps.callTool({ name: PREVIEW_TOOL, arguments: { source: FLOW } });
    expect(preview.structuredContent).toMatchObject({ nodes: 3, connectors: 2 });
    expect((preview.structuredContent as { svg: string }).svg).toContain('data-node-id="frame"');
    await apps.close();

    const plain = await connect({});
    expect((await plain.listTools()).tools.map((tool) => tool.name)).not.toContain(PREVIEW_TOOL);
    expect((await plain.callTool({ name: PREVIEW_TOOL, arguments: { source: FLOW } }).catch((error: Error) => ({ isError: true, error }))).isError).toBe(true);
    await plain.close();
  });

  it('gives a text-only client no card, but a link to open the diagram in the app', async () => {
    const client = await connect({});
    await client.callTool({ name: 'openflow_create', arguments: { name: 'Shop' } });
    const result = await client.callTool({ name: 'create_diagram', arguments: { dsl: 'graph TD\n  A[Cart] --> B[Pay]' } });
    expect(result.structuredContent).toBeUndefined();
    const body = textOf(result);
    const converted = (body.output as { converted: { dsl: string } }).converted.dsl;
    // Mermaid converts first; the link opens the converted DSL, the text the agent keeps editing.
    expect(decodeDslPayload(String(body.openUrl).split('?d=')[1]!)).toBe(converted);
    await client.close();
  });

  it('leaves non-drawing ops and failed draws alone', async () => {
    const client = await connect(UI);
    await client.callTool({ name: 'openflow_create', arguments: { name: 'Shop' } });
    const failed = await client.callTool({ name: 'create_diagram', arguments: { dsl: 'flowchart' } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toBeUndefined();
    const listed = await client.callTool({ name: 'list_pages', arguments: {} });
    expect(listed.structuredContent).toBeUndefined();
    expect(textOf(listed).openUrl).toBeUndefined();
    await client.close();
  });
});

describe('local server, live mode', () => {
  let bridge: LiveBridge | null = null;
  afterEach(async () => { await bridge?.stop(); bridge = null; });

  /** Pairs a scripted editor that answers each op with `answer(op)`. */
  async function pairEditor(answer: (request: BridgeRequest) => { ok: true; output: unknown } | { ok: false; error: string }) {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const urls = bridgeUrls(await bridge.start());
    const headers = { 'content-type': 'text/plain;charset=UTF-8' };
    await fetch(urls.hello, { method: 'POST', headers, body: JSON.stringify({ document: { documentId: 'doc-live', name: 'Live', revision: 1, pageId: 'p1', pages: [{ pageId: 'p1', name: 'Page 1', nodes: 0, connectors: 0 }], app: 'test-editor' } }) });
    const seen: BridgeRequest[] = [];
    let running = true;
    void (async () => {
      while (running) {
        const response = await fetch(`${urls.next}?wait=1`, { headers }).catch(() => null);
        if (response?.status !== 200) continue;
        const request = await response.json() as BridgeRequest;
        seen.push(request);
        await fetch(urls.result, { method: 'POST', headers, body: JSON.stringify({ id: request.id, ...answer(request) }) });
      }
    })();
    return { seen, stop: () => { running = false; } };
  }

  const drawn = { pageId: 'p1', frameId: 'dsl-1', title: 'Checkout', nodes: 2, connectors: 1, diagnostics: [] };

  it('pictures the frame the editor drew, and sends no link (it is on the canvas)', async () => {
    const editor = await pairEditor((request) => request.op === 'export'
      ? { ok: true, output: { files: [{ filename: 'f.svg', mime: 'image/svg+xml', text: '<svg id="from-editor"/>' }] } }
      : { ok: true, output: drawn });
    const client = await connect(UI, { bridge: bridge! });
    const result = await client.callTool({ name: 'create_diagram', arguments: { dsl: 'flowchart\nA -> B' } });
    editor.stop();
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ svg: '<svg id="from-editor"/>', title: 'Checkout', nodes: 2, dsl: 'flowchart\nA -> B' });
    expect(textOf(result).openUrl).toBeUndefined();
    const exported = editor.seen.find((request) => request.op === 'export')!;
    expect(exported.input).toMatchObject({ format: 'svg', scope: 'selection', ids: ['dsl-1'] });
    expect(exported.pageId).toBe('p1');
    await client.close();
  });

  it('still succeeds when the editor cannot export: the card says there is no preview', async () => {
    const editor = await pairEditor((request) => request.op === 'export' ? { ok: false, error: 'export broke' } : { ok: true, output: drawn });
    const client = await connect(UI, { bridge: bridge! });
    const result = await client.callTool({ name: 'create_diagram', arguments: { dsl: 'flowchart\nA -> B' } });
    editor.stop();
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ noPreview: 'No preview is available for this diagram.' });
    expect((result.structuredContent as { svg?: string }).svg).toBeUndefined();
    await client.close();
  });
});
