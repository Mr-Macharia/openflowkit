import {
  createMermaidParseState,
  registerMermaidNode,
  toMermaidParseModel,
  type MermaidDirection,
  type MermaidParseModel,
} from './mermaidParserModel';
import {
  ARROW_PATTERNS,
  CLASS_DEF_RE,
  parseEdgeLine,
  parseClassAssignmentLine,
  parseLinkStyleLine,
  parseNodeDeclaration,
  parseStyleString,
  SKIP_PATTERNS,
  STYLE_RE,
  normalizeEdgeLabels,
  normalizeMultilineStrings,
} from './mermaidParserHelpers';
import { createFlowEdges, createFlowNodes } from './mermaidParserFlow';
import type { FlowEdge, FlowNode } from './types';

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  error?: string;
  direction?: MermaidDirection;
  diagnostics?: string[];
}

/**
 * Flowchart `;` ends a statement (`graph LR; A-->B; B-->C`) unless it sits in quotes, brackets or a |label|;
 * `%%` there starts a comment that runs to the end of the line.
 */
function splitStatements(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let piped = false;
  let start = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === '%' && line[index + 1] === '%' && depth === 0 && !piped) {
      parts.push(line.slice(start, index));
      return parts;
    }
    else if (char === '|' && depth === 0) piped = !piped;
    else if ('[({'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0 && !piped) {
      parts.push(line.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(line.slice(start));
  return parts;
}

/** Source lines, with flowchart statements split apart; each keeps its 1-based source line. */
function preprocessMermaidInput(input: string): { lines: string[]; lineNumbers: number[] } {
  const processed = normalizeEdgeLabels(normalizeMultilineStrings(input.replace(/\r\n/g, '\n'))).split('\n');
  const flowchart = /^(?:flowchart|graph)\b/i.test(processed.find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim() ?? '');
  const lines: string[] = [];
  const lineNumbers: number[] = [];
  processed.forEach((line, index) => {
    for (const part of flowchart && !line.trim().startsWith('%%') ? splitStatements(line) : [line]) {
      lines.push(part);
      lineNumbers.push(index + 1);
    }
  });
  return { lines, lineNumbers };
}

function isSkippableLine(line: string): boolean {
  return !line || SKIP_PATTERNS.some((pattern) => pattern.test(line));
}

/** `flowchart LR`, or a bare `flowchart` / `graph`, which Mermaid draws top to bottom. */
function parseFlowchartDeclaration(line: string): MermaidDirection | null {
  const flowchartMatch = line.match(/^(?:flowchart|graph)(?:\s+(TD|TB|LR|RL|BT))?\s*$/i);
  if (!flowchartMatch) {
    return null;
  }
  const direction = (flowchartMatch[1] ?? 'TB').toUpperCase();
  return (direction === 'TD' ? 'TB' : direction) as MermaidDirection;
}

function parseStateDiagramDirection(nextLine: string | undefined): MermaidDirection {
  const dirMatch = nextLine?.trim().match(/^direction\s+(LR|TB)/i);
  return (dirMatch?.[1].toUpperCase() ?? 'TB') as MermaidDirection;
}

function createSectionIdFromLabel(label: string): string {
  return `subgraph_${label.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function parseSubgraphDeclaration(
  line: string
): { sectionId: string; sectionLabel: string; sectionMermaidId?: string; sectionMermaidTitle: string } | null {
  const subgraphMatch = line.match(/^subgraph\s+(.+)$/i);
  if (!subgraphMatch) {
    return null;
  }

  const remainder = subgraphMatch[1].trim();
  if (!remainder) {
    return null;
  }

  const parsedNodeDeclaration = parseNodeDeclaration(remainder);
  if (parsedNodeDeclaration) {
    return {
      sectionId: parsedNodeDeclaration.id,
      sectionLabel: parsedNodeDeclaration.label,
      sectionMermaidId: parsedNodeDeclaration.id,
      sectionMermaidTitle: parsedNodeDeclaration.label,
    };
  }

  const quotedLabelMatch = remainder.match(/^"([^"]+)"$/) || remainder.match(/^'([^']+)'$/);
  const sectionLabel = quotedLabelMatch?.[1]?.trim() ?? remainder;
  if (!sectionLabel) {
    return null;
  }

  return {
    sectionId: createSectionIdFromLabel(sectionLabel),
    sectionLabel,
    sectionMermaidTitle: sectionLabel,
  };
}

function registerSectionNode(
  state: ReturnType<typeof createMermaidParseState>,
  line: string
): boolean {
  const subgraphDeclaration = parseSubgraphDeclaration(line);
  const stateGroupMatch =
    line.match(/^state\s+"([^"]+)"\s+as\s+(\w+)\s+\{/i) || line.match(/^state\s+(\w+)\s+\{/i);

  if (!subgraphDeclaration && !stateGroupMatch) {
    return false;
  }

  let sectionId: string;
  let sectionLabel: string;
  let sectionMermaidId: string | undefined;
  let sectionMermaidTitle: string;

  if (subgraphDeclaration) {
    sectionLabel = subgraphDeclaration.sectionLabel;
    sectionId = subgraphDeclaration.sectionId;
    sectionMermaidId = subgraphDeclaration.sectionMermaidId;
    sectionMermaidTitle = subgraphDeclaration.sectionMermaidTitle;
  } else if (stateGroupMatch) {
    sectionId = stateGroupMatch[2] ?? stateGroupMatch[1];
    sectionLabel = stateGroupMatch[1] ?? stateGroupMatch[2];
    sectionMermaidId = sectionId;
    sectionMermaidTitle = sectionLabel;
  } else {
    return false;
  }

  let attempts = 0;
  let finalId = sectionId;
  while (state.nodesMap.has(finalId)) {
    finalId = `${sectionId}_${++attempts}`;
  }

  const parentId = state.parentStack[state.parentStack.length - 1];
  state.nodesMap.set(finalId, {
    id: finalId,
    label: sectionLabel,
    type: 'section',
    parentId,
    metadata: {
      sectionMermaidId,
      sectionMermaidTitle,
    },
  });
  state.parentStack.push(finalId);

  return true;
}

function applyNodeStyleDirective(
  state: ReturnType<typeof createMermaidParseState>,
  line: string
): boolean {
  const styleMatch = line.match(STYLE_RE);
  if (!styleMatch) {
    return false;
  }

  const [, id, styleStr] = styleMatch;
  const styles = parseStyleString(styleStr);
  const node = state.nodesMap.get(id);
  if (node) {
    node.styles = { ...node.styles, ...styles };
  } else {
    registerMermaidNode(state, id);
    const registeredNode = state.nodesMap.get(id);
    if (registeredNode) {
      registeredNode.styles = styles;
    }
  }

  return true;
}

const CLICK_RE = /^click\s+([a-zA-Z0-9_][\w.-]*)\s+(.*)$/i;

/** `click A "url" "tooltip"` (or `click A href "url"`) is a link; a callback or a tooltip has nowhere to go. */
function applyClickDirective(
  state: ReturnType<typeof createMermaidParseState>,
  line: string,
  lineNumber: number
): boolean {
  const match = line.match(CLICK_RE);
  if (!match) {
    return false;
  }

  const [, id, rest] = match;
  const link = rest.match(/^(?:href\s+)?"([^"]*)"\s*(.*)$/i);
  if (!link) {
    state.diagnostics.push(`Click callback on ${id} dropped at line ${lineNumber}: "${line}"`);
  } else {
    if (!state.nodesMap.has(id)) registerMermaidNode(state, id);
    state.nodesMap.get(id)!.link = link[1];
    if (/^"[^"]*"/.test(link[2])) {
      state.diagnostics.push(`Click tooltip on ${id} dropped at line ${lineNumber}: "${line}"`);
    }
  }

  return true;
}

function applyClassAssignmentDirective(
  state: ReturnType<typeof createMermaidParseState>,
  line: string
): boolean {
  const assignment = parseClassAssignmentLine(line);
  if (!assignment) {
    return false;
  }

  assignment.nodeIds.forEach((nodeId) => {
    registerMermaidNode(state, nodeId);
    const node = state.nodesMap.get(nodeId);
    if (!node) {
      return;
    }

    const existingClasses = new Set(node.classes ?? []);
    assignment.classNames.forEach((className) => existingClasses.add(className));
    node.classes = [...existingClasses];
  });

  return true;
}

function parseEdgeDeclaration(
  state: ReturnType<typeof createMermaidParseState>,
  line: string,
  lineNumber: number
): boolean {
  if (!ARROW_PATTERNS.some((arrow) => line.includes(arrow))) {
    return false;
  }

  // `A e1@--> B`: the id names the link that follows it.
  const ids: string[] = [];
  const unnamed = line.replace(/(^|\s)([A-Za-z_][\w-]*)@(?=[<ox]?[-=.~])/g, (_, lead: string, id: string) => {
    ids.push(id);
    return lead;
  });
  const edgesFound = parseEdgeLine(unnamed);
  if (edgesFound.length === 0) {
    state.diagnostics.push(`Invalid Mermaid edge syntax at line ${lineNumber}: "${line}"`);
    return true;
  }

  edgesFound.forEach((edge, index) => {
    const type = state.diagramType === 'stateDiagram' ? 'state' : 'process';
    const sourceId = registerMermaidNode(state, edge.sourceRaw, type);
    const targetId = registerMermaidNode(state, edge.targetRaw, type);

    if (sourceId && targetId) {
      const rawEdge = { source: sourceId, target: targetId, label: edge.label, arrowType: edge.arrowType };
      state.rawEdges.push(rawEdge);
      if (ids.length === edgesFound.length) state.edgeIds.set(ids[index]!, rawEdge);
    }
  });

  return true;
}

/** `e1@{ animate: true }` (or `animation: fast|slow`) on an edge named earlier. */
function applyEdgeProperties(state: ReturnType<typeof createMermaidParseState>, line: string): boolean {
  const match = line.match(/^([A-Za-z_][\w-]*)@\{(.*)\}$/);
  const edge = match ? state.edgeIds.get(match[1]!) : undefined;
  if (!edge) return false;
  if (/\banimat(?:e\s*:\s*true|ion\s*:)/.test(match![2]!)) edge.animate = true;
  return true;
}

function parseStateDiagramNodeDeclaration(
  state: ReturnType<typeof createMermaidParseState>,
  line: string
): boolean {
  if (state.diagramType !== 'stateDiagram') {
    return false;
  }

  const stateDefMatch = line.match(/^state\s+"([^"]+)"\s+as\s+([A-Za-z_][\w.-]*)/i);
  if (stateDefMatch) {
    registerMermaidNode(state, stateDefMatch[2], 'state', stateDefMatch[1]);
    return true;
  }

  // `id : text` (never `id:::class`): the shown name, or under a name `state "…" as id` already gave.
  const stateDescMatch = line.match(/^(\w+)\s*:(?!:)\s*(.+)/);
  if (stateDescMatch) {
    const named = state.nodesMap.get(stateDescMatch[1]);
    if (named && named.label !== named.id) named.description = stateDescMatch[2].trim();
    else registerMermaidNode(state, stateDescMatch[1], 'state', stateDescMatch[2]);
    return true;
  }

  return false;
}

function buildMermaidParseModel({ lines, lineNumbers }: { lines: string[]; lineNumbers: number[] }): MermaidParseModel {
  const state = createMermaidParseState();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = lineNumbers[i];
    const subgraphDirection = state.diagramType === 'flowchart' ? parseFlowchartDeclaration(`flowchart ${line.replace(/^direction\s+/i, '')}`) : null;
    const section = state.nodesMap.get(state.parentStack[state.parentStack.length - 1] ?? '');
    if (/^direction\s/i.test(line) && subgraphDirection && section) {
      section.metadata = { ...section.metadata, sectionMermaidDirection: subgraphDirection };
      continue;
    }
    if (isSkippableLine(line)) {
      continue;
    }

    const flowchartDirection = parseFlowchartDeclaration(line);
    if (flowchartDirection) {
      state.diagramType = 'flowchart';
      state.direction = flowchartDirection;
      continue;
    }

    if (line.match(/^stateDiagram(?:-v2)?/i)) {
      state.diagramType = 'stateDiagram';
      state.direction = parseStateDiagramDirection(lines[i + 1]);
      continue;
    }

    if (line.match(/^end\s*$/i) || line === '}') {
      if (state.parentStack.length > 0) {
        state.parentStack.pop();
      } else if (state.diagramType === 'flowchart') {
        state.diagnostics.push(`Unexpected flowchart block closer at line ${lineNumber}: "${line}"`);
      }
      continue;
    }

    if (state.diagramType === 'flowchart' && /^subgraph\b/i.test(line) && !parseSubgraphDeclaration(line)) {
      state.diagnostics.push(`Invalid flowchart subgraph declaration at line ${lineNumber}: "${line}"`);
      continue;
    }

    if (registerSectionNode(state, line)) {
      continue;
    }

    const classDefMatch = line.match(CLASS_DEF_RE);
    if (classDefMatch) {
      state.classDefs.set(classDefMatch[1], parseStyleString(classDefMatch[2]));
      continue;
    }

    if (applyNodeStyleDirective(state, line)) {
      continue;
    }

    if (applyClassAssignmentDirective(state, line)) {
      continue;
    }

    if (applyClickDirective(state, line, lineNumber)) {
      continue;
    }

    const linkStyleMatch = parseLinkStyleLine(line);
    if (linkStyleMatch) {
      linkStyleMatch.indices.forEach((index) => state.linkStyles.set(index, linkStyleMatch.style));
      continue;
    }

    if (applyEdgeProperties(state, line)) {
      continue;
    }

    if (parseEdgeDeclaration(state, line, lineNumber)) {
      continue;
    }

    if (parseStateDiagramNodeDeclaration(state, line)) {
      continue;
    }

    const standalone = parseNodeDeclaration(line);
    if (standalone) {
      const id = registerMermaidNode(state, line);
      // A bare id listed inside a subgraph joins it when nothing has claimed it yet (`A --> B` first, then `subgraph G` / `A` / `end`).
      const listed = id ? state.nodesMap.get(id) : undefined;
      const group = state.parentStack[state.parentStack.length - 1];
      if (listed && group && !listed.parentId) listed.parentId = group;
      continue;
    }

    if (state.diagramType === 'flowchart') {
      state.diagnostics.push(`Unrecognized flowchart line at line ${lineNumber}: "${line}"`);
    }
  }

  if (state.diagramType === 'flowchart' && state.parentStack.length > 0) {
    state.diagnostics.push(
      `Unclosed flowchart block detected (${state.parentStack.length} block(s) not closed).`
    );
  }

  return toMermaidParseModel(state);
}

export function parseMermaid(input: string): ParseResult {
  const model = buildMermaidParseModel(preprocessMermaidInput(input));

  if (model.diagramType === 'unknown') {
    return {
      nodes: [],
      edges: [],
      error: 'Missing chart type declaration. Start with "flowchart TD" or related.',
    };
  }

  if (model.nodesMap.size === 0) {
    return { nodes: [], edges: [], error: 'No valid nodes found.' };
  }

  return {
    nodes: createFlowNodes(model),
    edges: createFlowEdges(model),
    direction: model.direction,
    diagnostics: model.diagnostics.length > 0 ? model.diagnostics : undefined,
  };
}
