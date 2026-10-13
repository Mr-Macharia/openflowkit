import type { LegacyEdge, LegacyNode } from '@/lib/reactflowCompat';
import type { ClassRelationToken, ERRelationToken } from '@/lib/relationSemantics';
import type { NodeContentLayoutV1 } from '@/opencanvas/domain/node-layout/types';

export interface ErField {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNotNull?: boolean;
  isUnique?: boolean;
  referencesTable?: string;
  referencesField?: string;
}

export const DIAGRAM_TYPES = [
  'flowchart',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
  'mindmap',
  'journey',
  'architecture',
  'sequence',
] as const;

export type DiagramType = (typeof DIAGRAM_TYPES)[number];

type MermaidImportMode = 'native_editable' | 'renderer_first';

interface NodeLabelData {
  label: string;
  subLabel?: string; // Supports Markdown
}

interface NodeIconData {
  icon?: string; // Key for the icon map
  secondaryIcon?: string; // Optional secondary icon key
  customIconUrl?: string; // User-uploaded icon (base64, URL, or legacy inline)
  /** Content-addressed ref into the IndexedDB assets store (preferred over customIconUrl). */
  iconAssetId?: string;
  imageUrl?: string; // Base64, URL, or legacy inline
  /** Content-addressed ref into the IndexedDB assets store (preferred over imageUrl). */
  imageAssetId?: string;
  mermaidSvg?: string; // Rendered Mermaid SVG markup
}

interface NodeVisualStyleData {
  color?: string; // Preset color key (e.g., 'white', 'blue', 'custom')
  colorMode?: 'subtle' | 'filled';
  customColor?: string; // Hex color for the "custom" preset
  align?: 'left' | 'center' | 'right';
  shape?:
    | 'rectangle'
    | 'rounded'
    | 'capsule'
    | 'diamond'
    | 'hexagon'
    | 'cylinder'
    | 'ellipse'
    | 'parallelogram'
    | 'circle';
  rotation?: number;
  width?: number;
  height?: number;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string; // 'normal', 'bold', '100'-'900'
  fontStyle?: string; // 'normal', 'italic'
  subLabelFontSize?: string;
  subLabelFontFamily?: string;
  subLabelFontWeight?: string; // 'normal', 'bold', '100'-'900'
  subLabelFontStyle?: string; // 'normal', 'italic'
  backgroundColor?: string;
  transparency?: number; // 0-1
  variant?: string; // wireframe preset key (e.g. 'landing', 'modal')
  contentLayout?: NodeContentLayoutV1;
}

interface NodeCanvasMetadata {
  layerId?: string; // layer identifier for visibility/lock/group operations
  rotation?: number;
  width?: number;
  height?: number;
  // When true, auto-layout treats this node as a fixed anchor — its position is
  // preserved and other nodes are arranged around it.
  pinned?: boolean;
}

interface ClassNodeData {
  classStereotype?: string;
  classAttributes?: string[];
  classMethods?: string[];
}

interface EntityNodeData {
  erFields?: Array<string | ErField>;
}

interface JourneyNodeData {
  journeyTitle?: string;
  journeySection?: string;
  journeyActor?: string;
  journeyTask?: string;
  journeyScore?: number;
}

interface MindmapNodeData {
  mindmapDepth?: number;
  mindmapParentId?: string;
  mindmapAlias?: string;
  mindmapWrapper?:
    | 'double-circle'
    | 'double-square'
    | 'stadium'
    | 'subroutine'
    | 'square'
    | 'rounded'
    | 'hexagon';
  mindmapSide?: 'left' | 'right';
  mindmapBranchStyle?: 'curved' | 'straight';
  mindmapCollapsed?: boolean;
}

interface ArchitectureNodeData {
  archTitle?: string;
  archProvider?: string;
  archProviderLabel?: string;
  archResourceType?: string;
  archEnvironment?: string;
  archBoundaryId?: string;
  archLayerRank?: number;
  archLayerLabel?: string;
  archZone?: string;
  archTrustDomain?: string;
  archIconPackId?: string;
  archIconShapeId?: string;
  assetPresentation?: 'icon';
  assetProvider?: string;
  assetCategory?: string;
}

interface SequenceNodeData {
  seqParticipantKind?: 'participant' | 'actor';
  seqParticipantAlias?: string;
  seqMessageKind?: 'sync' | 'async' | 'return' | 'self' | 'create' | 'destroy';
  seqMessageFrom?: string;
  seqMessageTo?: string;
  seqMessageOrder?: number;
  seqActivations?: Array<{
    order: number;
    activate: boolean;
  }>;
  seqNoteTarget?: string;
  seqNotePosition?: 'over' | 'left' | 'right';
  seqFragment?: {
    type: 'alt' | 'loop' | 'opt' | 'par' | 'break' | 'critical';
    condition: string;
    branchKind?: 'start' | 'else' | 'and' | 'option';
    edgeIds: string[];
  } | null;
  seqFragmentId?: string;
}

interface SectionNodeData {
  sectionSizingMode?: 'manual' | 'fit';
  sectionLayoutMode?: 'freeform';
  sectionOrder?: number;
  sectionLocked?: boolean;
  sectionHidden?: boolean;
  sectionCollapsed?: boolean;
  sectionMermaidId?: string;
  sectionMermaidTitle?: string;
  /** A subgraph's own `direction` line (TB, LR, RL, BT). */
  sectionMermaidDirection?: string;
}

interface MermaidSvgNodeData {
  mermaidSource?: string;
  mermaidViewBox?: string;
  mermaidImportMode?: MermaidImportMode;
  mermaidRendererTheme?: 'default';
  linkedEditableGraphId?: string;
}

export interface NodeData
  extends
    NodeLabelData,
    NodeIconData,
    NodeVisualStyleData,
    NodeCanvasMetadata,
    ClassNodeData,
    EntityNodeData,
    JourneyNodeData,
    MindmapNodeData,
    ArchitectureNodeData,
    SequenceNodeData,
    SectionNodeData,
    MermaidSvgNodeData {
  [key: string]: unknown;
}

export type FlowNode = LegacyNode<NodeData>;

export interface EdgeData {
  [key: string]: unknown;
  routingMode?: 'auto' | 'elk' | 'manual' | 'import-fixed';
  condition?: EdgeCondition;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelPosition?: number; // 0 to 1, default 0.5
  strokeWidth?: number; // 1-6, default 2
  dashPattern?: 'solid' | 'dashed' | 'dotted' | 'dashdot';
  opacity?: number; // 0-1, default 1
  archProtocol?: string;
  archPort?: string;
  archDirection?: '-->' | '<--' | '<-->' | '--';
  archSourceSide?: 'L' | 'R' | 'T' | 'B';
  archTargetSide?: 'L' | 'R' | 'T' | 'B';
  classRelation?: ClassRelationToken;
  classRelationLabel?: string;
  erRelation?: ERRelationToken;
  erRelationLabel?: string;
  elkPoints?: {
    x: number;
    y: number;
  }[];
  importRoutePoints?: {
    x: number;
    y: number;
  }[];
  importRoutePath?: string;
  mindmapBranchKind?: 'root' | 'branch';
  seqMessageKind?: 'sync' | 'async' | 'return' | 'self' | 'create' | 'destroy';
  connectionType?: 'fixed' | 'dynamic';
  seqFragment?: {
    type: 'alt' | 'loop' | 'opt' | 'par' | 'break' | 'critical';
    condition: string;
    branchKind?: 'start' | 'else' | 'and' | 'option';
    edgeIds: string[];
  } | null;
  waypoint?: {
    x: number;
    y: number;
  };
  waypoints?: {
    x: number;
    y: number;
  }[];
  /** Visual curve interpolation override (basis, linear, smoothstep, ...). Falls back to diagram-level setting. */
  curve?: import('./edgeCurve').EdgeCurve;
  animation?: EdgeAnimationConfig;
}

export type FlowEdge = LegacyEdge<EdgeData>;

interface EdgeAnimationConfig {
  enabled?: boolean;
  state?: 'idle' | 'active';
  style?: 'flow';
  durationMs?: number;
  dashArray?: string;
}

type EdgeCondition = 'default' | 'yes' | 'no' | 'success' | 'error' | 'timeout';
