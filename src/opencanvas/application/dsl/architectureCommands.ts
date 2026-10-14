import { projectRelations } from '../../../dsl/model/predicates';
import { relationConnector } from '../../../dsl/families/architecture/scene';
import { createArchIndex, placedElementId } from '../../../dsl/model/model';
import type { ArchFlow, ArchModel, ArchRelation } from '../../../dsl/model/types';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import { batch, isRecord, modelPages, pageWithModel, setPage } from './archPages';
import { optional } from './archElements';

export type { ArchElementPatch, WorkspacePagesOptions } from './archPages';
export { buildWorkspacePagesCommand, firstViewLanding, isModelPlacement, modelPages, workspaceViewFrames } from './archPages';
export {
  buildArchAddToViewCommand,
  buildArchElementAddCommand,
  buildArchElementEditCommand,
  buildArchElementRemoveCommand,
  buildArchIconsOffCommand,
  buildArchRemoveIconsCommand,
  buildArchRenameReslugCommand,
  buildArchSetIconCommand,
  buildArchUnplaceCommand,
  defaultChildKind,
} from './archElements';

/**
 * Model-aware commands: one element, many views. Every builder returns ONE
 * batch so a rename, a relation or a workspace generate is one undo step.
 */

/* -------------------------------------------------------------- relations */

/**
 * Add or relabel a model relation on every view. Every page that places both
 * ends gets the connector (or its new label), except `exceptPageId`: the page
 * where the user is drawing it, whose connector the caller inserts itself.
 * Returns the flat page commands so a caller can merge them into one batch.
 */
export function buildArchRelationCommands(
  document: SceneDocumentV1,
  from: string,
  to: string,
  label: string | undefined,
  options: { readonly exceptPageId?: string; readonly relationId?: string; readonly create?: boolean } = {},
): { commands: DocumentCommand[]; relation: ArchRelation } | null {
  const pages = modelPages(document, from);
  const source = pages[0];
  if (!source) return null;
  const index = createArchIndex(source.model);
  if (!index.byId.has(from) || !index.byId.has(to) || from === to) return null;
  const existing = options.create ? undefined : source.model.relations.find((relation) => options.relationId ? relation.id === options.relationId : relation.from === from && relation.to === to);
  if (options.relationId && !existing) return null;
  const nextLabel = label === undefined ? existing?.label : optional(label);
  if (existing && nextLabel === existing.label) return null;
  const baseId = `rel:${from}->${to}`;
  let newId = baseId;
  for (let occurrence = 2; source.model.relations.some((relation) => relation.id === newId); occurrence += 1) newId = `${baseId}:${occurrence}`;
  const relation: ArchRelation = {
    id: existing?.id ?? newId,
    from, to, tags: existing?.tags ?? [],
    ...(nextLabel ? { label: nextLabel } : {}),
    ...(existing?.tech ? { tech: existing.tech } : {}),
    ...(existing?.attrs ? { attrs: existing.attrs } : {}),
    ...(existing?.line !== undefined ? { line: existing.line } : {}),
  };
  const next: ArchModel = {
    ...source.model,
    relations: existing
      ? source.model.relations.map((candidate) => candidate === existing ? relation : candidate)
      : [...source.model.relations, relation],
  };
  const withConnector = (page: ScenePage): ScenePage => {
    const template = relationConnector(relation, from, to, false);
    const drawn = page.connectors.some((connector) => isRecord(connector.metadata.model) && connector.metadata.model.relationId === relation.id);
    if (drawn) {
      return { ...page, connectors: page.connectors.map((connector) =>
        isRecord(connector.metadata.model) && connector.metadata.model.relationId === relation.id ? { ...connector, labels: template.labels } : connector) };
    }
    if (page.id === options.exceptPageId) return page;
    const placements = new Map(page.nodes.flatMap((node) => {
      const element = placedElementId(node);
      return element ? [[element, node.id] as const] : [];
    }));
    // A projected relationship never adds a second line where the pair is already drawn.
    const joined = (from: string, to: string) => page.connectors.some((connector) =>
      connector.source.nodeId === placements.get(from) && connector.target.nodeId === placements.get(to));
    const projected = projectRelations(createArchIndex(next), new Set(placements.keys())).filter((projection) =>
      projection.relation.id === relation.id && !(projection.implied && joined(projection.from, projection.to)));
    const connectors = projected.map((projection) => {
      const connector = relationConnector(relation, projection.from, projection.to, projection.implied);
      return {...connector, source: {...connector.source, nodeId: placements.get(projection.from)!}, target: {...connector.target, nodeId: placements.get(projection.to)!}};
    });
    return connectors.length ? {...page, connectors: [...page.connectors, ...connectors]} : page;
  };
  return {
    relation,
    commands: pages.map(({ page }) => setPage(page, withConnector(pageWithModel(page, next)), `model-relation:${relation.id}`, 'Add relation')),
  };
}

/** Adds an authored message sequence to every model copy in one undo step. */
export function buildArchFlowCreateCommand(document: SceneDocumentV1, flow: ArchFlow): DocumentCommand | null {
  const pages = modelPages(document, flow.steps[0]?.from ?? '');
  const source = pages[0];
  if (!source || !flow.name.trim() || !flow.id || !flow.steps.length || source.model.flows.some((existing) => existing.id === flow.id)) return null;
  const elements = new Set(source.model.elements.map((element) => element.id));
  if (flow.steps.some((step) => step.kind !== 'message' || !step.from || !step.to || step.from === step.to || !elements.has(step.from) || !elements.has(step.to) || !step.label?.trim())) return null;
  const model = {...source.model, flows: [...source.model.flows, flow]};
  return batch('create-model-flow', 'Create flow', pages.map(({page}) => setPage(page, pageWithModel(page, model), `create-flow:${flow.id}`, 'Create flow')));
}
