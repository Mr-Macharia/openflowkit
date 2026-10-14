import type { AiProviderDefinition } from './providers';
import { asRecord, dataUrl, entryPoints, exchange, parseArgs, turns, type WireReader } from './providerWire';
import type { AiDelta, AiMessage, AiProvider, AiToolCall } from './providerTypes';

export function anthropicMessage(message: AiMessage): unknown {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: message.results.map(({ callId, content, isError }) => ({ type: 'tool_result', tool_use_id: callId, content, ...(isError ? { is_error: true } : {}) })),
    };
  }
  if (message.role === 'assistant') {
    if (!message.toolCalls?.length) return { role: 'assistant', content: message.content };
    return {
      role: 'assistant',
      content: Array.isArray(message.replay) ? message.replay : [
        ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
        ...message.toolCalls.map(({ id, name, input }) => ({ type: 'tool_use', id, name, input })),
      ],
    };
  }
  if (!message.images?.length) return { role: 'user', content: message.content };
  return {
    role: 'user',
    content: [
      ...message.images.map(({ mediaType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })),
      ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
    ],
  };
}

/** Content blocks by index; tool input arrives as JSON fragments, thinking with a signature to replay. */
export function anthropicReader(): WireReader {
  const blocks: Record<string, unknown>[] = [];
  const inputs: string[] = [];
  const read = (block: Record<string, unknown>): AiDelta => (block.type === 'text' ? { text: String(block.text ?? '') }
    : block.type === 'thinking' ? { thinking: String(block.thinking ?? '') } : {});
  return {
    whole: (payload) => {
      const content = asRecord(payload).content;
      if (Array.isArray(content)) blocks.push(...content.map((block) => ({ ...asRecord(block) })));
      return blocks.map(read);
    },
    event: (payload) => {
      const record = asRecord(payload);
      const index = Number(record.index ?? 0);
      if (record.type === 'content_block_start') {
        blocks[index] = { ...asRecord(record.content_block) };
        return [];
      }
      const delta = asRecord(record.delta);
      const block = (blocks[index] ??= {});
      const append = (key: string, value: unknown) => { block[key] = String(block[key] ?? '') + String(value ?? ''); };
      switch (delta.type) {
        case 'text_delta': append('text', delta.text); return [{ text: String(delta.text ?? '') }];
        case 'thinking_delta': append('thinking', delta.thinking); return [{ thinking: String(delta.thinking ?? '') }];
        case 'signature_delta': append('signature', delta.signature); return [];
        case 'input_json_delta': inputs[index] = (inputs[index] ?? '') + String(delta.partial_json ?? ''); return [];
        default: return [];
      }
    },
    finish: () => {
      inputs.forEach((json, index) => { if (blocks[index]) blocks[index]!.input = parseArgs(json); });
      const replay = blocks.filter((block) => block && !(block.type === 'text' && !String(block.text ?? '').trim()));
      const toolCalls = replay.filter(({ type }) => type === 'tool_use')
        .map((block) => ({ id: String(block.id ?? ''), name: String(block.name ?? ''), input: parseArgs(block.input) }));
      return { toolCalls, replay };
    },
  };
}

// ponytail: a regex list of legacy ids that still take budget_tokens — read capabilities from /v1/models instead.
const LEGACY_THINKING = /^claude-(3-|(haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4|sonnet-4)(-\d{8})?$)/;

export function createAnthropicProvider(definition: AiProviderDefinition, baseUrl: string, model: string, apiKey: string): AiProvider {
  const endpoint = `${baseUrl}/v1/messages`;
  return {
    id: definition.id, model, endpoint,
    ...entryPoints((request) => {
      const { system, maxTokens = definition.maxOutputTokens, signal, thinking, tools, onDelta } = request;
      // ponytail: fixed budget, a quarter of the output room; a per-request effort knob if users ask.
      const budget = Math.max(1024, Math.floor(maxTokens / 4));
      return exchange({
        url: endpoint, definition, model, signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model, max_tokens: maxTokens,
          ...(system.trim() ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
          cache_control: { type: 'ephemeral' },
          messages: turns(request).map(anthropicMessage),
          ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })) } : {}),
          ...(thinking && !LEGACY_THINKING.test(model) ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
          ...(thinking && LEGACY_THINKING.test(model) && maxTokens > budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
          ...(onDelta ? { stream: true } : {}),
        },
      }, anthropicReader(), onDelta);
    }, definition),
  };
}

export function openAiMessages(message: AiMessage): unknown[] {
  if (message.role === 'tool') {
    return message.results.map(({ callId, content }) => ({ role: 'tool', tool_call_id: callId, content }));
  }
  if (message.role === 'assistant') {
    if (!message.toolCalls?.length) return [{ role: 'assistant', content: message.content }];
    // DeepSeek-style thinking wants its reasoning back inside a tool loop; others never send the field.
    const reasoning = asRecord(message.replay).reasoning_content;
    return [{
      role: 'assistant', content: message.content || null,
      tool_calls: message.toolCalls.map(({ id, name, input }) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } })),
      ...(typeof reasoning === 'string' && reasoning ? { reasoning_content: reasoning } : {}),
    }];
  }
  if (!message.images?.length) return [{ role: 'user', content: message.content }];
  return [{
    role: 'user',
    content: [
      ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
      ...message.images.map((image) => ({ type: 'image_url', image_url: { url: dataUrl(image) } })),
    ],
  }];
}

/** Tool calls arrive by index, arguments as string fragments. */
export function openAiReader(): WireReader {
  const calls: { id: string; name: string; args: string }[] = [];
  let reasoningContent = '';
  const first = (payload: unknown) => asRecord(Array.isArray(asRecord(payload).choices) ? (asRecord(payload).choices as unknown[])[0] : null);
  // DeepSeek-style servers name it reasoning_content, OpenRouter and Groq reasoning.
  const read = (message: Record<string, unknown>): AiDelta[] => {
    if (typeof message.reasoning_content === 'string') reasoningContent += message.reasoning_content;
    const toolCalls = message.tool_calls;
    if (Array.isArray(toolCalls)) {
      toolCalls.forEach((raw, position) => {
        const call = asRecord(raw);
        const fn = asRecord(call.function);
        const slot = (calls[typeof call.index === 'number' ? call.index : position] ??= { id: '', name: '', args: '' });
        if (call.id) slot.id = String(call.id);
        if (fn.name && !slot.name) slot.name = String(fn.name);
        if (fn.arguments !== undefined) slot.args += typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments);
      });
    }
    return [{ thinking: String(message.reasoning_content ?? message.reasoning ?? ''), text: String(message.content ?? '') }];
  };
  return {
    whole: (payload) => read(asRecord(first(payload).message)),
    event: (payload) => read(asRecord(first(payload).delta)),
    finish: () => ({
      toolCalls: calls.filter(Boolean).map(({ id, name, args }, index) => ({ id: id || `call_${index}`, name, input: parseArgs(args) })),
      replay: reasoningContent ? { reasoning_content: reasoningContent } : null,
    }),
  };
}

export function createOpenAiProvider(definition: AiProviderDefinition, baseUrl: string, model: string, apiKey: string): AiProvider {
  const endpoint = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { ...definition.extraHeaders };
  if (definition.needsKey) headers.authorization = `Bearer ${apiKey}`;
  const maxTokensParam = definition.maxTokensParam ?? 'max_tokens';
  return {
    id: definition.id, model, endpoint,
    ...entryPoints((request) => {
      const { system, maxTokens = definition.maxOutputTokens, signal, tools, onDelta } = request;
      return exchange({
        url: endpoint, definition, model, signal,
        headers,
        body: {
          model, [maxTokensParam]: maxTokens,
          messages: [{ role: 'system', content: system }, ...turns(request).flatMap(openAiMessages)],
          ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) } : {}),
          ...(onDelta ? { stream: true } : {}),
        },
      }, openAiReader(), onDelta);
    }, definition),
  };
}

// Gemini returns no call ids on some models; a minted one is never sent back.
const MINTED = 'gemini-call-';

export function googleContent(message: AiMessage): unknown {
  if (message.role === 'tool') {
    return {
      role: 'user',
      parts: message.results.map(({ callId, name, content, isError }) => ({
        functionResponse: {
          name, response: isError ? { error: content } : { result: content },
          ...(callId.startsWith(MINTED) ? {} : { id: callId }),
        },
      })),
    };
  }
  if (message.role === 'assistant') {
    const parts = message.toolCalls?.length && Array.isArray(message.replay) ? message.replay : [
      ...(message.content ? [{ text: message.content }] : []),
      ...(message.toolCalls ?? []).map(({ name, input }) => ({ functionCall: { name, args: input } })),
    ];
    return { role: 'model', parts };
  }
  const parts = [
    ...(message.images ?? []).map(({ mediaType, data }) => ({ inlineData: { mimeType: mediaType, data } })),
    ...(message.content.trim() || !message.images?.length ? [{ text: message.content }] : []),
  ];
  return { role: 'user', parts };
}

/** Keeps the model's parts for replay: Gemini 3 rejects a function call sent back without its thoughtSignature. */
export function googleReader(): WireReader {
  const parts: Record<string, unknown>[] = [];
  const keep = (part: Record<string, unknown>) => {
    const last = parts[parts.length - 1];
    // Streamed text comes in many parts; plain neighbours merge so the replay stays small.
    const plain = (candidate: Record<string, unknown>) => typeof candidate.text === 'string' && !candidate.thoughtSignature && !candidate.functionCall;
    if (last && plain(last) && plain(part) && Boolean(last.thought) === Boolean(part.thought)) {
      last.text = String(last.text) + String(part.text);
      return;
    }
    parts.push({ ...part });
  };
  const read = (payload: unknown): AiDelta[] => {
    const candidates = asRecord(payload).candidates;
    const raw = Array.isArray(candidates) ? asRecord(asRecord(candidates[0]).content).parts : [];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const part = asRecord(item);
      keep(part);
      if (part.functionCall) return [];
      const text = String(part.text ?? '');
      return [part.thought === true ? { thinking: text } : { text }];
    });
  };
  return {
    whole: read,
    event: read,
    finish: () => ({
      toolCalls: parts.filter(({ functionCall }) => functionCall).map(({ functionCall }, index) => {
        const call = asRecord(functionCall);
        return { id: call.id ? String(call.id) : `${MINTED}${index}`, name: String(call.name ?? ''), input: parseArgs(call.args) };
      }),
      // Thought summaries are for the reader; signatures and calls go back.
      replay: parts.filter((part) => part.thoughtSignature || part.functionCall || (part.thought !== true && String(part.text ?? '').length)),
    }),
  };
}

export function createGoogleProvider(definition: AiProviderDefinition, baseUrl: string, model: string, apiKey: string): AiProvider {
  // ponytail: model ids with slashes are encoded; tuned-model resource names would need the full path — the override field is the escape hatch.
  const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    id: definition.id, model, endpoint,
    ...entryPoints((request) => {
      const { system, maxTokens = definition.maxOutputTokens, signal, thinking, tools, onDelta } = request;
      return exchange({
        url: onDelta ? endpoint.replace(/:generateContent$/, ':streamGenerateContent?alt=sse') : endpoint,
        definition, model, signal,
        headers: { 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: turns(request).map(googleContent),
          ...(tools?.length ? { tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }] } : {}),
          generationConfig: { maxOutputTokens: maxTokens, ...(thinking ? { thinkingConfig: { includeThoughts: true } } : {}) },
        },
      }, googleReader(), onDelta);
    }, definition),
  };
}

/**
 * The context window to ask Ollama for. Its default is 4096 on most machines, and it silently drops
 * the start of a longer prompt (our system prompt, ~3k tokens) to fit — the model then rambles for
 * minutes. Sized to the request, in doubling steps so a growing chat reloads the model rarely; not
 * a fixed 16k, which spills to CPU on an 8 GB Mac.
 */
export function ollamaContext(body: unknown, maxTokens: number): number {
  // ponytail: chars/3 overestimates English tokens (~4 chars each); a tokenizer call if it ever runs short.
  const needed = Math.ceil(JSON.stringify(body).length / 3) + maxTokens;
  return Math.max(8192, 2 ** Math.ceil(Math.log2(needed)));
}

export function ollamaMessages(message: AiMessage): unknown[] {
  if (message.role === 'tool') return message.results.map(({ name, content }) => ({ role: 'tool', tool_name: name, content }));
  if (message.role === 'assistant') {
    return [{
      role: 'assistant', content: message.content,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(({ name, input }) => ({ function: { name, arguments: input } })) } : {}),
    }];
  }
  return [{ role: 'user', content: message.content, ...(message.images?.length ? { images: message.images.map(({ data }) => data) } : {}) }];
}

/** Ollama sends each tool call whole, arguments as an object, with no index to merge on: append. */
export function ollamaReader(): WireReader {
  const calls: AiToolCall[] = [];
  const read = (payload: unknown): AiDelta[] => {
    const message = asRecord(asRecord(payload).message);
    for (const raw of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const fn = asRecord(asRecord(raw).function);
      calls.push({ id: String(asRecord(raw).id ?? '') || `call_${calls.length}`, name: String(fn.name ?? ''), input: parseArgs(fn.arguments) });
    }
    return [{ thinking: String(message.thinking ?? ''), text: String(message.content ?? '') }];
  };
  return { whole: read, event: read, finish: () => ({ toolCalls: calls, replay: null }) };
}

/** A saved base URL may still end in the /v1 of the OpenAI shim; the native API lives at the root. */
export const ollamaRoot = (baseUrl: string): string => baseUrl.replace(/\/v1$/, '');

export function createOllamaProvider(definition: AiProviderDefinition, baseUrl: string, model: string): AiProvider {
  const endpoint = `${ollamaRoot(baseUrl)}/api/chat`;
  return {
    id: definition.id, model, endpoint,
    ...entryPoints((request) => {
      const { system, maxTokens = definition.maxOutputTokens, signal, tools, onDelta } = request;
      const prompt = {
        messages: [{ role: 'system', content: system }, ...turns(request).flatMap(ollamaMessages)],
        ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) } : {}),
      };
      return exchange({
        url: endpoint, definition, model, signal, headers: {},
        body: {
          // No `think`: true makes a model without thinking refuse the call, and false leaves an always-thinking
          // build (qwen3:4b) reasoning anyway, only now inside the reply. The model's default parses it out.
          model, stream: Boolean(onDelta), ...prompt,
          options: { num_ctx: ollamaContext(prompt, maxTokens), num_predict: maxTokens },
        },
      }, ollamaReader(), onDelta);
    }, definition),
  };
}
