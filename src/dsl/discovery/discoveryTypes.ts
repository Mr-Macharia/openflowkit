

export interface DiscoveryEvidence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export type DiscoveredUnitKind = 'system' | 'container' | 'store' | 'queue' | 'external';

export interface DiscoveredUnit {
  readonly id: string;
  readonly name: string;
  readonly kind: DiscoveredUnitKind;
  readonly tech?: string;
  readonly evidence: readonly DiscoveryEvidence[];
  readonly dir: string;
  /** `dir` holds the unit's code (a Dockerfile, a manifest, a compose build), not only the yaml that deploys it. */
  readonly code?: true;
  /** A package nothing deploys or starts (a monorepo's shared code, its workspace root): drawn after the services. */
  readonly library?: true;
  /** Under an `examples/`, `samples/` or `example-apps/` folder: a sample of the system, not part of it. */
  readonly example?: true;
}

export interface DiscoveredRelation {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface ArchitectureDiscovery {
  readonly units: readonly DiscoveredUnit[];
  readonly relations: readonly DiscoveredRelation[];
  readonly languages: Readonly<Record<string, number>>;
  readonly evidenceCount: number;
}
