import { describe, expect, it } from 'vitest';
import { createTestConnector, createTestNode } from '../../testing/builders/documentBuilder';
import { layerConnectorName, layerNodeName } from './v2LayerNames';

const blank = (kind: string, content: Record<string, string> = {}) => createTestNode(kind, { kind, content: { label: '', ...content } });

describe('layerNodeName', () => {
  it('uses the label, else the name the pickers use, never a raw kind', () => {
    expect(layerNodeName(createTestNode('a', { content: { label: '  Checkout  ' } }))).toBe('Checkout');
    expect(layerNodeName(blank('process', { shape: 'diamond' }))).toBe('Diamond');
    expect(layerNodeName(blank('process', { shape: 'rectangle' }))).toBe('Rectangle');
    expect(layerNodeName(blank('process'))).toBe('Shape');
    expect(layerNodeName(blank('er_entity'))).toBe('ER entity');
    expect(layerNodeName(blank('sequence_participant'))).toBe('Participant');
    expect(layerNodeName(blank('chart', { chart: 'pie' }))).toBe('Pie chart');
    expect(layerNodeName(blank('widget', { widget: 'navbar' }))).toBe('Navigation bar');
    expect(layerNodeName(blank('some_new-kind'))).toBe('Some new kind');
  });
});

describe('layerConnectorName', () => {
  it('names an unlabeled connection by the shapes it joins', () => {
    const nodes = new Map([['a', createTestNode('a', { content: { label: 'Cart' } })], ['b', blank('process', { shape: 'diamond' })]]);
    expect(layerConnectorName(createTestConnector('c', 'a', 'b'), nodes)).toBe('Cart → Diamond');
    expect(layerConnectorName({ ...createTestConnector('c', 'a', 'b'), labels: [{ text: 'pays' } as never] }, nodes)).toBe('pays');
    expect(layerConnectorName(createTestConnector('c', 'a', 'gone'), nodes)).toBe('Connection');
  });
});
