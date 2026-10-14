import { placedElementId } from '../../../dsl/model/model';
import { buildArchRelationCommands } from '../../application/dsl/architectureCommands';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';

/**
 * Drawing a connector between two model objects records the relation too:
 * one batch, one undo step, and Generate brings it back.
 */
export function connectorWithRelation(
  command: DocumentCommand, fromNodeId: string, toNodeId: string,
  currentPage: ScenePage | null, hasModel: boolean, document: SceneDocumentV1 | null,
): DocumentCommand {
  if (!currentPage || !hasModel) return command;
  const elementOf = (nodeId: string) => {
    const node = currentPage.nodes.find((candidate) => candidate.id === nodeId);
    return node ? placedElementId(node) : null;
  };
  const from = elementOf(fromNodeId);
  const to = elementOf(toNodeId);
  if (!from || !to || from === to || !document) return command;
  const relation = buildArchRelationCommands(document, from, to, undefined, { exceptPageId: currentPage.id, create: true });
  if (!relation) return command;
  // The drawn connector keeps its minted id (selection follows it) but
  // records which relation it is, so flows and the panel can find it.
  const linked: DocumentCommand = command.kind === 'insert-connector' ? {
    ...command,
    connector: {
      ...command.connector,
      metadata: { ...command.connector.metadata, model: { relationId: relation.relation.id } },
    },
  } : command;
  // Model pages first (they replace the page), then the connector insert:
  // inserting into a page whose `before` snapshot is stale would fail.
  return {
    kind: 'batch',
    id: 'connector-with-relation',
    label: 'Connect elements',
    commands: [...relation.commands, linked],
  };
}
