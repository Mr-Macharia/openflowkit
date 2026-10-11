import type { SceneNode, ScenePage } from '../opencanvas/domain/document/types';
import type { JsonObject } from '../opencanvas/domain/document/json';
import type { DslDiagnostic } from './ast';
import { diagnostic } from './diagnostics';
import { joinTokens, type DslSegment } from './segments';
import { quote, slugifyDslId } from './text';
import { ANIMATION_PRESETS, type AnimationPreset } from '../opencanvas/domain/animation/types';
import { boundsOfNodes } from '../opencanvas/domain/animation/bounds';
import { autoSequence } from '../opencanvas/domain/animation/sequence';
import { flowToTimeline } from '../opencanvas/domain/animation/flow';
import { archModelOfPage } from './model/model';
import type { SceneDocumentV1 } from '../opencanvas/domain/document/types';
import { scaleTimeline, stepDuration } from '../opencanvas/domain/animation/frame';
import type { AnimationStep, Timeline } from '../opencanvas/domain/animation/types';

/**
 * The `animate` block (grammar §6.6a): the one place motion is written down.
 * A step is "these things appear, hold, next" — steps round-trip to text,
 * keyframes do not. Omitted block means `autoSequence`; the serializer never
 * invents one.
 */

interface AnimateStep {
  /** Node refs the step reveals. */
  readonly refs: readonly string[];
  /** Edges the step reveals (`a -> c`); both endpoints show too. */
  readonly edges?: readonly (readonly [string, string])[];
  readonly label?: string;
  readonly holdMs?: number;
  /** Source line, for the W122 an unknown ref earns at compile; not part of the stored block. */
  readonly line?: number;
}

export interface AnimateBlock {
  readonly preset: AnimationPreset;
  readonly durationMs?: number;
  readonly loop: boolean;
  readonly steps: readonly AnimateStep[];
}

/** `10s`, `8500ms`, `10` → milliseconds. Null when unreadable. */
export function parseAnimateDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(match[2] === 'ms' ? value : value * 1000);
}

export function formatAnimateDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

function isPreset(value: string): value is AnimationPreset {
  return (ANIMATION_PRESETS as readonly string[]).includes(value);
}

/** One inner line: `a, b`, `a -> c : label`, either plus `hold 2s`. */
function parseStep(segment: DslSegment, diagnostics: DslDiagnostic[]): AnimateStep | null {
  const tokens = segment.tokens;
  if (tokens[0]?.value !== 'step' || tokens.length < 2) {
    diagnostics.push(diagnostic(segment, 'W190', 'warning', 'animate: only `step` lines belong in the block; line dropped', 'step a, b'));
    return null;
  }
  const body = tokens.slice(1);
  const holdAt = body.findIndex((token) => token.value === 'hold');
  const head = holdAt >= 0 ? body.slice(0, holdAt) : body;
  const holdToken = holdAt >= 0 ? body.slice(holdAt + 1).find((token) => token.value !== 'hold') : undefined;
  const holdMs = holdToken ? parseAnimateDuration(holdToken.value) : undefined;
  if (holdToken && holdMs === null) {
    diagnostics.push(diagnostic(segment, 'W190', 'warning', `animate: unreadable hold "${holdToken.value}"; default timing used`, 'hold 2s'));
  }
  const colon = head.findIndex((token) => token.value === ':');
  const refsPart = colon >= 0 ? head.slice(0, colon) : head;
  const label = colon >= 0 ? joinTokens(head.slice(colon + 1)) : '';
  // Comma-separated items: a node ref, or `a -> c` for an edge.
  const items = joinTokens(refsPart).split(',').map((item) => item.trim()).filter(Boolean);
  const refs: string[] = [];
  const edges: [string, string][] = [];
  for (const item of items) {
    const arrow = item.indexOf('->');
    if (arrow > 0) {
      const from = item.slice(0, arrow).trim();
      const to = item.slice(arrow + 2).trim();
      if (!from || !to) {
        diagnostics.push(diagnostic(segment, 'W190', 'warning', `animate: unreadable edge "${item}"; item dropped`, 'a -> c'));
        continue;
      }
      edges.push([from, to]);
    } else if (item) {
      refs.push(item);
    }
  }
  if (refs.length === 0 && edges.length === 0) {
    diagnostics.push(diagnostic(segment, 'W190', 'warning', 'animate: step has no node to reveal; line dropped', 'step a, b'));
    return null;
  }
  return {
    refs,
    ...(edges.length ? { edges } : {}),
    ...(label ? { label } : {}),
    ...(holdMs ? { holdMs } : {}),
    line: segment.line,
  };
}

/**
 * A step names a node the way an edge end does: its id as written, its label, or their slug — and
 * no slug for a name that slugs to nothing (`缓存` → `n`). `nodes` are the diagram's, not its frame.
 */
function animateRefResolver(nodes: readonly SceneNode[]): (ref: string) => string | undefined {
  const ids = new Set(nodes.map((node) => node.id));
  const byLabel = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.content.label === 'string' && !byLabel.has(node.content.label)) byLabel.set(node.content.label, node.id);
  }
  const bySlug = (ref: string) => {
    const slug = slugifyDslId(ref);
    // `n` is what a name with no Latin letter or digit slugs to: it names nothing.
    return (slug !== 'n' || ref.trim().toLowerCase() === 'n') && ids.has(slug) ? slug : undefined;
  };
  return (ref) => (ids.has(ref) ? ref : byLabel.get(ref) ?? bySlug(ref));
}

/** W122 for every step ref no compiled node answers to, on its line: a step that would silently reveal nothing. */
export function animateRefDiagnostics(block: AnimateBlock, nodes: readonly SceneNode[]): DslDiagnostic[] {
  const resolve = animateRefResolver(nodes);
  return block.steps.flatMap((step) => [...step.refs, ...(step.edges ?? []).flat()]
    .filter((ref) => !resolve(ref))
    .map((ref): DslDiagnostic => ({
      code: 'W122', severity: 'warning', line: step.line ?? 0, col: 1, endCol: 1,
      message: `animate: unknown node "${ref}"`, hint: 'write a node id or label from the diagram', source: 'parse',
    })));
}

/**
 * Pulls the animate block out of a statement stream: the family parsers never
 * see it, so `step a -> c` inside the block cannot become a real edge. Works
 * for every family because it runs before the family is chosen.
 */
export function extractAnimateBlock(
  segments: readonly DslSegment[],
  diagnostics: DslDiagnostic[],
): { readonly block: AnimateBlock | null; readonly segments: readonly DslSegment[] } {
  const index = segments.findIndex((segment) => segment.tokens[0]?.value === 'animate' && segment.opens);
  if (index < 0) return { block: null, segments };
  const header = segments[index]!;
  const words = header.tokens.slice(1).map((token) => token.value);
  const presetWord = words.find((word) => word !== 'loop' && !/^\d/.test(word));
  const durationWord = words.find((word) => /^\d/.test(word));
  if (presetWord && !isPreset(presetWord)) {
    diagnostics.push(diagnostic(header, 'W190', 'warning', `animate: unknown preset "${presetWord}"; Build assumed`, 'build'));
  }
  const preset = presetWord && isPreset(presetWord) ? presetWord : 'build';
  const durationMs = durationWord ? parseAnimateDuration(durationWord) : null;
  if (durationWord && durationMs === null) {
    diagnostics.push(diagnostic(header, 'W190', 'warning', `animate: unreadable duration "${durationWord}"; natural length used`, '10s'));
  }
  const inner: DslSegment[] = [];
  let depth = 1;
  let close = -1;
  for (let at = index + 1; at < segments.length; at += 1) {
    const segment = segments[at]!;
    if (segment.opens) depth += 1;
    if (segment.closes) {
      depth -= 1;
      if (depth === 0) { close = at; break; }
    }
    if (segment.tokens.length > 0 && segment.tokens[0]?.kind !== 'comment') inner.push(segment);
  }
  if (close < 0) {
    diagnostics.push(diagnostic(header, 'W103', 'warning', 'animate block is never closed', '} inserted'));
    close = segments.length;
  }
  const steps = inner.flatMap((segment) => {
    const step = parseStep(segment, diagnostics);
    return step ? [step] : [];
  });
  return {
    block: { preset, ...(durationMs ? { durationMs } : {}), loop: words.includes('loop'), steps },
    segments: [...segments.slice(0, index), ...segments.slice(close + 1)],
  };
}

/** Canonical block text (grammar §6.4 order: after edges, before align/notes). */
export function animateBlockLines(block: AnimateBlock): string[] {
  const header = ['animate', block.preset];
  if (block.durationMs) header.push(formatAnimateDuration(block.durationMs));
  if (block.loop) header.push('loop');
  return [
    `${header.join(' ')} {`,
    ...block.steps.map((step) => {
      const items = [...step.refs, ...(step.edges ?? []).map(([from, to]) => `${from} -> ${to}`)];
      return `  step ${items.join(', ')}${step.label ? ` : ${quote(step.label)}` : ''}${step.holdMs ? ` hold ${formatAnimateDuration(step.holdMs)}` : ''}`;
    }),
    '}',
  ];
}

/** Plain JSON for `metadata.dsl.animate`; the scene never holds class instances. */
export function animateToJson(block: AnimateBlock): JsonObject {
  return {
    preset: block.preset,
    ...(block.durationMs ? { durationMs: block.durationMs } : {}),
    loop: block.loop,
    steps: block.steps.map((step) => ({
      refs: [...step.refs],
      ...(step.edges ? { edges: step.edges.map(([from, to]) => [from, to]) } : {}),
      ...(step.label ? { label: step.label } : {}),
      ...(step.holdMs ? { holdMs: step.holdMs } : {}),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `metadata.dsl.animate` back; malformed entries are dropped, never thrown. */
export function animateFromJson(value: unknown): AnimateBlock | null {
  if (!isRecord(value)) return null;
  const preset = typeof value.preset === 'string' && isPreset(value.preset) ? value.preset : 'build';
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((entry): AnimateStep[] => {
      if (!isRecord(entry) || !Array.isArray(entry.refs)) return [];
      const refs = entry.refs.filter((ref): ref is string => typeof ref === 'string');
      const edges = Array.isArray(entry.edges)
        ? entry.edges.flatMap((pair): [string, string][] =>
          Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string'
            ? [[pair[0], pair[1]]]
            : [])
        : [];
      if (refs.length === 0 && edges.length === 0) return [];
      return [{
        refs,
        ...(edges.length ? { edges } : {}),
        ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
        ...(typeof entry.holdMs === 'number' && entry.holdMs > 0 ? { holdMs: entry.holdMs } : {}),
      }];
    })
    : [];
  return {
    preset,
    ...(typeof value.durationMs === 'number' && value.durationMs > 0 ? { durationMs: value.durationMs } : {}),
    loop: value.loop === true,
    steps,
  };
}

/**
 * The block as a playable timeline: a ref names a node as an edge end does (id
 * as written, label, or slug). Unknown refs warn and reveal nothing rather than
 * throwing.
 */
export function timelineFromAnimate(
  page: ScenePage,
  block: AnimateBlock,
  diagnostics: DslDiagnostic[] = [],
): Timeline {
  // Never the diagram's own frame (its label is the title): it sits at the page root, a group's frame inside it.
  const drawn = page.nodes.filter((node) => !(node.kind === 'frame' && node.parentId === null));
  const resolve = animateRefResolver(drawn);
  diagnostics.push(...animateRefDiagnostics(block, drawn));
  const connectorsFor = (from: string | undefined, to: string | undefined): readonly string[] =>
    page.connectors
      .filter((connector) => from && to && connector.source.nodeId === from && connector.target.nodeId === to)
      .map((connector) => connector.id);
  const resolved = block.steps.map((step) => {
    const edgeRefs = (step.edges ?? []).flatMap(([from, to]) => [from, to]);
    const known = [...new Set([...step.refs, ...edgeRefs].flatMap((ref) => resolve(ref) ?? []))];
    const connectorIds = (step.edges ?? []).flatMap(([from, to]) => connectorsFor(resolve(from), resolve(to)));
    return { step, known, connectorIds };
  });
  // A connector no step names shows with the later of its two ends (an end never named is on screen
  // throughout), so no arrow floats in before its boxes.
  const named = new Set(resolved.flatMap(({ connectorIds }) => connectorIds));
  const firstShown = new Map<string, number>();
  resolved.forEach(({ known }, index) => known.forEach((id) => { if (!firstShown.has(id)) firstShown.set(id, index); }));
  for (const connector of page.connectors) {
    if (named.has(connector.id)) continue;
    const at = Math.max(firstShown.get(connector.source.nodeId ?? '') ?? -1, firstShown.get(connector.target.nodeId ?? '') ?? -1);
    if (at >= 0) resolved[at]!.connectorIds.push(connector.id);
  }
  const steps: AnimationStep[] = resolved.map(({ step, known, connectorIds }) => {
    const camera = boundsOfNodes(page, known);
    return {
      nodeIds: known,
      connectorIds,
      ...(step.holdMs ? { holdMs: step.holdMs } : {}),
      ...(step.label ? { note: step.label } : {}),
      ...(camera ? { camera } : {}),
    };
  });
  const timeline: Timeline = { steps, preset: block.preset, loop: block.loop, durationMs: steps.reduce((sum, step) => sum + stepDuration(step), 0) };
  return block.durationMs ? scaleTimeline(timeline, block.durationMs) : timeline;
}

type AnimateOrder = 'auto' | 'code' | (string & {});

interface MotionTimelineRequest {
  readonly document: SceneDocumentV1;
  readonly pageId: string;
  readonly preset?: AnimationPreset;
  readonly order?: AnimateOrder;
  /** Explicit clip length; null keeps the natural one. */
  readonly durationMs?: number | null;
}

/**
 * The one timeline every host resolves: `auto` walks the connector graph, a
 * flow id replays that model flow, `code` plays the animate block in the
 * document's text. Omitted block means `autoSequence`.
 */
export function motionTimelineFor(request: MotionTimelineRequest): Timeline {
  const page = request.document.pages.find(({ id }) => id === request.pageId) ?? request.document.pages[0];
  if (!page) throw new RangeError('Motion export requires a page.');
  const preset = request.preset ?? 'build';
  const model = archModelOfPage(page);
  const flow = request.order && request.order !== 'auto' && request.order !== 'code'
    ? model?.flows.find((candidate) => candidate.id === request.order)
    : undefined;
  const block = request.order === 'code' ? animateFromJson(frameAnimate(page)) : null;
  const base = block
    ? timelineFromAnimate(page, block)
    : flow && model
      ? flowToTimeline(flow, model, request.document, page, preset)
      : autoSequence(page, preset);
  return request.durationMs ? scaleTimeline(base, request.durationMs) : base;
}

/** The animate block a compiled page's frame carries, if any. */
function frameAnimate(page: ScenePage): unknown {
  const dsl = page.nodes.find((node) => node.kind === 'frame')?.metadata.dsl;
  return dsl && typeof dsl === 'object' && !Array.isArray(dsl) ? (dsl as Record<string, unknown>).animate : undefined;
}

/**
 * A timeline as an animate block: scene ids are the DSL ids for every family
 * that compiles one node per reference, so the chips can write text that
 * compiles back to the same steps. A duration is only written when it differs
 * from the natural sum of the steps.
 */
export function animateBlockFromTimeline(timeline: Timeline, page: ScenePage): AnimateBlock {
  const endpointOf = (connectorId: string): [string, string] | null => {
    const connector = page.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector?.source.nodeId || !connector.target.nodeId) return null;
    return [connector.source.nodeId, connector.target.nodeId];
  };
  const steps: AnimateStep[] = timeline.steps.map((step) => {
    const edges = step.connectorIds.flatMap((id) => {
      const pair = endpointOf(id);
      return pair ? [pair] : [];
    });
    // An edge already reveals both endpoints, so they are not repeated as refs.
    const covered = new Set(edges.flat());
    return {
      refs: step.nodeIds.filter((id) => !covered.has(id)),
      ...(edges.length ? { edges } : {}),
      ...(step.note ? { label: step.note } : {}),
      ...(step.holdMs ? { holdMs: step.holdMs } : {}),
    };
  });
  const natural = steps.reduce((sum, step) => sum + stepDuration(step), 0);
  return {
    preset: timeline.preset,
    loop: timeline.loop,
    steps,
    ...(timeline.durationMs !== natural && timeline.durationMs > 0 ? { durationMs: timeline.durationMs } : {}),
  };
}

/**
 * Replaces the animate block in a document, or appends one. Idempotent:
 * writing the same block twice yields the same text.
 */
export function writeAnimateBlock(text: string, block: AnimateBlock): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*animate\b.*\{\s*$/.test(line));
  if (start >= 0) {
    let depth = 0;
    let end = start;
    for (let at = start; at < lines.length; at += 1) {
      depth += (lines[at]!.match(/\{/g) ?? []).length;
      depth -= (lines[at]!.match(/\}/g) ?? []).length;
      if (depth <= 0) { end = at; break; }
    }
    lines.splice(start, end - start + 1, ...animateBlockLines(block));
    return lines.join('\n');
  }
  const body = [...animateBlockLines(block)];
  const trimmed = lines.join('\n').replace(/\n+$/, '');
  return `${trimmed}${trimmed ? '\n' : ''}\n${body.join('\n')}\n`;
}
