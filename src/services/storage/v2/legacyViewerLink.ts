// v1's `#/view?flow=` carries v1 DSL: `~` + base64url(zlib deflate), or older plain base64
// (main `viewerUrlCodec.ts`). v2 can't parse that DSL — the parser went in phase 0 — so the
// explainer page shows it as text. zlib is what `DecompressionStream('deflate')` reads.
import { MAX_DSL_BYTES } from '../../discovery/dslLink';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function decodeLegacyViewerParam(encoded: string): Promise<string> {
  // URLSearchParams turns a plain-base64 `+` into a space; put it back.
  if (!encoded.startsWith('~')) return decodeURIComponent(atob(encoded.replace(/ /g, '+')));
  // Capped like decodeDslPayload: a few KB of link must not inflate to hundreds of MB.
  const reader = new Response(fromBase64Url(encoded.slice(1))).body!.pipeThrough(new DecompressionStream('deflate')).getReader();
  const bytes = new Uint8Array(MAX_DSL_BYTES);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > MAX_DSL_BYTES) { await reader.cancel(); throw new RangeError('The diagram in this link is too large (over 1 MB).'); }
    bytes.set(value, size);
    size += value.length;
  }
  return new TextDecoder().decode(bytes.subarray(0, size));
}
