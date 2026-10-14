// BYOK provider clients. Four wire formats cover all ten catalogue entries
// (providers.ts): Anthropic messages, OpenAI chat completions, Google
// generateContent, Ollama chat. Provider differences are read from the catalogue, not
// branched on here. Keys never leave this module's request headers: nothing is
// logged, stored or echoed — including provider error bodies, which can quote
// a key back at us.
import { providerById } from './providers';
import { AiProviderError, type AiProvider, type AiProviderConfig } from './providerTypes';
import { asRecord, trimSlash } from './providerWire';
import { createAnthropicProvider, createGoogleProvider, createOllamaProvider, createOpenAiProvider, ollamaRoot } from './providerWires';

// The types, the wire transport and the four wire clients live beside this file; this module is the public surface.
export { AiProviderError, type AiMessage, type AiProvider, type AiTool, type AiToolCall, type AiTurn } from './providerTypes';
export { STALL_MS } from './providerWire';
export { ollamaContext } from './providerWires';

/**
 * Why a key cannot be sent, or null. Keys are printable ASCII; a pasted arrow, zero-width space
 * or line break makes fetch throw before any request, which would otherwise read as CORS.
 */
export function keyProblem(key: string): string | null {
  return /^[\x21-\x7e]*$/.test(key.trim()) ? null
    : 'The key has a hidden or unusual character (a space, line break or symbol). Copy it again straight from the console.';
}

export function createProvider(config: AiProviderConfig): AiProvider {
  const definition = providerById(config.provider);
  const baseUrl = trimSlash(config.baseUrl?.trim() || definition.defaultBaseUrl);
  const model = config.model?.trim() || definition.defaultModel;
  const apiKey = config.apiKey.trim();
  if (definition.needsKey && !apiKey) {
    throw new AiProviderError('Add an API key in the provider settings.', { cause: 'not-configured' });
  }
  const problem = keyProblem(apiKey);
  if (problem) throw new AiProviderError(problem, { cause: 'bad-key' });
  if (!baseUrl) throw new AiProviderError('Add the endpoint URL for this provider.', { cause: 'not-configured' });
  if (!model) throw new AiProviderError('Add a model id for this provider.', { cause: 'not-configured' });

  if (definition.wire === 'anthropic') return createAnthropicProvider(definition, baseUrl, model, apiKey);
  if (definition.wire === 'google') return createGoogleProvider(definition, baseUrl, model, apiKey);
  if (definition.wire === 'ollama') return createOllamaProvider(definition, baseUrl, model);
  return createOpenAiProvider(definition, baseUrl, model, apiKey);
}

// Ids an OpenAI-wire `/models` lists that cannot answer a chat call.
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|transcri|rerank|realtime|audio/i;

/**
 * The provider's own model ids, chat-capable only: a GET with the chat call's
 * headers. Rejects on anything else (CORS, offline, 401, closed port); callers
 * fall back to `suggestedModels` and never block typing on it.
 */
export async function listModels(config: Omit<AiProviderConfig, 'model'>, signal?: AbortSignal): Promise<string[]> {
  const definition = providerById(config.provider);
  const baseUrl = trimSlash(config.baseUrl?.trim() || definition.defaultBaseUrl);
  const apiKey = config.apiKey.trim();
  if (!baseUrl) throw new Error('No endpoint to ask.');
  const [url, headers]: [string, Record<string, string>] = definition.wire === 'anthropic'
    ? [`${baseUrl}/v1/models?limit=1000`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }]
    : definition.wire === 'google'
      ? [`${baseUrl}/v1beta/models?pageSize=1000`, { 'x-goog-api-key': apiKey }]
      : definition.wire === 'ollama'
        ? [`${ollamaRoot(baseUrl)}/api/tags`, {}]
      : [`${baseUrl}/models`, { ...definition.extraHeaders, ...(definition.needsKey ? { authorization: `Bearer ${apiKey}` } : {}) }];
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`The model list answered ${response.status}.`);
  const payload = asRecord(await response.json());
  if (definition.wire === 'ollama') {
    return (Array.isArray(payload.models) ? payload.models : []).map((model) => String(asRecord(model).name ?? '')).filter((id) => id && !NOT_CHAT.test(id));
  }
  if (definition.wire === 'google') {
    return (Array.isArray(payload.models) ? payload.models : []).map(asRecord)
      .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => String(model.name ?? '').replace(/^models\//, '')).filter(Boolean);
  }
  return (Array.isArray(payload.data) ? payload.data : []).map((model) => String(asRecord(model).id ?? ''))
    .filter((id) => id && !NOT_CHAT.test(id));
}
