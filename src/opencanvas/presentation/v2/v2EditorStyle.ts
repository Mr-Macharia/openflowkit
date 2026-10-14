import type { SceneNode, ScenePage } from '../../domain/document/types';
import { resolveNodeStyle, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { resolveWidgetInks, widgetBackdrop, widgetLabelBox } from '../../domain/nodes/widgetNodePresentation';

/** The label editor's type: a widget's label is drawn in its own ink (white in a tooltip), not the node's text colour. */
export function editorStyle(node: SceneNode, page: ScenePage, canvasColor: string): NodeStyle {
  const style = resolveNodeStyle(node, canvasColor);
  const box = widgetLabelBox(node);
  if (!box) return style;
  const parentOf = (id: string) => page.nodes.find((candidate) => candidate.id === id);
  return { ...style, textColor: resolveWidgetInks(node, style, widgetBackdrop(node, parentOf, canvasColor))[box.ink].color };
}
