import { afterEach, describe, expect, it } from 'vitest';
import { forgetPageId, savePageId, savedPageId } from './v2Document';

afterEach(() => localStorage.clear());

// Found 2026-10-11 (U2-8): a reload reopened Page 1, and the next export took the wrong page.
describe('the page a document was left on', () => {
  it('is remembered per document in this browser', () => {
    expect(savedPageId('doc-a')).toBeNull();
    savePageId('doc-a', 'page-2');
    savePageId('doc-b', 'page-9');
    expect(savedPageId('doc-a')).toBe('page-2');
    expect(savedPageId('doc-b')).toBe('page-9');
  });

  // Review 2026-10-11: one key per document ever opened, kept after delete.
  it('stores nothing for the first page, and nothing survives a delete', () => {
    savePageId('doc-a', 'page-2');
    savePageId('doc-a', null);
    expect(localStorage.getItem('ofk.page:doc-a')).toBeNull();
    savePageId('doc-b', 'page-9');
    forgetPageId('doc-b');
    expect(savedPageId('doc-b')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
