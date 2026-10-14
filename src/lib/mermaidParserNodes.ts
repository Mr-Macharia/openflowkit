import type { NodeData } from './types';

export const MERMAID_NODE_ID_RE_SOURCE = '[a-zA-Z0-9_][\\w.-]*';
export const MERMAID_NODE_ID_RE = new RegExp(`^${MERMAID_NODE_ID_RE_SOURCE}$`);

const SHAPE_OPENERS: Array<{
  open: string;
  close: string;
  type: string;
  shape: NodeData['shape'];
}> = [
  { open: '([', close: '])', type: 'start', shape: 'capsule' },
  { open: '(((', close: ')))', type: 'end', shape: 'circle' },
  { open: '((', close: '))', type: 'end', shape: 'circle' },
  { open: '{{', close: '}}', type: 'custom', shape: 'hexagon' },
  { open: '[(', close: ')]', type: 'process', shape: 'cylinder' },
  { open: '[[', close: ']]', type: 'process', shape: 'rectangle' },
  // ponytail: mermaid's four slanted brackets all land on `parallelogram` —
  // the shape union has no trapezoid; add one when the renderer grows one.
  { open: '[/', close: '/]', type: 'process', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', type: 'process', shape: 'parallelogram' },
  { open: '[/', close: '\\]', type: 'process', shape: 'parallelogram' },
  { open: '[\\', close: '/]', type: 'process', shape: 'parallelogram' },
  { open: '{', close: '}', type: 'decision', shape: 'diamond' },
  { open: '[', close: ']', type: 'process', shape: 'rectangle' },
  { open: '(', close: ')', type: 'process', shape: 'rounded' },
  { open: '>', close: ']', type: 'process', shape: 'parallelogram' },
];

export interface RawNode {
  id: string;
  label: string;
  type: string;
  shape?: NodeData['shape'];
  parentId?: string;
  styles?: Record<string, string>;
  classes?: string[];
  /** `id[[Label]]`: the DSL's `component`. */
  subroutine?: boolean;
  /** `click id "url"`. */
  link?: string;
  /** A state's `id : text` under a name it already has. */
  description?: string;
  metadata?: {
    sectionMermaidId?: string;
    sectionMermaidTitle?: string;
    sectionMermaidDirection?: string;
  };
}

const MODERN_SHAPE_MAP: Record<string, { type: string; shape: NodeData['shape'] }> = {
  cyl: { type: 'process', shape: 'cylinder' },
  cylinder: { type: 'process', shape: 'cylinder' },
  circle: { type: 'end', shape: 'circle' },
  circle2: { type: 'end', shape: 'circle' },
  cloud: { type: 'process', shape: 'rounded' },
  diamond: { type: 'decision', shape: 'diamond' },
  hexagon: { type: 'custom', shape: 'hexagon' },
  'lean-r': { type: 'process', shape: 'parallelogram' },
  'lean-l': { type: 'process', shape: 'parallelogram' },
  stadium: { type: 'start', shape: 'capsule' },
  rounded: { type: 'process', shape: 'rounded' },
  rect: { type: 'process', shape: 'rectangle' },
  square: { type: 'process', shape: 'rectangle' },
  doublecircle: { type: 'end', shape: 'circle' },
};

interface ModernShapeAnnotation {
  shapeKey?: string;
  labelOverride?: string;
  cleanInput: string;
}

function extractModernAnnotation(input: string): ModernShapeAnnotation {
  const match = input.match(/^([a-zA-Z0-9_][\w.-]*)@\{([^}]+)\}/);
  if (!match) return { cleanInput: input };

  const id = match[1];
  const attrs = match[2];
  const rest = input.substring(match[0].length);

  const shapeMatch = attrs.match(/\bshape:\s*(\w+)/);
  const labelMatch = attrs.match(/\blabel:\s*"([^"]+)"/);

  return {
    shapeKey: shapeMatch?.[1]?.toLowerCase(),
    labelOverride: labelMatch?.[1],
    cleanInput: `${id}${rest}`,
  };
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', hash: '#', semi: ';' };

/** Label text as Mermaid shows it: `\n` and `<br>`/`<br/>` break the line; `#quot;` and `#9829;` are entity codes. */
export function labelText(label: string): string {
  return label
    .replace(/\\n|<br\s*\/?>/gi, '\n')
    .replace(/#(\d+);/g, (code, digits: string) => (Number(digits) <= 0x10ffff ? String.fromCodePoint(Number(digits)) : code))
    .replace(/#([a-z]+);/gi, (code, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? code);
}

function stripMarkdown(label: string): string {
  return label
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

function stripFaIcons(label: string): string {
  const stripped = label.replace(/fa:fa-[\w-]+\s*/g, '').trim();
  if (stripped) return stripped;
  const iconMatch = label.match(/fa:fa-([\w-]+)/);
  return iconMatch ? iconMatch[1].replace(/-/g, ' ') : label;
}

function tryParseWithShape(
  input: string,
  shape: { open: string; close: string; type: string; shape: NodeData['shape'] }
): RawNode | null {
  const openIndex = input.indexOf(shape.open);
  if (openIndex < 1) return null;
  if (openIndex > 0 && input[openIndex - 1] === shape.open[0]) return null;

  const id = input.substring(0, openIndex).trim();
  if (!MERMAID_NODE_ID_RE.test(id)) return null;

  const afterOpen = input.substring(openIndex + shape.open.length);
  const closeIndex = afterOpen.lastIndexOf(shape.close);
  if (closeIndex < 0) return null;

  const afterClose = afterOpen.substring(closeIndex + shape.close.length).trim();
  let classes: string[] = [];
  if (afterClose.startsWith(':::')) {
    classes = afterClose.substring(3).split(/,\s*/);
  } else if (afterClose) {
    return null;
  }

  let label = afterOpen.substring(0, closeIndex).trim();
  if (
    (label.startsWith('"') && label.endsWith('"')) ||
    (label.startsWith("'") && label.endsWith("'"))
  ) {
    label = label.slice(1, -1);
  }
  label = labelText(label);
  label = stripFaIcons(label);
  label = stripMarkdown(label);
  if (!label) label = id;

  return {
    id,
    label,
    type: shape.type,
    shape: shape.shape,
    ...(shape.open === '[[' ? { subroutine: true } : {}),
    classes: classes.length ? classes : undefined,
  };
}

export function parseNodeDeclaration(raw: string): RawNode | null {
  const trimmed = raw.trim().replace(/;$/, '');
  if (!trimmed) return null;

  const annotation = extractModernAnnotation(trimmed);
  const input = annotation.cleanInput;

  for (const shape of SHAPE_OPENERS) {
    const result = tryParseWithShape(input, shape);
    if (result) {
      if (annotation.shapeKey && MODERN_SHAPE_MAP[annotation.shapeKey]) {
        const override = MODERN_SHAPE_MAP[annotation.shapeKey];
        result.type = override.type;
        result.shape = override.shape;
      }
      if (annotation.labelOverride) {
        result.label = annotation.labelOverride;
      }
      result.label = stripMarkdown(result.label);
      return result;
    }
  }

  let id = input;
  let classes: string[] = [];
  if (id.includes(':::')) {
    const parts = id.split(':::');
    id = parts[0];
    classes = parts[1].split(/,\s*/);
  }

  if (MERMAID_NODE_ID_RE.test(id)) {
    const override = annotation.shapeKey ? MODERN_SHAPE_MAP[annotation.shapeKey] : undefined;

    return {
      id,
      label: stripMarkdown(annotation.labelOverride ?? id),
      type: override?.type ?? 'process',
      shape: override?.shape,
      classes: classes.length ? classes : undefined,
    };
  }

  return null;
}
