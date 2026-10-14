import { RETRYABLE, type AiFailureCause } from './diagnosis';
import type { AiProviderId } from './providers';

export interface AiProviderConfig {
  readonly provider: AiProviderId;
  readonly apiKey: string;
  /** Base URL override; the provider default applies when absent. */
  readonly baseUrl?: string;
  readonly model?: string;
}

/** An attached image, base64 without the `data:` prefix. */
export interface AiImage {
  readonly mediaType: string;
  readonly data: string;
}

/** A function the model may call; `parameters` is a JSON Schema object. */
export interface AiTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface AiToolResult {
  readonly callId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
}

export type AiMessage =
  | { readonly role: 'user'; readonly content: string; readonly images?: readonly AiImage[] }
  /** `replay` is the wire's own copy of the turn (thinking signatures, Gemini thought signatures); sent back as-is. */
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly AiToolCall[]; readonly replay?: unknown }
  | { readonly role: 'tool'; readonly results: readonly AiToolResult[] };

/** A streamed piece of the reply: answer text, or the model's visible reasoning. */
export interface AiDelta {
  readonly text?: string;
  readonly thinking?: string;
}

/** One model turn: its text, the tools it called, and what to replay next round. */
export interface AiTurn {
  readonly text: string;
  readonly toolCalls: readonly AiToolCall[];
  readonly replay: unknown;
}

export interface AiCompletionRequest {
  readonly system: string;
  /** One user turn; `messages` wins when both are given. */
  readonly prompt?: string;
  readonly messages?: readonly AiMessage[];
  /** Output budget; the provider's `maxOutputTokens` when absent. */
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  /**
   * Ask for reasoning: Claude gets a thinking budget, Gemini includes its
   * thoughts. OpenAI-wire providers stream reasoning when the model shares it.
   */
  readonly thinking?: boolean;
  /** Functions the model may call; `respond` reports the calls. */
  readonly tools?: readonly AiTool[];
  /** Streams the reply when set; `complete` still resolves to the whole text. */
  readonly onDelta?: (delta: AiDelta) => void;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  readonly endpoint: string;
  /** The reply's text; fails when there is none. */
  complete(request: AiCompletionRequest): Promise<string>;
  /** The reply's text and tool calls; empty text is fine when tools were called. */
  respond(request: AiCompletionRequest): Promise<AiTurn>;
}

export class AiProviderError extends Error {
  /** Why it failed; drives `retryable` and the sentence the user reads. */
  readonly cause: AiFailureCause;
  readonly status: number | null;
  readonly retryable: boolean;
  /** The origin a CSP or CORS failure names, when known. */
  readonly origin?: string;

  constructor(message: string, details: { readonly cause: AiFailureCause; readonly status?: number | null; readonly origin?: string }) {
    super(message);
    this.name = 'AiProviderError';
    this.cause = details.cause;
    this.status = details.status ?? null;
    this.retryable = RETRYABLE[details.cause];
    if (details.origin) this.origin = details.origin;
  }
}
