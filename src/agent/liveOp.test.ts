import { describe, expect, it, vi } from 'vitest';
import { createTestDocument, createTestNode } from '../opencanvas/testing/builders/documentBuilder';
import { READ_ONLY_REFUSAL, runLiveAgentOp, type LiveAgentSession } from './liveOp';
import { createTestCapabilities } from './ops/testHost';

const session = (overrides: Partial<LiveAgentSession> = {}): LiveAgentSession => ({
  document: createTestDocument({ nodes: [createTestNode('a')] }), pageId: 'page-1', capabilities: createTestCapabilities(),
  commit: vi.fn(), selectedIds: () => ['a'], ...overrides,
});

// The one runner behind the MCP bridge and WebMCP.
describe('runLiveAgentOp', () => {
  it('an edit commits one command and reveals what it touched on the page in view', async () => {
    const commit = vi.fn();
    const onApplied = vi.fn();
    const { command, output } = await runLiveAgentOp(() => session({ commit, onApplied }), 'add_shape', { kind: 'rectangle', id: 'n1' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(command);
    expect(command?.label).toBe('Create rectangle');
    expect(output).toEqual({ id: 'n1' });
    expect(onApplied).toHaveBeenCalledWith(['n1']);
  });

  it('a read commits nothing and sees the selection', async () => {
    const commit = vi.fn();
    const { command, output } = await runLiveAgentOp(() => session({ commit }), 'get_document', {});
    expect(command).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(output).toMatchObject({ selection: ['a'] });
  });

  it('a read-only document, or its locked page, refuses an edit and commits nothing', async () => {
    const commit = vi.fn();
    await expect(runLiveAgentOp(() => session({ commit, readOnly: true }), 'delete', { ids: ['a'] })).rejects.toThrow(READ_ONLY_REFUSAL);
    await expect(runLiveAgentOp(() => session({ commit, lockedPageId: 'page-1' }), 'delete', { ids: ['a'] })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(commit).not.toHaveBeenCalled();
    await expect(runLiveAgentOp(() => session({ readOnly: true }), 'list_pages', {})).resolves.toMatchObject({ command: null });
  });

  it('reads the lock again once the op has resolved, before it commits', async () => {
    const commit = vi.fn();
    let readOnly = false;
    const base = session({ commit, capabilities: { ...createTestCapabilities(), compileWorkspace: async (...args) => {
      readOnly = true; // the document turned read-only while the diagram compiled
      return createTestCapabilities().compileWorkspace(...args);
    } } });
    await expect(runLiveAgentOp(() => ({ ...base, readOnly }), 'create_diagram', { dsl: 'flowchart\n  A -> B' })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(commit).not.toHaveBeenCalled();
  });

  it('an edit the session refuses is reported, not taken for applied', async () => {
    const onApplied = vi.fn();
    await expect(runLiveAgentOp(() => session({ commit: () => false, onApplied }), 'delete', { ids: ['a'] })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('a cancelled call stops before it commits, with the reason', async () => {
    const commit = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error('The editor closed this document.'));
    await expect(runLiveAgentOp(() => session({ commit }), 'delete', { ids: ['a'] }, undefined, controller.signal)).rejects.toThrow('The editor closed this document.');
    expect(commit).not.toHaveBeenCalled();
  });

  it('names an unknown op and a missing document', async () => {
    await expect(runLiveAgentOp(() => session(), 'nope', {})).rejects.toThrow('Unknown op "nope".');
    await expect(runLiveAgentOp(() => session({ document: null }), 'list_pages', {})).rejects.toThrow('The editor has no document open.');
  });
});
