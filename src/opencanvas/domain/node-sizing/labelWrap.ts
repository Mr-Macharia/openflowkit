import type { SceneNode } from '../document/types';
import { resolveBasicNodePresentation } from '../nodes/basicNodePresentation';
import { nodeLabelBounds } from '../nodes/nodeLabelBounds';
import type { NodeStyle } from '../nodes/nodeStyle';
import { measurePortableText, SUBLABEL_FONT } from '../text/measurement';
import { DEFAULT_NODE_SIZING_POLICY, resolveNodeSizingPolicy } from './model';
import type { NodeSizingPolicyV1 } from './types';

const WRAP_POLICY: NodeSizingPolicyV1 = { ...DEFAULT_NODE_SIZING_POLICY, overflow: 'wrap' };

/**
 * The sizing policy a basic shape's label is drawn by, on canvas and in export alike. A node that carries
 * a policy keeps it. A policy-free shape whose box is a plain rectangle of text (no icon, no inset
 * silhouette) wraps its label as soon as one line no longer fits, the rule the DSL applies at creation, so
 * a box a person draws and types into behaves like one the DSL made. Text that fits stays policy-free.
 */
export function resolveLabelSizing(node: SceneNode, style: NodeStyle): NodeSizingPolicyV1 {
  const policy = resolveNodeSizingPolicy(node);
  if (node.content.sizingPolicy !== undefined || !resolveBasicNodePresentation(node)) return policy;
  if (typeof node.content.icon === 'string' && node.content.icon !== 'none') return policy;
  if (typeof node.content.archIconShapeId === 'string') return policy;
  // Diamonds, circles and the like keep one line: their label area is narrower than the box.
  const box = nodeLabelBounds(node);
  if (box.x !== 0 || box.y !== 0 || box.width !== node.size.width || box.height !== node.size.height) return policy;
  const inner = Math.max(1, node.size.width - style.textPadding * 2);
  const label = typeof node.content.label === 'string' ? node.content.label : node.id;
  const wide = (text: string, font: { readonly fontSize: number; readonly fontWeight: 400 | 500 | 600 | 700 }) =>
    measurePortableText(text, { ...font, overflow: 'visible' }).width > inner;
  const subLabel = typeof node.content.subLabel === 'string' ? node.content.subLabel : '';
  const tooWide = label.split('\n').some((line) => wide(line, style))
    || subLabel.split('\n').some((line) => wide(line, SUBLABEL_FONT));
  return tooWide ? WRAP_POLICY : policy;
}
