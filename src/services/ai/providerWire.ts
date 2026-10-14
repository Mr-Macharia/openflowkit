import type { AiProviderDefinition } from './providers';
import { classifyStatus, describeCause, originOf, providerDetail, viaServerProxy, type AiFailureCause } from './diagnosis';
import { AiProviderError, type AiCompletionRequest, type AiDelta, type AiImage, type AiMessage, type AiToolCall, type AiTurn } from './providerTypes';

export const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export const pageOrigin = (): string | undefined =>
  typeof location === 'undefined' ? undefined : location.origin;

export const isOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A rejected cross-origin POST is almost always CORS or CSP, and the console
 * shows the same TypeError for both. A CSP block also fires
 * securitypolicyviolation, which the provider's CORS policy never does — that
 * event is the discriminator.
 */
export function watchCspViolations(): { blocked: (url: string) => string | null; stop: () => void } {
  if (typeof document === 'undefined') return { blocked: () => null, stop: () => undefined };
  const violations: string[] = [];
  const record = (event: Event) => {
    const details = event as Partial<SecurityPolicyViolationEvent>;
    if (!String(details.effectiveDirective ?? '').startsWith('connect-src')) return;
    const blocked = String(details.blockedURI ?? '');
    if (blocked) violations.push(blocked);
  };
  document.addEventListener('securitypolicyviolation', record);
  return {
    blocked: (url) => violations.find((blockedUri) => originOf(blockedUri) === originOf(url)) ?? null,
    stop: () => document.removeEventListener('securitypolicyviolation', record),
  };
}

/**
 * CORS and a closed port throw the same TypeError. An opaque no-cors GET needs
 * no CORS headers, so it resolves whenever something listens at the origin.
 */
export async function probe(url: string): Promise<boolean> {
  try {
    await fetch(originOf(url), { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

export interface WireCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly definition: AiProviderDefinition;
  readonly model: string;
  readonly signal?: AbortSignal;
}

export async function send({ url, headers, body, definition, model, signal }: WireCall): Promise<Response> {
  const csp = watchCspViolations();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') { csp.stop(); throw error; }
    // The violation report is queued as a task, so give it one before reading.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const blockedOrigin = csp.blocked(url);
    csp.stop();
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    const cause: AiFailureCause = blockedOrigin ? 'blocked-by-browser'
      : timedOut ? 'provider-down'
        : isOffline() ? 'offline'
          : 'blocked-by-browser';
    const reachable = cause === 'blocked-by-browser' && !blockedOrigin ? await probe(url) : undefined;
    throw new AiProviderError(describeCause(cause, {
      definition, endpoint: url, model, status: null,
      ...(blockedOrigin ? { blockedOrigin } : {}),
      ...(reachable === undefined ? {} : { reachable }),
      ...(timedOut ? { timedOut: true } : {}),
      ...(pageOrigin() ? { pageOrigin: pageOrigin()! } : {}),
    }), { cause, ...(blockedOrigin ? { origin: blockedOrigin } : {}) });
  }
  csp.stop();
  if (!response.ok) throw failure({ url, headers, body, definition, model }, response.status, await response.text());
  // A host without the AI proxy answers its path with the app's own page.
  if (viaServerProxy(url) && response.headers.get('content-type')?.includes('text/html')) {
    throw new AiProviderError(describeCause('bad-response', { definition, endpoint: url, model, status: 200 }), { cause: 'bad-response', status: 200 });
  }
  return response;
}

/** The provider's own error, classified, with its sentence quoted and the key redacted. */
export function failure({ url, headers, definition, model }: WireCall, status: number, bodyText: string): AiProviderError {
  const cause = classifyStatus(status, bodyText);
  // The key travels in one of these three headers; redact it whatever its length.
  const keys = [headers['x-api-key'], headers['x-goog-api-key'], headers.authorization?.replace(/^Bearer\s+/i, '')];
  const detail = providerDetail(bodyText, keys.filter((key): key is string => !!key));
  return new AiProviderError(describeCause(cause, {
    definition, endpoint: url, model, status,
    ...(pageOrigin() ? { pageOrigin: pageOrigin()! } : {}),
  }) + (detail ? ` ${definition.label} said: “${detail}”` : ''), { cause, status });
}

// Anthropic names a mid-stream error by type, not status.
export const ERROR_STATUS: Readonly<Record<string, number>> = {
  invalid_request_error: 400, authentication_error: 401, permission_error: 403, not_found_error: 404,
  request_too_large: 413, rate_limit_error: 429, api_error: 500, overloaded_error: 529,
};

/** An error sent inside a 200 stream (all three wires put it under `error`); null when the payload is data. */
export function streamFailure(call: WireCall, payload: unknown): AiProviderError | null {
  const error = asRecord(payload).error;
  if (!error) return null;
  const record = asRecord(error);
  const status = Number(record.code) || ERROR_STATUS[String(record.type ?? '')] || 500;
  return failure(call, status, JSON.stringify(payload));
}

/** True when this payload says the reply stopped at the output budget (Anthropic, OpenAI, Gemini, Ollama spellings). */
export function cutOff(payload: unknown): boolean {
  const record = asRecord(payload);
  const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : Array.isArray(record.candidates) ? record.candidates[0] : null);
  return record.stop_reason === 'max_tokens' || asRecord(record.delta).stop_reason === 'max_tokens'
    || choice.finish_reason === 'length' || choice.finishReason === 'MAX_TOKENS' || record.done_reason === 'length';
}

export function parseJson(text: string, call: WireCall, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError(describeCause('bad-response', { definition: call.definition, endpoint: call.url, model: call.model, status }), { cause: 'bad-response', status });
  }
}

/**
 * One wire's reading of a reply: `whole` takes a JSON body, `event` one SSE
 * payload; both return the deltas they found and keep what `finish` needs to
 * report tool calls. A streamed request that comes back as plain JSON
 * (proxies, stubs) is read whole. One reader per request: it holds state.
 */
export interface WireReader {
  readonly whole: (payload: unknown) => AiDelta[];
  readonly event: (payload: unknown) => AiDelta[];
  readonly finish: () => { readonly toolCalls: AiToolCall[]; readonly replay: unknown };
}

// ponytail: one fixed idle limit; thinking streams summaries and pings well inside it. Per-model if one goes quieter.
export const STALL_MS = 120_000;

/** A streamed reply that goes quiet this long is dead, not thinking; only Stop ended it before. */
export async function exchange(call: WireCall, reader: WireReader, onDelta?: (delta: AiDelta) => void): Promise<AiTurn> {
  // A local model sends nothing while it loads and reads a long prompt, which can take minutes on a laptop.
  if (!onDelta || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(call.url)) return read(call, reader, onDelta);
  const stall = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), STALL_MS); };
  alive();
  try {
    return await read({ ...call, signal: call.signal ? AbortSignal.any([call.signal, stall.signal]) : stall.signal }, reader, onDelta, alive);
  } catch (error) {
    if (!stall.signal.aborted || call.signal?.aborted) throw error;
    throw new AiProviderError(`${call.definition.label} went quiet for ${STALL_MS / 60_000} minutes mid-reply. Try again.`, { cause: 'provider-down' });
  } finally {
    clearTimeout(timer);
  }
}

export async function read(call: WireCall, reader: WireReader, onDelta?: (delta: AiDelta) => void, alive = () => undefined): Promise<AiTurn> {
  const response = await send(call);
  alive();
  let text = '';
  let truncated = false;
  const take = (payload: unknown, whole: boolean): AiDelta[] => {
    const error = streamFailure(call, payload);
    if (error) throw error;
    if (cutOff(payload)) truncated = true;
    return whole ? reader.whole(payload) : reader.event(payload);
  };
  // A reply cut at the budget is half a diagram or a tool call with broken arguments; never pass it on as whole.
  const result = (): AiTurn => {
    if (truncated) {
      throw new AiProviderError(`${call.definition.label} reached its output limit before finishing. Ask for less at once — a smaller diagram, or one part at a time.`, { cause: 'too-long' });
    }
    return { text, ...reader.finish() };
  };
  const emit = (deltas: AiDelta[]) => {
    for (const delta of deltas) {
      if (!delta.text && !delta.thinking) continue;
      text += delta.text ?? '';
      onDelta?.(delta);
    }
  };
  const streamed = onDelta && response.body && /text\/event-stream|ndjson/.test(response.headers?.get('content-type') ?? '');
  if (!streamed) {
    emit(take(parseJson(await response.text(), call, response.status), true));
    return result();
  }
  const stream = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const drain = (final: boolean) => {
    const lines = buffer.split(/\r?\n/);
    buffer = final ? '' : lines.pop() ?? '';
    for (const line of lines) {
      // SSE carries each payload on a data: line; Ollama's NDJSON is one bare object per line.
      const data = line.startsWith('data:') ? line.slice(5).trim() : line.trim().startsWith('{') ? line.trim() : '';
      if (!data || data === '[DONE]') continue;
      emit(take(parseJson(data, call, response.status), false));
    }
  };
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await stream.read();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new AiProviderError(`The connection to ${call.definition.label} dropped mid-reply. Try again.`, { cause: isOffline() ? 'offline' : 'provider-down' });
    }
    if (chunk.done) break;
    alive();
    buffer += decoder.decode(chunk.value, { stream: true });
    drain(false);
  }
  buffer += decoder.decode();
  drain(true);
  return result();
}

/** A tool call's arguments; unparseable JSON reads as none, and the tool's own validation says what is missing. */
export function parseArgs(json: unknown): Record<string, unknown> {
  if (json && typeof json === 'object') return json as Record<string, unknown>;
  try { return asRecord(JSON.parse(String(json ?? '') || '{}')); } catch { return {}; }
}

/** Both provider entry points over one wire: `respond` for tool loops, `complete` for text. */
export function entryPoints(respond: (request: AiCompletionRequest) => Promise<AiTurn>, definition: AiProviderDefinition) {
  return {
    async respond(request: AiCompletionRequest) {
      const turn = await respond(request);
      if (!turn.toolCalls.length) requireText(turn.text, definition);
      return turn;
    },
    async complete(request: AiCompletionRequest) {
      return requireText((await respond(request)).text, definition);
    },
  };
}

/** `prompt` is shorthand for one user turn. */
export const turns = ({ messages, prompt }: AiCompletionRequest): readonly AiMessage[] =>
  messages ?? [{ role: 'user', content: prompt ?? '' }];

export const dataUrl = ({ mediaType, data }: AiImage): string => `data:${mediaType};base64,${data}`;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function requireText(text: string, definition: AiProviderDefinition): string {
  if (text.trim()) return text;
  throw new AiProviderError(
    definition.wire === 'google'
      ? 'Gemini returned no text — it may have blocked the prompt. Rephrase it, or choose another model.'
      : 'The provider returned no text. Try again, or choose another model.',
    { cause: 'bad-response' },
  );
}
