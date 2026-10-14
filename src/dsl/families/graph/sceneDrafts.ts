import type { DslDirection, DslStatement } from '../../ast';
import type { CanonicalAttribute } from '../../sceneMeta';

export interface GraphInput {
  readonly statements: readonly DslStatement[];
  readonly family: string;
  /** Authored direction; effective direction arrives on the context. */
  readonly authoredDirection?: DslDirection;
}


export const RESERVED_SHAPE: Readonly<Record<string, string>> = {
  person: 'person', store: 'cylinder', queue: 'queue', component: 'component',
  system: 'rect', container: 'rect', external: 'rect', node: 'rect', instance: 'rect',
};

export interface GroupDraft {
  id: string;
  label: string;
  parentId: string | null;
  line: number;
  entries: CanonicalAttribute[];
  reservedKind?: string;
  comments: string[];
}

export interface NodeDraft {
  id: string;
  name: string;
  parentId: string | null;
  line: number;
  entries: CanonicalAttribute[];
  reservedKind?: string;
  comments: string[];
}

export interface EdgeDraft {
  sourceId: string;
  targetId: string;
  arrow: '->' | '-->' | '<->' | '<-->' | '--';
  label?: string;
  line: number;
  entries: CanonicalAttribute[];
  comments: string[];
}

