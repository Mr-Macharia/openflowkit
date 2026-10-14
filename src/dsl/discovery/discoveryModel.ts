import { archModelFromJson } from '../model/model';
import type { ArchitectureDiscovery, DiscoveredUnitKind, DiscoveryEvidence } from './discoveryTypes';
import { isRecord, normalizeName } from './discoveryShared';

/* ------------------------------------------------------------- model view */

export interface ArchElementData {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly parent: string | null;
  readonly tech?: string;
  readonly desc?: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
  readonly attrs?: readonly { readonly key?: string; readonly value: string }[];
}

export interface ArchRelationData {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly tech?: string;
}

export interface ArchViewData {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly of?: string;
}

export interface ArchFlowStepData {
  readonly id: string;
  readonly kind: string;
  readonly from?: string;
  readonly to?: string;
  readonly label?: string;
  readonly branches?: readonly { readonly label?: string; readonly steps: readonly ArchFlowStepData[] }[];
}

export interface ArchFlowData {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly ArchFlowStepData[];
}

export interface ArchModelData {
  readonly name?: string;
  readonly elements: readonly ArchElementData[];
  readonly relations: readonly ArchRelationData[];
  readonly views: readonly ArchViewData[];
  readonly flows: readonly ArchFlowData[];
}

/** The bundle's reader (`archModelFromJson`): anything malformed is dropped, never thrown. */
export function readArchModel(value: unknown): ArchModelData | null {
  return archModelFromJson(value) as ArchModelData | null;
}

/** `metadata.dsl.arch.model` off a compiled frame or a stored page node. */
export function modelFromNode(node: unknown): ArchModelData | null {
  if (!isRecord(node) || !isRecord(node.metadata)) return null;
  const dsl = node.metadata.dsl;
  if (!isRecord(dsl) || !isRecord(dsl.arch)) return null;
  return readArchModel(dsl.arch.model);
}

/** First page node of a document that carries a model. */
export function modelFromDocument(document: unknown): ArchModelData | null {
  if (!isRecord(document) || !Array.isArray(document.pages)) return null;
  for (const page of document.pages) {
    if (!isRecord(page) || !Array.isArray(page.nodes)) continue;
    for (const node of page.nodes) {
      const model = modelFromNode(node);
      if (model) return model;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ drift */

export interface DriftFinding {
  readonly id: string;
  readonly name: string;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface DriftChange {
  readonly id: string;
  readonly field: 'tech' | 'dir';
  readonly model: string;
  readonly repo: string;
}

export interface DriftReportResult {
  readonly missing: readonly DriftFinding[];
  readonly undrawn: readonly DriftFinding[];
  readonly changed: readonly DriftChange[];
}

/**
 * Diff a model (object, or its JSON) against a discovery run. Elements match by
 * normalized display name — ids are authored, names are what a human reviews.
 * `undrawn` carries the element name as its evidence-of-absence, which is what
 * the editor badge shows.
 */
export function driftReport(modelOrJson: ArchModelData | string, result: ArchitectureDiscovery): DriftReportResult {
  const model = typeof modelOrJson === 'string' ? readArchModel(parseJson(modelOrJson)) : modelOrJson;
  if (!model) throw new TypeError('driftReport expects a model object or its JSON.');
  const byName = new Map<string, ArchElementData[]>();
  const parentOf = new Map<string, string | null>();
  for (const element of model.elements) {
    const key = normalizeName(element.name);
    byName.set(key, [...(byName.get(key) ?? []), element]);
    parentOf.set(element.id, element.parent);
  }

  const missing: DriftFinding[] = [];
  const matched = new Set<string>();
  const changed: DriftChange[] = [];
  for (const unit of result.units) {
    const candidates = byName.get(normalizeName(unit.name)) ?? [];
    // Prefer the same kind: a container named `api` must not match the
    // `Api` system that contains it (both normalize to `api`).
    const element = candidates.find((candidate) => !matched.has(candidate.id) && candidate.kind === unit.kind)
      ?? candidates.find((candidate) => !matched.has(candidate.id));
    if (!element) {
      missing.push({ id: unit.id, name: unit.name, evidence: unit.evidence });
      continue;
    }
    matched.add(element.id);
    // A system is evidenced by its children: it is a grouping, not a unit.
    for (let parent = parentOf.get(element.id) ?? null; parent; parent = parentOf.get(parent) ?? null) {
      matched.add(parent);
    }
    if (element.tech && unit.tech && element.tech.trim().toLowerCase() !== unit.tech.trim().toLowerCase()) {
      changed.push({ id: element.id, field: 'tech', model: element.tech, repo: unit.tech });
    }
    const dir = element.attrs?.find((entry) => entry.key === 'dir')?.value;
    if (dir && unit.dir && normalizeName(dir) !== normalizeName(unit.dir)) {
      changed.push({ id: element.id, field: 'dir', model: dir, repo: unit.dir });
    }
  }

  // People and external systems are context: code never evidences a person, and an API reached over
  // plain HTTP leaves no manifest line. A discovered external that the model lacks is still `missing`.
  // ponytail: an external the code stopped using goes unflagged; check its client library if that bites.
  const undrawn: DriftFinding[] = model.elements
    .filter((element) => !matched.has(element.id) && element.kind !== 'person' && element.kind !== 'external')
    .map((element) => ({
      id: element.id, name: element.name,
      evidence: [{ file: '', line: 0, text: element.name }],
    }));

  return { missing, undrawn, changed };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- summary */

export function discoverySummary(result: ArchitectureDiscovery): string {
  const lines: string[] = [];
  lines.push(`Discovered ${result.units.length} units and ${result.relations.length} relations (${result.evidenceCount} evidence lines).`);
  const byKind = new Map<DiscoveredUnitKind, number>();
  for (const unit of result.units) byKind.set(unit.kind, (byKind.get(unit.kind) ?? 0) + 1);
  lines.push(`Kinds: ${[...byKind.entries()].map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
  for (const unit of result.units) {
    const where = unit.dir ? ` (${unit.dir}/)` : '';
    lines.push(`  - ${unit.name}${where}${unit.tech ? ` [${unit.tech}]` : ''} — ${unit.evidence[0]?.file ?? 'no evidence'}`);
  }
  const languages = Object.entries(result.languages).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (languages.length) lines.push(`Languages: ${languages.map(([language, count]) => `${language}:${count}`).join(', ')}`);
  return lines.join('\n');
}
