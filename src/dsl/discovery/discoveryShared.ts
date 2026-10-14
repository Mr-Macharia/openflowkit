import { NON_SYSTEM_DIRS, SERVICE_RULES, basename, dirname } from './rules';
import type { DiscoveredUnitKind, DiscoveryEvidence } from './discoveryTypes';

/** Findings carry at most this many evidence lines (grammar of the report). */
const MAX_EVIDENCE = 2;

/* ----------------------------------------------------------------- drafts */

/** The package ecosystems whose names imports match: a Python `import emails` never means a JS package `emails`. */
export type Ecosystem = 'js' | 'py' | 'go';

export interface UnitDraft {
  id: string;
  name: string;
  kind: DiscoveredUnitKind;
  dir: string;
  tech?: string;
  /** The language the unit's name and tech come from (its base image or first manifest). */
  eco?: Ecosystem;
  /** How much `tech` says: 0 an image's own name, 1 the language of a base image, 2 a manifest or a store. A better source replaces it. */
  techRank?: number;
  /** Published container image, for k8s/compose matching. */
  image?: string;
  /** Declared package/module names, for import matching. */
  packages: Partial<Record<Ecosystem, string>>;
  /** Named by compose or k8s: that name is what other services call it by. */
  deployed?: boolean;
  /** `dir` holds the unit's code (a Dockerfile or package manifest), not just its deploy yaml. */
  code?: boolean;
  /** Something builds, deploys or starts it; a package.json alone that does none of that is a library. */
  runs?: boolean;
  evidence: DiscoveryEvidence[];
  order: number;
}

export type UnitInput = Pick<UnitDraft, 'id' | 'name' | 'kind' | 'dir'>
  & Partial<Pick<UnitDraft, 'tech' | 'eco' | 'techRank' | 'image' | 'deployed' | 'code' | 'runs'>>
  & { packageName?: string };

export interface RelationDraft {
  from: string;
  toRef: { id?: string; name?: string; image?: string };
  label?: string;
  evidence: DiscoveryEvidence[];
  order: number;
}

export interface TargetRef {
  id?: string;
  name?: string;
  image?: string;
}

export const KIND_RANK: Readonly<Record<DiscoveredUnitKind, number>> = {
  system: 0, container: 1, store: 2, queue: 3, external: 4,
};

export function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export function scalar(value: string): string {
  return value.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
}

export function pushEvidence(target: { evidence: DiscoveryEvidence[] }, file: string, line: number, text: string): void {
  if (target.evidence.length >= MAX_EVIDENCE) return;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  if (target.evidence.some((entry) => entry.file === file && entry.line === line)) return;
  target.evidence.push({ file, line, text: trimmed.slice(0, 240) });
}

export function slugDiscoveryId(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unit';
}

function dirPrefix(dir: string): string {
  return dir.split('/').filter(Boolean).map(slugDiscoveryId).join('.');
}

/** Dotted slug path: `services/api` + `api` → `services.api`. */
export function unitId(dir: string, name: string): string {
  const prefix = dirPrefix(dir);
  const local = slugDiscoveryId(name);
  if (!prefix) return local;
  if (prefix === local || prefix.endsWith(`.${local}`)) return prefix;
  return `${prefix}.${local}`;
}

function firstSegment(dir: string): string {
  return dir.split('/')[0] ?? '';
}

/** The top-level folder that names a product system; generic and deploy folders name none. */
export function systemSegment(dir: string): string {
  const segment = firstSegment(dir);
  return NON_SYSTEM_DIRS.has(segment.toLowerCase()) ? '' : segment;
}

export function imageBase(image: string): string {
  const withoutTag = image.split('@')[0]!.split(':')[0]!;
  return withoutTag.split('/').pop() ?? withoutTag;
}

/** Base images named for what they run, and the package ecosystem that goes with it. */
// ponytail: the common language images only; any other image is labelled by its own name.
const IMAGE_LANGUAGES: Readonly<Record<string, readonly [string, Ecosystem?]>> = {
  node: ['Node', 'js'], bun: ['Bun', 'js'], deno: ['Deno', 'js'], python: ['Python', 'py'], golang: ['Go', 'go'],
  rust: ['Rust'], ruby: ['Ruby'], php: ['PHP'], elixir: ['Elixir'], erlang: ['Erlang'], swift: ['Swift'],
  openjdk: ['Java'], 'eclipse-temurin': ['Java'], amazoncorretto: ['Java'], gradle: ['Java'], maven: ['Java'],
};
/** OS and empty bases say nothing about the code. */
const BARE_IMAGES = new Set(['alpine', 'debian', 'ubuntu', 'busybox', 'scratch', 'distroless', 'centos', 'fedora', 'buildpack-deps']);

/**
 * A base image as the language it runs (`mcr.microsoft.com/dotnet/sdk` is .NET, `golang:1.23` is Go: rank 1), else
 * its own name (`traefik`: rank 0); nothing for a bare OS or a variable.
 */
export function imageTech(image: string): { tech?: string; eco?: Ecosystem; techRank?: number } {
  if (/(?:^|\/)dotnet\//.test(image)) return { tech: '.NET', techRank: 1 };
  const base = imageBase(image);
  const known = IMAGE_LANGUAGES[base];
  if (known) return { tech: known[0], techRank: 1, ...(known[1] ? { eco: known[1] } : {}) };
  return BARE_IMAGES.has(base) || base.includes('$') ? {} : { tech: base, techRank: 0 };
}

/** A compose image with its variables read: `${X:-postgres:16}` is its default, any other variable names nothing. */
export function composeImage(image: string): string | undefined {
  const fallback = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}$]+)\}$/.exec(image)?.[1];
  return fallback ?? (image.includes('$') ? undefined : image);
}

export function normalizeName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Unrendered Helm/Go template text names nothing real. */
export function isTemplated(value: string): boolean {
  return value.includes('{{');
}

/** Files that make their folder a package of its own. */
export const PACKAGE_MANIFESTS = new Set(['package.json', 'go.mod', 'pyproject.toml', 'requirements.txt', 'pom.xml']);

/**
 * `src/cartservice/src/Dockerfile` builds cartservice: a Dockerfile in a `src`
 * folder that is not a package itself belongs to the folder above. Never lifted
 * to the repo root, so a top-level `src/` stays its own unit.
 */
export function serviceDir(dir: string, packageDirs: ReadonlySet<string>): string {
  const parent = dirname(dir);
  return basename(dir) === 'src' && parent !== '.' && !packageDirs.has(dir) ? parent : dir;
}

const CLUSTER_SUFFIX = /^(?:[a-z0-9-]+\.)?svc(?:\.cluster\.local)?$/i;

/**
 * The services an env value addresses: `checkoutservice:5050`, `http://api:8080/v1`,
 * `postgres://user:pw@db:5432/app`, `cart.default.svc.cluster.local:7070`. A value
 * needs an address's shape (a scheme, `user@` or a `:port`), so a database name, a
 * role or `true` is never a call; a dotted host counts only with a cluster suffix,
 * so `api.openai.com` is not the local `api`.
 */
export function envHosts(value: string): string[] {
  return scalar(value).split(/[\s,;]+/).flatMap((part) => {
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(part)?.[0] ?? '';
    const user = /^[^@/]*@/.exec(part.slice(scheme.length))?.[0] ?? '';
    const [host = '', port] = part.slice(scheme.length + user.length).split(/[/?#]/)[0]!.split(':');
    if (!scheme && !user && !/^\d+$/.test(port ?? '')) return [];
    const [first = '', ...rest] = host.split('.');
    if (rest.length > 0 && !CLUSTER_SUFFIX.test(rest.join('.'))) return [];
    return /^[A-Za-z][A-Za-z0-9_-]*$/.test(first) ? [first] : [];
  });
}

/** Images that are a datastore or queue, by base name; a tool built on one (`redis-commander`) is not. */
// ponytail: a fixed list of the common images; add one when a repo's store shows up as a container.
const DATA_IMAGES: Readonly<Record<string, string>> = {
  redis: 'Redis', valkey: 'Redis', postgres: 'PostgreSQL', postgis: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MySQL',
  mongo: 'MongoDB', rabbitmq: 'RabbitMQ', kafka: 'Kafka', 'cp-kafka': 'Kafka', elasticsearch: 'Elasticsearch',
};

export function dataRuleOfImage(image: string): { name: string; kind: DiscoveredUnitKind } | undefined {
  const name = DATA_IMAGES[imageBase(image)];
  const rule = name ? SERVICE_RULES.find((entry) => entry.name === name) : undefined;
  return rule ? { name: rule.name, kind: serviceKind(rule.type, rule.provider) } : undefined;
}

/* ------------------------------------------------------------- discovery */

/** Deployables and data units can absorb a same-named unit; externals stay distinct. */
export function kindGroup(kind: DiscoveredUnitKind): string {
  if (kind === 'container' || kind === 'system') return 'app';
  if (kind === 'store' || kind === 'queue') return 'data';
  return 'other';
}

export function serviceKind(type: string, provider: string): DiscoveredUnitKind {
  if (type === 'database' || type === 'cache' || type === 'storage') return 'store';
  if (type === 'queue' || type === 'messaging') return 'queue';
  if (type === 'compute' && (provider === 'aws' || provider === 'azure' || provider === 'gcp')) return 'external';
  if (type === 'api' || type === 'network') return 'external';
  return 'external';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
