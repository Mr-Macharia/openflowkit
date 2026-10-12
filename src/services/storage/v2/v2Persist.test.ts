import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDocument } from '@/opencanvas/testing/builders/documentBuilder';

async function freshRepository() {
  vi.resetModules();
  return (await import('./v2Repository')).createV2Repository(indexedDB);
}

describe('persistent storage request', () => {
  const persist = vi.fn<() => Promise<boolean>>();
  beforeEach(() => { persist.mockReset().mockResolvedValue(true); vi.stubGlobal('navigator', { storage: { persist } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks once, after the first successful save, however many follow', async () => {
    const repository = await freshRepository();
    expect(persist).not.toHaveBeenCalled();
    await repository.saveDocument('doc-persist-1', createTestDocument(), 1, 0);
    await repository.saveDocument('doc-persist-2', createTestDocument(), 1, 0);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not ask for a stale save that wrote nothing', async () => {
    const repository = await freshRepository();
    await repository.saveDocument('doc-persist-3', createTestDocument(), 1, 0);
    persist.mockClear();
    vi.resetModules();
    const again = (await import('./v2Repository')).createV2Repository(indexedDB);
    expect((await again.saveDocument('doc-persist-3', createTestDocument(), 5, 3)).status).toBe('stale');
    expect(persist).not.toHaveBeenCalled();
  });

  it('survives a browser without the API, and a rejected request', async () => {
    vi.stubGlobal('navigator', {});
    await expect((await freshRepository()).saveDocument('doc-persist-4', createTestDocument(), 1, 0)).resolves.toMatchObject({ status: 'saved' });
    persist.mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { storage: { persist } });
    await expect((await freshRepository()).saveDocument('doc-persist-5', createTestDocument(), 1, 0)).resolves.toMatchObject({ status: 'saved' });
  });
});
