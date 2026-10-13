import type { SceneConnector, SceneNode } from '../../domain/document/types';
import { WIDGETS, isWidgetKind } from '../../domain/nodes/widgetNodePresentation';
import { PRODUCTION_NODE_CATALOG } from '../../application/active-document/productionNodeCatalog';
import { CHART_OPTIONS, SHAPE_SECTIONS } from './v2ToolCatalog';

// The names the pickers already use, so an unlabeled shape reads "Diamond" in Layers, not its node kind "Process".
const SHAPE_NAMES = new Map<string, string>(SHAPE_SECTIONS.flatMap((section) => section.options)
  .map((option) => [option.id.replace('tool:', ''), option.label]));
const CHART_NAMES = new Map<string, string>(CHART_OPTIONS.map((option) => [option.id, option.label]));
const KIND_NAMES = new Map<string, string>();
for (const entry of PRODUCTION_NODE_CATALOG) if (!KIND_NAMES.has(entry.kind)) KIND_NAMES.set(entry.kind, entry.label);

/** `er_entity` → "Er entity": the last resort for a kind no picker names. */
function plainWords(kind: string): string {
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Object';
}

/** A node's row name: its label, else what the picker calls it. */
export function layerNodeName(node: SceneNode): string {
  const label = node.content.label;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const { shape, chart, widget } = node.content;
  if (node.kind === 'process') return (typeof shape === 'string' && SHAPE_NAMES.get(shape)) || 'Shape';
  if (node.kind === 'chart' && typeof chart === 'string') return CHART_NAMES.get(chart) ?? 'Chart';
  if (node.kind === 'widget' && isWidgetKind(widget)) return WIDGETS[widget].name;
  return KIND_NAMES.get(node.kind) ?? plainWords(node.kind);
}

/** A connector's row name: its label, else the shapes it joins. */
export function layerConnectorName(connector: SceneConnector, nodeById: ReadonlyMap<string, SceneNode>): string {
  const label = connector.labels[0]?.text?.trim();
  if (label) return label;
  const source = connector.source.nodeId ? nodeById.get(connector.source.nodeId) : undefined;
  const target = connector.target.nodeId ? nodeById.get(connector.target.nodeId) : undefined;
  return source && target ? `${layerNodeName(source)} → ${layerNodeName(target)}` : 'Connection';
}
