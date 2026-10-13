import type { ScenePage } from '../../domain/document/types';

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What the selection live region says: counts that agree in number, one shape by its label, one connector by its ends. */
export function selectionAnnouncement(page: ScenePage | null, nodeIds: readonly string[], connectorIds: readonly string[]): string {
  if (nodeIds.length === 0 && connectorIds.length === 0) return 'Nothing selected.';
  const label = (nodeId: string | null | undefined) => {
    const value = page?.nodes.find((node) => node.id === nodeId)?.content.label;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  if (nodeIds.length === 1 && connectorIds.length === 0) {
    const name = label(nodeIds[0]);
    if (name) return `${name} selected.`;
  }
  if (nodeIds.length === 0 && connectorIds.length === 1) {
    const connector = page?.connectors.find((candidate) => candidate.id === connectorIds[0]);
    const end = (nodeId: string | null | undefined) => (nodeId ? label(nodeId) ?? 'shape' : 'a point');
    if (connector) return `Connector ${end(connector.source.nodeId)} → ${end(connector.target.nodeId)} selected.`;
  }
  return [nodeIds.length ? count(nodeIds.length, 'shape') : '', connectorIds.length ? count(connectorIds.length, 'connector') : '']
    .filter(Boolean).join(' and ') + ' selected.';
}
