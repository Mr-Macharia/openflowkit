// The Worker's fetch handler, driven by the SDK's own HTTP client through `fetch`: no stubs, no sockets.
// The same handler runs in workerd; `npm run smoke:remote -- <url>` checks a running one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createFetchHandler, type FetchHandlerOptions } from '../src/remote/fetchHandler.js';
import { deterministicLayout } from '../src/lib/agent.js';
import { decodeDslPayload } from '../src/lib/openLink.js';
import { VIEWER_MIME, VIEWER_URI } from '../src/lib/card.js';

const VIEWER = readFileSync(new URL('./fixtures/viewer/viewer.html', import.meta.url), 'utf8');
const ORIGIN = 'https://mcp.test';

function handler(options: Partial<FetchHandlerOptions> = {}) {
  return createFetchHandler({ viewerHtml: VIEWER, appOrigin: 'https://app.test', allowedHosts: ['mcp.test'], ...options });
}

async function connect(handle = handler()): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: (url, init) => handle(new Request(url, init)),
  }));
  return client;
}

const post = (handle: ReturnType<typeof handler>, body: BodyInit, headers: Record<string, string> = {}, path = '/mcp') =>
  handle(new Request(`${ORIGIN}${path}`, {
    method: 'POST', body, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    // A stream body needs half-duplex in Node's fetch.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit));

const call = (id: number, source: string) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'render_diagram', arguments: { source } } });

describe('remote fetch handler', () => {
  it('lists render_diagram and get_syntax, and serves the viewer', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_syntax', 'render_diagram']);
    expect(tools.find((tool) => tool.name === 'render_diagram')!._meta).toEqual({ ui: { resourceUri: VIEWER_URI } });
    const { contents } = await client.readResource({ uri: VIEWER_URI });
    expect(contents[0]).toMatchObject({ mimeType: VIEWER_MIME, text: VIEWER });
    await client.close();
  });

  it('draws: picture, counts, and a link that decodes back to the DSL', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'render_diagram', arguments: { source: 'Start -> Check\nCheck -> Done\n', title: 'Login' } });
    expect(result.isError).toBeFalsy();
    const card = result.structuredContent as { svg: string; openUrl: string; nodes: number; connectors: number; dsl: string };
    expect(card.svg.startsWith('<svg')).toBe(true);
    expect([card.nodes, card.connectors]).toEqual([3, 2]);
    expect(decodeDslPayload(card.openUrl.split('?d=')[1]!)).toBe(card.dsl);
    expect((result.content as { text: string }[])[0]!.text).not.toContain('<svg');
    await client.close();
  });

  it('returns the grammar', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'get_syntax', arguments: { family: 'flowchart' } });
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).not.toMatch(/Grammar unavailable/);
    expect(text.length).toBeGreaterThan(500);
    await client.close();
  });

  it('answers /healthz on any host, and refuses a Host it does not serve', async () => {
    const handle = handler();
    expect(await (await handle(new Request('https://anything.example/healthz'))).text()).toBe('ok');
    const refused = await handle(new Request('https://evil.example/mcp', { method: 'POST', body: '{}' }));
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('Invalid Host: evil.example');
  });

  it('answers 404 off /mcp and 405 to GET and DELETE', async () => {
    const handle = handler();
    expect((await post(handle, '{}', {}, '/other')).status).toBe(404);
    for (const method of ['GET', 'DELETE']) {
      const response = await handle(new Request(`${ORIGIN}/mcp`, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('answers 413 to a body over 512 KB, by length and by stream', async () => {
    const handle = handler();
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(600 * 1024) } });
    expect((await post(handle, big)).status).toBe(413);
    // No content-length: the cap holds while reading.
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < 10) controller.enqueue(chunk); else controller.close(); } });
    expect((await post(handle, stream)).status).toBe(413);
  });

  it('answers 400 to a body that is not JSON', async () => {
    const response = await post(handler(), 'not json');
    expect(response.status).toBe(400);
  });

  it('refuses a source over 100 KB and an invalid diagram with diagnostics', async () => {
    const client = await connect();
    const big = await client.callTool({ name: 'render_diagram', arguments: { source: 'A -> B\n'.repeat(20_000) } }).catch(() => ({ isError: true }));
    expect(big.isError).toBe(true);
    const bad = await client.callTool({ name: 'render_diagram', arguments: { source: 'flowchart TD\n  A[[[ --> \n' } });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it('answers 503 with Retry-After past the render cap, then recovers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const held: FetchHandlerOptions['layout'] = { run: async (graph, signal) => { await gate; return deterministicLayout.run(graph as never, signal); } };
    const handle = handler({ layout: held, maxRenders: 2, deadlineMs: 30_000 });
    const two = [1, 2].map((id) => post(handle, call(id, 'A -> B')));
    await new Promise((done) => setTimeout(done, 100));
    const third = await post(handle, call(3, 'A -> B'));
    expect(third.status).toBe(503);
    expect(third.headers.get('retry-after')).toBe('2');
    release();
    for (const response of await Promise.all(two)) expect(response.status).toBe(200);
    expect((await post(handle, call(4, 'A -> B'))).status).toBe(200);
  });

  it('queues a render past the cap when asked to, and 503s only when the wait runs out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const held: FetchHandlerOptions['layout'] = { run: async (graph, signal) => { await gate; return deterministicLayout.run(graph as never, signal); } };
    const handle = handler({ layout: held, maxRenders: 1, queueMs: 2_000, deadlineMs: 30_000 });
    const first = post(handle, call(1, 'A -> B'));
    await new Promise((done) => setTimeout(done, 100));
    const queued = post(handle, call(2, 'A -> B'));
    await new Promise((done) => setTimeout(done, 100));
    release();
    expect((await first).status).toBe(200);
    expect((await queued).status).toBe(200);

    const stuck: FetchHandlerOptions['layout'] = { run: () => new Promise(() => {}) };
    const short = handler({ layout: stuck, maxRenders: 1, queueMs: 150, deadlineMs: 1_000 });
    const holding = post(short, call(3, 'A -> B'));
    await new Promise((done) => setTimeout(done, 50));
    const timedOut = await post(short, call(4, 'A -> B'));
    expect(timedOut.status).toBe(503);
    // The held render gives up at its deadline and frees the slot.
    expect((await holding).status).toBe(200);
    expect((await post(short, call(5, 'flowchart\nA -> B'))).status).toBe(200);
  });

  it('counts a batch that renders against the cap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const held: FetchHandlerOptions['layout'] = { run: async (graph, signal) => { await gate; return deterministicLayout.run(graph as never, signal); } };
    const handle = handler({ layout: held, maxRenders: 1, deadlineMs: 30_000 });
    const first = post(handle, `[${call(1, 'A -> B')}]`);
    await new Promise((done) => setTimeout(done, 100));
    expect((await post(handle, call(2, 'A -> B'))).status).toBe(503);
    release();
    await first;
  });
});
