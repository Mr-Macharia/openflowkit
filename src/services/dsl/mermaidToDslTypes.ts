import type { DslDiagnostic } from '../../dsl/ast';

export interface MermaidConversion {
  dsl: string;
  /** One line per construct the DSL cannot express. */
  losses: string[];
  /** W180 per loss; E004 per Mermaid line that could not be read — then the caller keeps the Mermaid text. */
  diagnostics: DslDiagnostic[];
}

/** An adapter's result; mermaidToDsl attaches the diagnostics. */
export type Converted = Omit<MermaidConversion, 'diagnostics'> & { readonly lossLines?: readonly number[]; readonly errors?: readonly DslDiagnostic[] };

export interface MermaidConversionError {
  error: string;
}

/** Structural view of the mermaid services' graph model (no runtime dependency). */
export interface FlowNodeStyle {
  width?: number;
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}

export interface FlowNodeData {
  /** A class's `namespace` blocks, outermost first. */
  classNamespace?: readonly string[];
  label?: string;
  subLabel?: string;
  shape?: string;
  color?: string;
  seqParticipantKind?: string;
  seqParticipantStereotype?: string;
  seqParticipantMermaidType?: string;
  /** Flowchart `id[[Label]]`. */
  mermaidSubroutine?: boolean;
  /** Flowchart `click id "url"`. */
  link?: string;
  seqParticipantAlias?: string;
  seqNoteTarget?: string;
  seqNoteTargets?: string[];
  seqNotePosition?: string;
  seqMessageOrder?: number;
  seqFragment?: { type?: string; condition?: string; branchKind?: string };
  erFields?: unknown;
  classStereotype?: string;
  classFill?: string;
  classAttributes?: string[];
  classMethods?: string[];
  stateControlKind?: string;
  mindmapDepth?: number;
  mindmapWrapper?: string;
  mindmapUnmappedShape?: string;
  mindmapParentId?: string;
  archTitle?: string;
  archProvider?: string;
  archResourceType?: string;
}

export interface FlowNode {
  id: string;
  type?: string;
  parentId?: string;
  data?: FlowNodeData;
  style?: FlowNodeStyle;
}

export interface FlowEdgeData {
  /** A flowchart `linkStyle` stroke. */
  linkStroke?: string;
  /** Flowchart `--o` / `--x` ends, and `id@{ animate: true }`. */
  head?: 'circle' | 'cross';
  tail?: 'circle' | 'cross';
  animate?: boolean;
  seqMessageKind?: string;
  seqMessageOrder?: number;
  seqFragment?: { type?: string; condition?: string; branchKind?: string };
  erRelation?: string;
  archSourceSide?: string;
  archTargetSide?: string;
  classRelation?: string;
  classRelationSourceCardinality?: string;
  classRelationTargetCardinality?: string;
  classRelationLabel?: string;
}

export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
  markerStart?: unknown;
  markerEnd?: unknown;
  style?: { stroke?: string; strokeDasharray?: string; strokeWidth?: number };
  data?: FlowEdgeData;
}
