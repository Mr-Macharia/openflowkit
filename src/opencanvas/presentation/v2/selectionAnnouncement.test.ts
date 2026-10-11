import { describe, expect, it } from 'vitest';
import { createTestConnector, createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { selectionAnnouncement } from './selectionAnnouncement';

// Found 2026-10-11 (U1-12): "1 shapes selected." and "Connector connector-mv2u82ss-6 selected."
describe('selectionAnnouncement', () => {
  const page = createTestDocument({
    nodes: [createTestNode('a', { content: { label: 'Client' } }), createTestNode('b', { content: { label: 'API' } }), createTestNode('c', { content: {} })],
    connectors: [createTestConnector('e1', 'a', 'b'), createTestConnector('e2', 'a', 'c')],
  }).pages[0]!;
  it('pluralises', () => {
    expect(selectionAnnouncement(page, [], [])).toBe('Nothing selected.');
    expect(selectionAnnouncement(page, ['c'], [])).toBe('1 shape selected.');
    expect(selectionAnnouncement(page, ['a', 'b'], ['e1'])).toBe('2 shapes and 1 connector selected.');
    expect(selectionAnnouncement(page, [], ['e1', 'e2'])).toBe('2 connectors selected.');
  });
  it('names one shape by its label and one connector by its ends, never by id', () => {
    expect(selectionAnnouncement(page, ['a'], [])).toBe('Client selected.');
    expect(selectionAnnouncement(page, [], ['e1'])).toBe('Connector Client → API selected.');
    expect(selectionAnnouncement(page, [], ['e2'])).toBe('Connector Client → shape selected.');
  });
});
