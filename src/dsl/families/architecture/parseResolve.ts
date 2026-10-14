import type { DslDiagnostic } from '../../ast';
import { lineDiagnostic } from '../../diagnostics';
import { createArchIndex, resolveElementRef, suggestElementRef, viewDisplayName } from '../../model/model';
import type { ArchElement, ArchFlow, ArchModel, ArchRelation, ArchView, FlowStep } from '../../model/types';
import type { ArchitectureWorkspace, RelationDraft } from './parseHelpers';

export interface FlowDraft {
  readonly flow: ArchFlow;
  readonly refs: Map<FlowStep, { from: string; to: string }>;
}

export interface WorkspaceDraft {
  readonly elements: readonly ArchElement[];
  readonly views: readonly ArchView[];
  readonly flowDrafts: readonly FlowDraft[];
  readonly pendingRelations: readonly RelationDraft[];
  readonly pendingInstances: ReadonlyArray<{ element: ArchElement; ref: string; line: number }>;
  readonly reserved: readonly string[];
  readonly modelName: string | undefined;
}

/** Second pass: every reference resolves against the finished tree. */
export function resolveWorkspaceDraft(draft: WorkspaceDraft, diagnostics: DslDiagnostic[]): ArchitectureWorkspace {
  const { elements, views, flowDrafts, pendingRelations, pendingInstances, reserved, modelName } = draft;
  const provisional: ArchModel = { elements, relations: [], views, flows: flowDrafts.map(({ flow }) => flow) };
  const index = createArchIndex(provisional);
  const instanceTargets = new Map<ArchElement, string>();

  for (const entry of pendingInstances) {
    const target = resolveElementRef(index, entry.ref, entry.element.parent);
    if (!target) {
      diagnostics.push(lineDiagnostic(entry.line, 'W122', 'warning', `Unknown instance target ${entry.ref}; instance kept as a plain node`));
      continue;
    }
    instanceTargets.set(entry.element, target.id);
  }
  const resolvedRelations: ArchRelation[] = [];
  const pairOccurrences = new Map<string, number>();
  const logicalIndex = createArchIndex({...index.model, elements: index.model.elements.filter((element) => !element.env)});
  const environmentIndexes = new Map<string, ReturnType<typeof createArchIndex>>();
  for (const entry of pendingRelations) {
    let relationIndex = index;
    if (entry.env) {
      if (!environmentIndexes.has(entry.env)) environmentIndexes.set(entry.env, createArchIndex({...index.model, elements: index.model.elements.filter((element) => element.env === entry.env)}));
      relationIndex = environmentIndexes.get(entry.env)!;
    }
    const endpoint = (reference: string): ArchElement | null => {
      const direct = resolveElementRef(relationIndex, reference, entry.scope);
      if (direct || !entry.env) return direct;
      // Importers may spell an instance by its logical target's display path.
      const target = resolveElementRef(logicalIndex, reference);
      const instances = target ? relationIndex.model.elements.filter((element) => instanceTargets.get(element) === target.id) : [];
      return instances.length === 1 ? instances[0]! : null;
    };
    const from = endpoint(entry.from);
    const to = endpoint(entry.to);
    if (!from || !to) {
      const unknown = !from ? entry.from : entry.to;
      diagnostics.push(lineDiagnostic(entry.line, 'W122', 'warning', `Unknown element reference ${unknown}; relation dropped`, suggestElementRef(relationIndex, unknown)));
      continue;
    }
    const pair = `rel:${from.id}->${to.id}`;
    const occurrence = pairOccurrences.get(pair) ?? 0;
    pairOccurrences.set(pair, occurrence + 1);
    resolvedRelations.push({
      id: occurrence ? `${pair}:${occurrence + 1}` : pair, from: from.id, to: to.id, tags: entry.tags,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.tech ? { tech: entry.tech } : {}),
      ...(entry.link ? { link: entry.link } : {}),
      ...(entry.attrs ? { attrs: entry.attrs } : {}),
      line: entry.line,
    });
  }
  const resolvedFlows: ArchFlow[] = flowDrafts.map(({ flow, refs }) => ({
    ...flow,
    steps: resolveSteps(flow.steps, refs, index, diagnostics),
  }));
  const resolvedViews = views.map((view) => {
    if (!view.of) return view;
    const target = resolveElementRef(index, view.of, null);
    if (!target) diagnostics.push(lineDiagnostic(view.line ?? 1, 'W122', 'warning', `Unknown view target ${view.of}; the view shows nothing`));
    return target ? { ...view, of: target.id, name: viewDisplayName(view, target) } : view;
  });
  const resolvedElements = elements.map((element) => {
    const target = instanceTargets.get(element);
    if (!target) return element;
    const targetElement = elements.find((candidate) => candidate.id === target);
    return { ...element, instanceOf: target, ...(targetElement ? { name: targetElement.name } : {}) };
  });

  return {
    reserved,
    model: {
      ...(modelName ? { name: modelName } : {}),
      elements: resolvedElements,
      relations: resolvedRelations,
      views: resolvedViews,
      flows: resolvedFlows,
    },
  };
}

function resolveSteps(
  steps: readonly FlowStep[],
  refs: ReadonlyMap<FlowStep, { from: string; to: string }>,
  index: ReturnType<typeof createArchIndex>,
  diagnostics: DslDiagnostic[],
): FlowStep[] {
  return steps.map((step) => {
    const raw = refs.get(step);
    let from: string | undefined;
    let to: string | undefined;
    if (raw) {
      const fromElement = resolveElementRef(index, raw.from, null);
      const toElement = resolveElementRef(index, raw.to, null);
      if (!fromElement || !toElement) {
        diagnostics.push(lineDiagnostic(step.line ?? 1, 'W122', 'warning', `Unknown flow reference ${!fromElement ? raw.from : raw.to}; step kept without a relation`));
      } else {
        from = fromElement.id;
        to = toElement.id;
      }
    }
    const { from: _rawFrom, to: _rawTo, ...rest } = step;
    return {
      ...rest,
      ...(from && to ? { from, to } : {}),
      ...(step.branches ? { branches: step.branches.map((branch) => ({ ...branch, steps: resolveSteps(branch.steps, refs, index, diagnostics) })) } : {}),
    };
  });
}
