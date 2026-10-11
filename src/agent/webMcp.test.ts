import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelContextOf, registerWebMcpTools, type ModelContext, type WebMcpTool } from './webMcp';

const tool = (name: string): WebMcpTool => ({ name, description: name, inputSchema: { type: 'object' }, execute: async () => null });

/** A spec-shaped model context: registerTool(tool, { signal }), duplicate names rejected, abort unregisters. */
function stubContext() {
  const registered = new Map<string, WebMcpTool>();
  const context: ModelContext = {
    registerTool: vi.fn(async (entry: WebMcpTool, options?: { signal?: AbortSignal }) => {
      if (registered.has(entry.name)) throw new DOMException(`"${entry.name}" is registered`, 'InvalidStateError');
      registered.set(entry.name, entry);
      options?.signal?.addEventListener('abort', () => registered.delete(entry.name));
    }),
  };
  return { context, registered };
}

describe('modelContextOf', () => {
  const context = stubContext().context;
  it('prefers document.modelContext, falls back to navigator, else null', () => {
    expect(modelContextOf({ document: { modelContext: context }, navigator: {} })).toBe(context);
    expect(modelContextOf({ document: {}, navigator: { modelContext: context } })).toBe(context);
    expect(modelContextOf({ document: {}, navigator: {} })).toBeNull();
    expect(modelContextOf({ document: { modelContext: {} } })).toBeNull();
  });
});

describe('registerWebMcpTools', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers each tool with the signal, and aborting it unregisters them all', async () => {
    const { context, registered } = stubContext();
    const controller = new AbortController();
    await expect(registerWebMcpTools(context, [tool('a'), tool('b')], controller.signal)).resolves.toEqual(['a', 'b']);
    expect(context.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'a' }), { signal: controller.signal });
    expect([...registered.keys()]).toEqual(['a', 'b']);
    controller.abort();
    expect(registered.size).toBe(0);
  });

  it('a name another script took is skipped with a warning; the rest still register', async () => {
    const { context } = stubContext();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await registerWebMcpTools(context, [tool('a')], new AbortController().signal);
    await expect(registerWebMcpTools(context, [tool('a'), tool('b')], new AbortController().signal)).resolves.toEqual(['b']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an abort that lands while a tool is still registering still unregisters it', async () => {
    const unregisterTool = vi.fn();
    let finish = (): void => undefined;
    const context: ModelContext = { registerTool: () => new Promise<void>((resolve) => { finish = resolve; }), unregisterTool };
    const controller = new AbortController();
    const done = registerWebMcpTools(context, [tool('a')], controller.signal);
    controller.abort();
    finish();
    await done;
    expect(unregisterTool).toHaveBeenCalledWith('a');
  });

  it('an older build without the signal option is told by name', async () => {
    const unregisterTool = vi.fn();
    const context: ModelContext = { registerTool: () => undefined, unregisterTool };
    const controller = new AbortController();
    await registerWebMcpTools(context, [tool('a')], controller.signal);
    controller.abort();
    expect(unregisterTool).toHaveBeenCalledWith('a');
  });
});
