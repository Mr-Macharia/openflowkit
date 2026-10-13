// The request rules every remote endpoint applies, Node (`http.ts`) or Cloudflare (`fetchHandler.ts`).
export const MAX_BODY_BYTES = 512 * 1024;
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/** The hostname of a Host header, without the port; null when it is missing or malformed. */
export function hostname(header: string | null | undefined): string | null {
  if (!header) return null;
  try { return new URL(`http://${header}`).hostname; } catch { return null; }
}

/** A JSON-RPC message (or batch) that asks for a render, the expensive call the concurrency cap counts. */
export function isRender(message: unknown): boolean {
  if (Array.isArray(message)) return message.some(isRender);
  const call = message as { method?: string; params?: { name?: string } } | null;
  return call?.method === 'tools/call' && call.params?.name === 'render_diagram';
}

export const rpcErrorBody = (message: string) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
