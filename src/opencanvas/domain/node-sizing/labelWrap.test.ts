import { describe, expect, it } from 'vitest';
import { createTestNode } from '../../testing/builders/documentBuilder';
import { resolveNodeStyle } from '../nodes/nodeStyle';
import { resolveLabelSizing } from './labelWrap';
import type { JsonValue } from '../document/json';
import { DEFAULT_NODE_SIZING_POLICY } from './model';

const sizing = (overrides: Parameters<typeof createTestNode>[1]) => {
  const node = createTestNode('n', overrides);
  return resolveLabelSizing(node, resolveNodeStyle(node));
};

describe('resolveLabelSizing', () => {
  it('wraps a drawn box whose label no longer fits one line', () => {
    const policy = sizing({ size: { width: 120, height: 80 }, content: { label: 'Last-second box', shape: 'rectangle' } });
    expect(policy.overflow).toBe('wrap');
  });

  it('leaves a label that fits, a stored policy, a diamond and an icon tile alone', () => {
    expect(sizing({ size: { width: 120, height: 80 }, content: { label: 'Short' } })).toEqual(DEFAULT_NODE_SIZING_POLICY);
    const long = 'A label far too long to fit a small box in one line';
    expect(sizing({ size: { width: 120, height: 80 }, content: { label: long, shape: 'diamond' } }).overflow).toBe('visible');
    expect(sizing({ size: { width: 120, height: 80 }, content: { label: long, icon: 'server' } }).overflow).toBe('visible');
    expect(sizing({ size: { width: 120, height: 80 }, content: { label: long, sizingPolicy: DEFAULT_NODE_SIZING_POLICY as unknown as JsonValue } }).overflow).toBe('visible');
  });

  it('bounds a 1000-character label to the policy line cap', () => {
    const policy = sizing({ size: { width: 120, height: 80 }, content: { label: 'x'.repeat(1000) } });
    expect(policy.overflow).toBe('wrap');
    expect(policy.maxLines).toBe(4);
  });
});
