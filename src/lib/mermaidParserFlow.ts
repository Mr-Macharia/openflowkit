import { MarkerType } from '@/lib/reactflowCompat';
import { createId } from '@/lib/id';
import { SECTION_MIN_HEIGHT, SECTION_MIN_WIDTH } from '@/lib/sectionBounds';
import { setNodeParent } from './nodeParent';
import type { MermaidParseModel } from './mermaidParserModel';
import type { FlowEdge, FlowNode } from './types';

// v1's edge defaults: the importer still builds v1-shaped edges before they convert.
const DEFAULT_EDGE_OPTIONS = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed },
  animated: false,
  style: { stroke: '#94a3b8', strokeWidth: 2 },
  labelStyle: { fill: '#334155', fontWeight: 500, fontSize: 12 },
  labelBgStyle: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1 },
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 4,
};

const createDefaultEdge = (source: string, target: string, label?: string, id?: string): FlowEdge => ({
  id: id || createId(`e-${source}-${target}`),
  source,
  target,
  label,
  ...DEFAULT_EDGE_OPTIONS,
});

const NODE_TYPE_DEFAULTS: Record<string, string> = {
  start: 'emerald',
  end: 'red',
  decision: 'amber',
  custom: 'violet',
  process: 'slate',
};

function getDefaultColor(type: string): string {
  return NODE_TYPE_DEFAULTS[type] || 'slate';
}

export function createFlowNodes(model: MermaidParseModel): FlowNode[] {
  return Array.from(model.nodesMap.values()).map((node) => {
    // Position is a placeholder — the SVG extraction pipeline (extractMermaidLayout /
    // buildOfficialFlowchartImportGraph) will overwrite these with real Mermaid-rendered
    // positions. Using {0,0} rather than an index-based grid avoids polluting the
    // node-ID reconciliation logic with positions that look meaningful but aren't.
    let flowNode: FlowNode = {
      id: node.id,
      type: node.type,
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        subLabel: node.description ?? '',
        color: getDefaultColor(node.type),
        ...(node.shape ? { shape: node.shape } : {}),
        ...(node.subroutine ? { mermaidSubroutine: true } : {}),
        ...(node.link ? { link: node.link } : {}),
        ...(node.metadata?.sectionMermaidId
          ? { sectionMermaidId: node.metadata.sectionMermaidId }
          : {}),
        ...(node.metadata?.sectionMermaidTitle
          ? { sectionMermaidTitle: node.metadata.sectionMermaidTitle }
          : {}),
        ...(node.metadata?.sectionMermaidDirection
          ? { sectionMermaidDirection: node.metadata.sectionMermaidDirection }
          : {}),
      },
      ...(node.type === 'section'
        ? {
            style: { width: SECTION_MIN_WIDTH, height: SECTION_MIN_HEIGHT },
          }
        : {}),
    };

    if (node.parentId) {
      flowNode = setNodeParent(flowNode, node.parentId, {
        constrainToParent: false,
      });
    }

    if (node.classes) {
      node.classes.forEach((cls) => {
        const styles = model.classDefs.get(cls);
        if (!styles) {
          return;
        }
        if (styles.fill) {
          flowNode.style = { ...flowNode.style, backgroundColor: styles.fill };
        }
        if (styles.stroke) {
          flowNode.style = { ...flowNode.style, borderColor: styles.stroke };
        }
        if (styles.color) {
          flowNode.style = { ...flowNode.style, color: styles.color };
        }
      });
    }

    if (node.styles) {
      if (node.styles.fill) {
        flowNode.style = { ...flowNode.style, backgroundColor: node.styles.fill };
      }
      if (node.styles.stroke) {
        flowNode.style = { ...flowNode.style, borderColor: node.styles.stroke };
      }
      if (node.styles.color) {
        flowNode.style = { ...flowNode.style, color: node.styles.color };
      }
    }

    if (model.diagramType === 'stateDiagram') {
      if (node.type === 'start') {
        flowNode.style = {
          ...flowNode.style,
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: '#000',
        };
        flowNode.data.label = '';
      }
      if (node.type === 'state') {
        flowNode.data.shape = 'rounded';
      }
    }

    return flowNode;
  });
}

export function createFlowEdges(model: MermaidParseModel): FlowEdge[] {
  return model.rawEdges.map((edge, index) => {
    const flowEdge = createDefaultEdge(
      edge.source,
      edge.target,
      edge.label || undefined,
      `e-mermaid-${index}`
    );

    // `~~~` positions its ends like a link but draws nothing.
    if (edge.arrowType === '~~~') {
      flowEdge.style = { ...flowEdge.style, stroke: 'transparent' };
    }
    if (edge.arrowType.includes('-.') || edge.arrowType.includes('-.-')) {
      flowEdge.style = { ...flowEdge.style, strokeDasharray: '5 3' };
    }
    if (edge.arrowType.includes('==')) {
      flowEdge.style = { ...flowEdge.style, strokeWidth: 4 };
    }
    if (edge.arrowType.startsWith('<')) {
      flowEdge.markerStart = { type: MarkerType.ArrowClosed };
    }
    if (!edge.arrowType.includes('>')) {
      flowEdge.markerEnd = undefined;
    }
    // `--o` / `--x` end in a circle or cross; `o--o` / `x--x` at both ends.
    const markerKind = (end: string | undefined) => (end === 'o' ? 'circle' : end === 'x' ? 'cross' : undefined);
    const head = markerKind(edge.arrowType.at(-1));
    const tail = markerKind(edge.arrowType[0]);
    if (head || tail || edge.animate) {
      flowEdge.data = { ...flowEdge.data, ...(head ? { head } : {}), ...(tail ? { tail } : {}), ...(edge.animate ? { animate: true } : {}) };
    }

    const style = model.linkStyles.get(index);
    if (style) {
      if (style.stroke) {
        flowEdge.style = { ...flowEdge.style, stroke: style.stroke };
        // Authored, unlike the default stroke every edge carries.
        flowEdge.data = { ...flowEdge.data, linkStroke: style.stroke };
      }
      if (style['stroke-width']) {
        flowEdge.style = {
          ...flowEdge.style,
          strokeWidth: parseInt(style['stroke-width'], 10) || 2,
        };
      }
    }

    return flowEdge;
  });
}
