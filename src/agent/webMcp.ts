// WebMCP (https://webmachinelearning.github.io/webmcp/): the page hands its tools to an agent that lives in the
// browser. This file is the small part the editor loads up front: find the browser's model context and register
// tools on it. The tools themselves (and the op registry they need) live in ./webMcpTools, loaded only when a
// model context exists.

export interface WebMcpToolAnnotations {
  /** The tool changes nothing the person keeps (reads, or moves only the view). */
  readonly readOnlyHint?: boolean;
  /** The result carries text the agent should not take as instructions (the person's document). */
  readonly untrustedContentHint?: boolean;
}

export interface WebMcpTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly execute: (input: Record<string, unknown>, options?: { readonly signal?: AbortSignal }) => Promise<unknown>;
  readonly annotations?: WebMcpToolAnnotations;
}

export interface ModelContext {
  registerTool(tool: WebMcpTool, options?: { readonly signal?: AbortSignal }): Promise<void> | void;
  /** Builds before the AbortSignal option unregistered by name. */
  unregisterTool?(name: string): void;
}

/** `document.modelContext` (the spec), else `navigator.modelContext` (older Chrome builds); null when the browser has neither. */
export function modelContextOf(scope: { document?: unknown; navigator?: unknown } = globalThis): ModelContext | null {
  const found = (scope.document as { modelContext?: ModelContext } | undefined)?.modelContext
    ?? (scope.navigator as { modelContext?: ModelContext } | undefined)?.modelContext;
  return found && typeof found.registerTool === 'function' ? found : null;
}

/**
 * Registers every tool until `signal` aborts. A tool the context refuses (a name some other script took) is
 * skipped with a warning, not fatal for the rest. Resolves to the names that registered.
 */
export async function registerWebMcpTools(context: ModelContext, tools: readonly WebMcpTool[], signal: AbortSignal): Promise<string[]> {
  const settled = await Promise.allSettled(tools.map(async (tool) => {
    await context.registerTool(tool, { signal });
    // A build that ignores the signal is told by name (now, if the abort came while this tool was registering);
    // one that honoured it has already dropped the tool. Only a tool that registered is ever unregistered.
    const unregister = () => { try { context.unregisterTool?.(tool.name); } catch { /* already gone */ } };
    if (context.unregisterTool) {
      if (signal.aborted) unregister();
      else signal.addEventListener('abort', unregister, { once: true });
    }
    return tool.name;
  }));
  const names: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') names.push(result.value);
    else if (!signal.aborted) console.warn(`WebMCP did not register "${tools[index]!.name}":`, result.reason);
  });
  return names;
}
