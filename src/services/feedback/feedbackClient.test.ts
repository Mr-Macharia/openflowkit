// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareError } from '../share/shareClient';
import { FeedbackError, sendFeedback } from './feedbackClient';

// Real sockets: a server that answers with the status it is told to, and a port nobody listens on.
let server: Server;
let status = 201;
let received: { headers: IncomingHttpHeaders; body: unknown; path: string } | null = null;
let origin: string;
let deadOrigin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || 'null'), path: req.url ?? '' };
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  deadOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const token = async () => 'tok';
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as FeedbackError);

describe('sendFeedback', () => {
  it('a bare rating posts JSON with no human check', async () => {
    status = 204;
    let asked = false;
    await sendFeedback({ kind: 'feature', feature: 'export', rating: 'up', version: '2.0.0' }, { origin, getToken: async () => { asked = true; return 'x'; } });
    expect(asked).toBe(false);
    expect(received?.path).toBe('/feedback');
    expect(received?.headers['content-type']).toBe('application/json');
    expect(received?.headers['x-turnstile-token']).toBeUndefined();
    expect(received?.body).toEqual({ kind: 'feature', feature: 'export', rating: 'up', version: '2.0.0' });
  });

  it('text or email carries the Turnstile token; both are trimmed and capped, blanks dropped', async () => {
    status = 201;
    await sendFeedback({ kind: 'general', text: `  ${'x'.repeat(2100)} `, email: '   ', version: '2.0.0' }, { origin, getToken: token });
    expect(received?.headers['x-turnstile-token']).toBe('tok');
    const body = received?.body as { text: string; email?: string };
    expect(body.text).toHaveLength(2000);
    expect(body.email).toBeUndefined();
    await sendFeedback({ kind: 'product', pmf: 'very', email: 'a@b.co', version: '2.0.0' }, { origin, getToken: token });
    expect(received?.headers['x-turnstile-token']).toBe('tok');
  });

  it.each([
    [400, 'invalid', /email address/],
    [403, 'turnstile', /human check failed/],
    [429, 'rate-limited', /Wait a minute/],
    [500, 'server', /\(500\)/],
    [503, 'server', /\(503\)/],
  ] as const)('HTTP %i → %s', async (code, kind, message) => {
    status = code;
    const error = await failure(sendFeedback({ kind: 'general', text: 'hi', version: '2.0.0' }, { origin, getToken: token }));
    expect(error).toBeInstanceOf(FeedbackError);
    expect(error?.code).toBe(kind);
    expect(error?.message).toMatch(message);
  });

  it('a closed port is unreachable, said plainly', async () => {
    const error = await failure(sendFeedback({ kind: 'feature', feature: 'ai', rating: 'down', version: '2.0.0' }, { origin: deadOrigin }));
    expect(error?.code).toBe('unreachable');
    expect(error?.message).toMatch(/isn’t reachable/);
  });

  it('a failed human check never posts', async () => {
    received = null;
    const blocked = async (): Promise<string> => { throw new ShareError('offline', 'Couldn’t load the human check. Check your connection and try again.'); };
    expect((await failure(sendFeedback({ kind: 'general', text: 'hi', version: '2.0.0' }, { origin, getToken: blocked })))?.code).toBe('offline');
    const unset = async (): Promise<string> => { throw new ShareError('no-site-key', 'Share links aren’t set up'); };
    expect((await failure(sendFeedback({ kind: 'general', text: 'hi', version: '2.0.0' }, { origin, getToken: unset })))?.message).toBe('Feedback isn’t set up in this build.');
    expect(received).toBeNull();
  });
});
