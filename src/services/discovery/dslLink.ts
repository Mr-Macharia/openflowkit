/** `#/from/dsl?d=<payload>`: payload = base64url (no padding) of deflate-raw(utf8 DSL). */
export const MAX_DSL_BYTES = 1024 * 1024;
/** Chat apps and browsers cut long URLs; the MCP server's open link keeps the same cap. */
export const MAX_LINK_PAYLOAD = 32 * 1024;

/**
 * The editable-copy link for this code, or null when it is too long to survive being pasted. `title` rides as `t`:
 * a link without it (the MCP viewer's, every older one) still opens, titled by the app.
 */
export async function dslLink(dsl: string, appHref: string, title?: string): Promise<string | null> {
  const payload = await encodeDslPayload(dsl);
  const name = title?.trim() ? `&t=${encodeURIComponent(title.trim())}` : '';
  return payload.length > MAX_LINK_PAYLOAD ? null : `${appHref.split('#')[0]}#/from/dsl?d=${payload}${name}`;
}

export async function encodeDslPayload(dsl: string): Promise<string> {
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(dsl)); controller.close(); } });
  const reader = source.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  let binary = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const byte of value) binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeDslPayload(payload: string | null): Promise<string> {
  if (!payload) throw new Error('The link has no diagram in it (missing payload).');
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('The link is damaged (not valid base64url).');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0)); }
  catch { throw new Error('The link is damaged (not valid base64url).'); }
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DSL_BYTES) { await reader.cancel(); throw new RangeError('The diagram in this link is too large (over 1 MB).'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new Error('The link is damaged (the diagram is not validly compressed).');
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}
