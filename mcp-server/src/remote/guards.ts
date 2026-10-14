// The request rules every remote endpoint applies, Node (`http.ts`) or Cloudflare (`fetchHandler.ts`).
export const MAX_BODY_BYTES = 512 * 1024;
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/** The hostname of a Host header, without the port; null when it is missing or malformed. */
export function hostname(header: string | null | undefined): string | null {
  if (!header) return null;
  try { return new URL(`http://${header}`).hostname; } catch { return null; }
}

const toolCalled = (message: unknown): string | undefined => {
  const call = message as { method?: string; params?: { name?: string } } | null;
  return call?.method === 'tools/call' ? call.params?.name : undefined;
};

/** A JSON-RPC message (or batch) that asks for a render or a card's preview, the expensive calls the concurrency cap counts. */
export function isRender(message: unknown): boolean {
  if (Array.isArray(message)) return message.some(isRender);
  const name = toolCalled(message);
  return name === 'render_diagram' || name === 'preview_diagram';
}

/** Only previews: never queued for a slot, because a newer frame of the same drawing is already on its way. */
export function isPreviewOnly(message: unknown): boolean {
  const list = Array.isArray(message) ? message : [message];
  return list.length > 0 && list.every((item) => toolCalled(item) === 'preview_diagram');
}

/** Where the endpoint answers: `/mcp` as documented, and the root and trailing-slash forms people paste into a client. */
export const MCP_PATHS: ReadonlySet<string> = new Set(['/', '/mcp', '/mcp/']);

/**
 * CORS for any origin: the endpoint is stateless and has no login, so a browser-based client or inspector may call it
 * like Claude's servers do (the same as other hosted diagram MCP servers).
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400',
};

/** An Accept header the transport takes: clients that ask only for JSON (or nothing) get JSON, which is what a stateless call returns. */
export const acceptBoth = (accept: string | null | undefined): boolean =>
  !!accept && accept.includes('application/json') && accept.includes('text/event-stream');

export const rpcErrorBody = (message: string) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
