import { LANGUAGE_BY_EXT, extname, type ScannedFile } from './rules';
import type { ArchitectureDiscovery, DiscoveredRelation, DiscoveredUnitKind } from './discoveryTypes';
import {
  KIND_RANK, imageBase, kindGroup, normalizeName, pushEvidence, unitId,
  type RelationDraft, type TargetRef, type UnitDraft, type UnitInput,
} from './discoveryShared';

/** Sample apps beside the product (supabase's `examples/`, cal.com's `example-apps/`): read, but drawn last. */
const EXAMPLE_DIR = /(?:^|\/)(?:examples?|samples?|example-apps)(?:\/|$)/i;

export class Builder {
  private readonly units = new Map<string, UnitDraft>();
  private readonly relations: RelationDraft[] = [];
  private readonly manifestIds = new Map<string, string>();
  /** A unit's own names: a second unit by one of them is the same service. */
  private readonly nameIds = new Map<string, string>();
  /** Other names it answers to (a deployed unit's package, a store's product): for resolving only. */
  private readonly aliasIds = new Map<string, string>();
  private counter = 0;
  private relationCounter = 0;

  /**
   * A manifest is the unit of its directory: `Dockerfile` + `package.json` in
   * one folder describe one deployable, even when their names differ. Package
   * metadata beats a Dockerfile's base image for name and tech.
   */
  manifest(input: UnitInput): UnitDraft {
    const existingId = this.manifestIds.get(input.dir);
    const existing = existingId ? this.units.get(existingId) : undefined;
    if (!existing) {
      const draft = this.unit({ ...input, code: true });
      this.manifestIds.set(input.dir, draft.id);
      return draft;
    }
    if (input.runs) existing.runs = true;
    if (input.packageName && input.eco) existing.packages[input.eco] ??= input.packageName;
    if (!existing.image && input.image) existing.image = input.image;
    // A manifest in another language is tooling beside the app (gitea's linting pyproject, a Go server's
    // frontend package.json): it neither renames nor re-labels it.
    if (existing.eco && input.eco && existing.eco !== input.eco) return existing;
    existing.eco ??= input.eco;
    if (input.packageName) {
      // Other services call a deployed unit by its deploy name; the package name is an alias.
      if (existing.deployed) this.alias(existing, input.name);
      else this.rename(existing, input.name);
      this.label(existing, input, true);
    } else {
      this.label(existing, input);
    }
    return existing;
  }

  /**
   * A compose service that builds a folder is that folder's unit (`seed` builds `./seed-data`), named as compose
   * calls it. The first service to build a folder claims it; another building the same one (a worker on the api's
   * image) stays its own container, at the compose file as before.
   */
  built(input: UnitInput, composeDir: string): UnitDraft {
    const existingId = this.manifestIds.get(input.dir);
    const existing = existingId ? this.units.get(existingId) : undefined;
    if (existing?.deployed) return this.unit({ ...input, id: unitId(composeDir, input.name), dir: composeDir });
    if (existing) return this.absorb(existing, { ...input, code: true });
    const draft = this.unit({ ...input, code: true });
    this.manifestIds.set(input.dir, draft.id);
    return draft;
  }

  /** `input`'s tech, when it says more than what the unit has (`examplevotingapp_vote` < Python < Flask); `force` for a manifest's own. */
  private label(draft: UnitDraft, input: UnitInput, force = false): void {
    const rank = input.techRank ?? 2;
    if (!input.tech || (!force && draft.tech && rank <= (draft.techRank ?? 2))) return;
    draft.tech = input.tech;
    draft.techRank = rank;
  }

  /**
   * One unit per service, however many files name it: the same `frontend` in
   * k8s, kustomize, a release bundle and `src/frontend` is merged by name.
   */
  unit(input: UnitInput): UnitDraft {
    const nameMatchId = this.nameIds.get(this.nameKey(input.kind, input.name));
    const named = nameMatchId && nameMatchId !== input.id ? this.units.get(nameMatchId) : undefined;
    // Two folders of code are two services, whatever their packages are called.
    const sameService = named && !(input.code && named.code && input.dir !== named.dir) ? named : undefined;
    const match = sameService ?? this.units.get(input.id);
    if (match) return this.absorb(match, input);
    const { packageName, ...rest } = input;
    const draft: UnitDraft = { ...rest, packages: packageName && input.eco ? { [input.eco]: packageName } : {}, evidence: [], order: this.counter++ };
    this.units.set(draft.id, draft);
    this.rename(draft, input.name);
    return draft;
  }

  /** `input` names a unit already drawn: fold what it adds into it. */
  private absorb(match: UnitDraft, input: UnitInput): UnitDraft {
    // The directory with the service's code wins over its deploy yaml (then
    // the deeper one), so imports get an owner.
    if (input.code && !match.code) {
      match.dir = input.dir;
      match.code = true;
    } else if (Boolean(input.code) === Boolean(match.code) && input.dir.length > match.dir.length) {
      match.dir = input.dir;
    }
    if (input.deployed && !match.deployed) {
      this.rename(match, input.name);
      match.deployed = true;
    }
    if (input.runs) match.runs = true;
    this.label(match, input);
    match.eco ??= input.eco;
    if (!match.image && input.image) match.image = input.image;
    if (input.packageName && input.eco) match.packages[input.eco] ??= input.packageName;
    if (KIND_RANK[input.kind] < KIND_RANK[match.kind]) match.kind = input.kind;
    return match;
  }

  /** The unit that answers to `name` (own name first, then an alias), in one kind group. */
  named(kind: DiscoveredUnitKind, name: string): UnitDraft | undefined {
    const key = this.nameKey(kind, name);
    const id = this.nameIds.get(key) ?? this.aliasIds.get(key);
    return id ? this.units.get(id) : undefined;
  }

  alias(draft: UnitDraft, name: string): void {
    const key = this.nameKey(draft.kind, name);
    if (!this.aliasIds.has(key)) this.aliasIds.set(key, draft.id);
  }

  private nameKey(kind: DiscoveredUnitKind, name: string): string {
    return `${kindGroup(kind)}:${normalizeName(name)}`;
  }

  private rename(draft: UnitDraft, name: string): void {
    draft.name = name;
    const key = this.nameKey(draft.kind, name);
    if (!this.nameIds.has(key)) this.nameIds.set(key, draft.id);
  }

  relation(from: string, to: TargetRef, label: string | undefined, file: string, line: number, text: string): void {
    let draft = this.relations.find((entry) =>
      entry.from === from && entry.label === label
      && entry.toRef.id === to.id && entry.toRef.name === to.name && entry.toRef.image === to.image);
    if (!draft) {
      draft = { from, toRef: to, ...(label ? { label } : {}), evidence: [], order: this.relationCounter++ };
      this.relations.push(draft);
    }
    pushEvidence(draft, file, line, text);
  }

  all(): readonly UnitDraft[] {
    return [...this.units.values()].sort((a, b) => a.order - b.order);
  }

  resolve(ref: TargetRef, excludeId: string): UnitDraft | undefined {
    if (ref.id) {
      const byId = this.units.get(ref.id);
      if (byId) return byId;
    }
    const wanted = ref.name ? normalizeName(ref.name) : '';
    const wantedImage = ref.image ? imageBase(ref.image) : '';
    for (const key of wanted ? [`app:${wanted}`, `data:${wanted}`] : []) {
      const id = this.nameIds.get(key) ?? this.aliasIds.get(key);
      if (id && id !== excludeId) return this.units.get(id);
    }
    for (const unit of this.all()) {
      if (unit.id === excludeId) continue;
      if (wanted && normalizeName(unit.name) === wanted) return unit;
      if (wantedImage && unit.image && imageBase(unit.image) === wantedImage) return unit;
      if (wantedImage && normalizeName(unit.name) === normalizeName(wantedImage)) return unit;
    }
    return undefined;
  }

  finish(rootFiles: readonly ScannedFile[]): ArchitectureDiscovery {
    const units = this.all();
    const resolved: DiscoveredRelation[] = [];
    for (const draft of this.relations.sort((a, b) => a.order - b.order)) {
      const target = this.resolve(draft.toRef, draft.from);
      if (!target || target.id === draft.from) continue;
      resolved.push({
        from: draft.from,
        to: target.id,
        ...(draft.label ? { label: draft.label } : {}),
        evidence: draft.evidence,
      });
    }
    const languages: Record<string, number> = {};
    for (const file of rootFiles) {
      const language = LANGUAGE_BY_EXT[extname(file.path).toLowerCase()];
      if (language) languages[language] = (languages[language] ?? 0) + 1;
    }
    return {
      units: units.map((unit) => ({
        id: unit.id, name: unit.name, kind: unit.kind, dir: unit.dir,
        ...(unit.tech ? { tech: unit.tech } : {}),
        evidence: unit.evidence,
        ...(unit.code ? { code: true as const } : {}),
        ...(unit.code && !unit.runs && !unit.deployed && kindGroup(unit.kind) === 'app' ? { library: true as const } : {}),
        ...(EXAMPLE_DIR.test(unit.dir) ? { example: true as const } : {}),
      })),
      relations: resolved,
      languages,
      evidenceCount: units.reduce((total, unit) => total + unit.evidence.length, 0)
        + resolved.reduce((total, relation) => total + relation.evidence.length, 0),
    };
  }
}
