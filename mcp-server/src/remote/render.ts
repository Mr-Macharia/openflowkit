// One picture, bounded: the total size is checked on a cheap grid layout before ELK sees anything, and ELK lays out
// only the first view, because render_diagram returns one SVG. The other views get the grid layout.
import {
  compileWorkspace, createAgentDocument, deterministicLayout, findAgentOp, lintDsl, runAgentOp,
  type DslLintReport, type SceneDocumentV1,
} from '../lib/agent.js';
import { headlessElkLayout } from '../lib/agent.js';
import { loadFileCapabilities } from '../lib/fileCapabilities.js';
import { exportSvg } from '../lib/svgBeside.js';

type Diagnostic = DslLintReport['diagnostics'][number];
export interface LayoutPortLike { run(graph: unknown, signal?: AbortSignal): Promise<unknown> }

export const RENDER_LIMITS = { nodes: 1000, connectors: 400 } as const;
export const DEFAULT_DEADLINE_MS = 15_000;
/** A preview is one frame of a drawing still being written: a slow one is stale before it lands. */
export const PREVIEW_DEADLINE_MS = 3_000;

export interface Rendered {
  readonly lint: DslLintReport;
  readonly issues: readonly Diagnostic[];
  readonly document?: SceneDocumentV1;
  /** Set when the diagram is refused before any layout. */
  readonly refused?: string;
}

export async function renderCheck(source: string, name: string, options: { elk?: LayoutPortLike; signal?: AbortSignal } = {}): Promise<Rendered> {
  const notable = (list: readonly Diagnostic[]) => list.filter(({ severity }) => severity !== 'info');
  const lint = lintDsl(source);
  if (!lint.ok) return { lint, issues: notable(lint.diagnostics) };

  const grid = deterministicLayout as LayoutPortLike;
  const all = await compileWorkspace(lint.converted?.dsl ?? source, { layout: grid, ...(options.signal ? { signal: options.signal } : {}) } as never);
  const nodes = all.views.reduce((sum, view) => sum + view.result.nodes.length + view.result.groups.length, 0);
  const connectors = all.views.reduce((sum, view) => sum + view.result.connectors.length, 0);
  if (nodes > RENDER_LIMITS.nodes || connectors > RENDER_LIMITS.connectors) {
    return { lint, issues: [], refused: `This diagram has ${nodes} shapes and ${connectors} connections across ${all.views.length} view(s); the limit is ${RENDER_LIMITS.nodes} shapes and ${RENDER_LIMITS.connectors} connections in total. Split it into smaller diagrams.` };
  }

  let laidOut = 0;
  const firstViewOnly: LayoutPortLike = {
    run: (graph, signal) => (laidOut++ === 0 ? (options.elk ?? (headlessElkLayout as LayoutPortLike)) : grid).run(graph, signal),
  };
  const base = await loadFileCapabilities();
  const capabilities = {
    ...base,
    compileWorkspace: (text: string, compileOptions?: unknown) =>
      base.compileWorkspace(text, { ...(compileOptions as object), layout: firstViewOnly, ...(options.signal ? { signal: options.signal } : {}) }),
  };
  const document = createAgentDocument(name);
  const result = await runAgentOp(findAgentOp('create_diagram')!, { dsl: source }, { document, pageId: document.pages[0]!.id, capabilities });
  const output = result.output as { diagnostics?: readonly Diagnostic[] };
  const seen = new Set<string>();
  const issues = notable([...lint.diagnostics, ...(output.diagnostics ?? [])]).filter((issue) => {
    const key = `${issue.code}:${issue.line}:${issue.col}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
  return { lint, issues, document: result.document };
}

/** Rejects with `took too long` at the deadline and aborts the work's signal; ELK itself cannot be pre-empted mid-run. */
export async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`took too long (over ${Math.round(ms / 1000)} s); simplify the diagram`)); }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Preview { readonly svg: string; readonly nodes: number; readonly connectors: number }

/**
 * The picture of a source the model is still writing: drawn whenever anything compiles, warnings and errors included,
 * because the end of the source is missing. The frame is keyed `frame` (its id hashes the source, so it would change
 * every time) and every shape keeps its own id, so the card can tell which shapes are new.
 */
export async function previewSvg(source: string, theme: 'light' | 'dark', options: { layout?: LayoutPortLike; deadlineMs?: number } = {}): Promise<Preview | { refused: string }> {
  const checked = await withDeadline(options.deadlineMs ?? PREVIEW_DEADLINE_MS, (signal) =>
    renderCheck(source, 'Preview', { signal, ...(options.layout ? { elk: options.layout } : {}) }));
  if (checked.refused) return { refused: checked.refused };
  const page = checked.document?.pages[0];
  const nodes = page?.nodes.filter((node) => (node as { kind: string }).kind !== 'frame') ?? [];
  if (!checked.document || !page || nodes.length === 0) return { refused: 'Nothing to draw yet.' };
  const frame = page.nodes.find((node) => (node as { kind: string }).kind === 'frame') as { id: string } | undefined;
  let svg = await exportSvg(checked.document, page.id, theme);
  if (frame) svg = svg.split(`data-node-id="${frame.id}"`).join('data-node-id="frame"');
  return { svg, nodes: nodes.length, connectors: page.connectors.length };
}
