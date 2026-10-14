import { basename, dirname } from './rules';
import type { DiscoveredUnitKind } from './discoveryTypes';
import type { Builder } from './discoveryBuilder';
import { envHosts, indentOf, isRecord, isTemplated, scalar } from './discoveryShared';

/* ----------------------------------------------------------- compose etc. */

export interface ConfigLine {
  value: string;
  line: number;
  text: string;
}

export interface ComposeService {
  name: string;
  line: number;
  text: string;
  image?: string;
  /** `build: ./dir`, or the `context` and `dockerfile` under `build:`. */
  build?: { context?: string; dockerfile?: string };
  /** `extends:` or a `<<:` merge: what it runs is defined elsewhere. */
  inherits?: boolean;
  dependsOn: Array<{ name: string; line: number; text: string }>;
  environment: ConfigLine[];
}

/**
 * The repo folder a compose service builds: its context, or the folder of the Dockerfile it names (relative to the
 * context). Null when a variable or a remote decides, or the path climbs out of the repo.
 */
export function buildDir(composeDir: string, build: NonNullable<ComposeService['build']>): string | null {
  const context = build.context ?? '.';
  if ([context, build.dockerfile ?? ''].some((path) => /[$:]|^\//.test(path))) return null;
  const parts: string[] = [];
  for (const segment of [composeDir, context, build.dockerfile ? dirname(build.dockerfile) : ''].join('/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (parts.pop() === undefined) return null;
  }
  return parts.join('/');
}

/** A Dockerfile other than the folder's own (`Dockerfile.playwright`, `test.Dockerfile`): a side job, not the service. */
export function sideDockerfile(build: NonNullable<ComposeService['build']>): boolean {
  return build.dockerfile !== undefined && basename(build.dockerfile) !== 'Dockerfile';
}

/** A YAML flow list (`[api, "db"]`) as plain names; anything else is not a list. Capped: no service has hundreds of dependencies. */
function flowListItems(value: string): string[] {
  const inside = /^\[(.*)\]\s*(?:#.*)?$/.exec(value.trim())?.[1];
  if (inside === undefined) return [];
  return inside.split(',', 50).map((item) => scalar(item.trim().slice(0, 200))).filter((name) => /^[A-Za-z0-9._-]+$/.test(name));
}

export function parseComposeServices(content: string): ComposeService[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
  if (start === -1) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) { end = index; break; }
  }
  const block = lines.slice(start + 1, end);
  const keyIndents = block
    .filter((line) => /^\s*[A-Za-z0-9._-]+:/.test(line) && !/^\s*-/.test(line))
    .map((line) => indentOf(line));
  if (keyIndents.length === 0) return [];
  const serviceIndent = Math.min(...keyIndents);

  const services: ComposeService[] = [];
  let current: ComposeService | null = null;
  let dependsIndent = -1;
  let environmentIndent = -1;
  let buildIndent = -1;
  block.forEach((raw, index) => {
    const line = start + 2 + index;
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return;
    const indent = indentOf(raw);
    const text = raw.trim();
    const key = /^([A-Za-z0-9._-]+):(?:\s*(.*))?$/.exec(text);
    if (indent === serviceIndent && key) {
      current = { name: key[1]!, line, text, dependsOn: [], environment: [] };
      services.push(current);
      dependsIndent = -1;
      environmentIndent = -1;
      buildIndent = -1;
      return;
    }
    if (!current) return;
    if (dependsIndent !== -1 && indent <= dependsIndent) dependsIndent = -1;
    if (buildIndent !== -1 && indent <= buildIndent) buildIndent = -1;
    if (environmentIndent !== -1 && (indent < environmentIndent || (indent === environmentIndent && !text.startsWith('-')))) environmentIndent = -1;
    // `environment:` as a map (`API_URL: http://api`) or a list (`- API_URL=http://api`).
    if (environmentIndent !== -1) {
      const entry = /^-\s*["']?[A-Za-z_][A-Za-z0-9_]*=(.*?)["']?$/.exec(text)?.[1] ?? key?.[2];
      if (entry) current.environment.push({ value: entry, line, text });
      return;
    }
    if (/^(?:extends|<<)\s*:/.test(text) && indent > serviceIndent) current.inherits = true;
    if (key && indent > serviceIndent) {
      const [, keyName, rawValue] = key;
      if (keyName === 'image') current.image = scalar(rawValue ?? '');
      if (keyName === 'environment' && !rawValue) environmentIndent = indent;
      // ponytail: the flow form `build: { context: x }` is not read — the service keeps its compose folder.
      if (keyName === 'build' && !current.build && !rawValue?.startsWith('{')) {
        if (!rawValue) buildIndent = indent;
        current.build = rawValue ? { context: scalar(rawValue) } : {};
      } else if (buildIndent !== -1 && indent > buildIndent && rawValue && (keyName === 'context' || keyName === 'dockerfile')) {
        current.build![keyName] = scalar(rawValue);
      }
      if (keyName === 'depends_on') {
        dependsIndent = indent;
        // The flow list `depends_on: [api, "db"]`; the map and block-list forms are read line by line below.
        for (const name of flowListItems(rawValue ?? '')) current.dependsOn.push({ name, line, text });
      } else if (dependsIndent !== -1 && indent > dependsIndent && !rawValue) {
        current.dependsOn.push({ name: keyName!, line, text });
      }
      return;
    }
    if (dependsIndent !== -1 && indent > dependsIndent) {
      const item = /^-\s*(.+)$/.exec(text);
      if (item) current.dependsOn.push({ name: scalar(item[1]!), line, text });
    }
  });
  return services;
}

interface K8sWorkload {
  kind: string;
  name: string;
  images: Array<{ image: string; line: number; text: string }>;
  /** Every `value:` line (container env); hosts in them become calls. */
  values: ConfigLine[];
  kindLine: number;
  nameLine: number;
}

export function parseK8sWorkloads(content: string): K8sWorkload[] {
  const lines = content.split(/\r?\n/);
  const workloads: K8sWorkload[] = [];
  let current: K8sWorkload | null = null;
  let inMetadata = false;
  let envIndent = -1;
  const flush = () => {
    if (current?.name) workloads.push(current);
    current = null;
    inMetadata = false;
    envIndent = -1;
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^---\s*$/.test(raw)) { flush(); return; }
    const kind = /^kind:\s*([A-Za-z]+)\s*$/.exec(raw);
    if (kind) {
      flush();
      if (/^(?:Deployment|StatefulSet|CronJob|DaemonSet)$/.test(kind[1]!)) {
        current = { kind: kind[1]!, name: '', images: [], values: [], kindLine: line, nameLine: line };
      }
      return;
    }
    if (!current) return;
    if (/^metadata:\s*$/.test(raw)) { inMetadata = true; return; }
    if (/^spec:\s*$/.test(raw)) { inMetadata = false; return; }
    const name = /^\s+name:\s*(.+)$/.exec(raw);
    if (name && inMetadata && !current.name) {
      // A Helm template (`{{ .Values.x.name }}`) names nothing until rendered: drop the workload.
      if (isTemplated(name[1]!)) { current = null; return; }
      current.name = scalar(name[1]!);
      current.nameLine = line;
      return;
    }
    // `image:` under a container, or first in its list item (`- image: postgres:15`, as kubectl writes it).
    const image = /^\s+(?:-\s+)?image:\s*(.+)$/.exec(raw);
    if (image && !isTemplated(image[1]!)) current.images.push({ image: scalar(image[1]!), line, text: raw.trim() });
    // Only a container's `env:` list addresses services; probe headers and tolerations have values too.
    const indent = indentOf(raw);
    const text = raw.trim();
    if (envIndent !== -1 && text && !text.startsWith('#') && (indent < envIndent || (indent === envIndent && !text.startsWith('-')))) envIndent = -1;
    if (/^(?:-\s+)?env:\s*$/.test(text)) { envIndent = indent; return; }
    const value = /^(?:-\s+)?value:\s*(.+)$/.exec(text);
    if (value && envIndent !== -1 && !isTemplated(value[1]!)) current.values.push({ value: value[1]!, line, text });
  });
  flush();
  return workloads;
}

export const TERRAFORM_RESOURCE = /^\s*resource\s+"(aws_[a-z0-9_]+)"\s+"([A-Za-z0-9_-]+)"/;
const TERRAFORM_STORES = /^(?:aws_db_instance|aws_rds_cluster|aws_dynamodb_table|aws_elasticache_cluster|aws_elasticache_replication_group|aws_redshift_cluster|aws_efs_file_system|aws_s3_bucket)$/;
const TERRAFORM_QUEUES = /^(?:aws_sqs_queue|aws_sns_topic|aws_kinesis_stream)$/;
const TERRAFORM_COMPUTE = /^(?:aws_lambda_function|aws_ecs_service|aws_ecs_cluster|aws_ecs_task_definition|aws_api_gateway_rest_api|aws_apprunner_service)$/;

export function terraformKind(type: string): DiscoveredUnitKind {
  if (TERRAFORM_STORES.test(type)) return 'store';
  if (TERRAFORM_QUEUES.test(type)) return 'queue';
  if (TERRAFORM_COMPUTE.test(type)) return 'container';
  return 'external';
}

const NODE_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['next', 'Next.js'], ['@nestjs/core', 'NestJS'], ['express', 'Express'],
  ['fastify', 'Fastify'], ['koa', 'Koa'], ['hono', 'Hono'],
  // Meta-frameworks before the library they sit on.
  ['astro', 'Astro'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'],
  ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'],
];

const PYTHON_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  // A requirements line, a poetry key or a quoted pyproject entry (`dependencies = ["fastapi[standard]<1"]`); pip names ignore case.
  [/(?:^\s*|["'])fastapi\b/im, 'FastAPI'], [/(?:^\s*|["'])django\b/im, 'Django'], [/(?:^\s*|["'])flask\b/im, 'Flask'],
  [/(?:^\s*|["'])celery\b/im, 'Celery'], [/(?:^\s*|["'])starlette\b/im, 'Starlette'],
];

const GO_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/gin-gonic\/gin/, 'Gin'], [/labstack\/echo/, 'Echo'], [/gofiber\/fiber/, 'Fiber'], [/go-chi\/chi/, 'chi'],
  [/google\.golang\.org\/grpc/, 'gRPC'],
];

export function nodeTech(dependencies: Record<string, unknown>, hasBin: boolean): string {
  for (const [dependency, framework] of NODE_FRAMEWORKS) {
    if (dependency in dependencies) return framework;
  }
  return hasBin ? 'Node CLI' : 'Node';
}

/** Dependencies that serve an app by themselves: a package that needs one runs. */
const NODE_SERVERS = new Set(['next', 'nuxt', '@nestjs/core', 'express', 'fastify', 'koa', 'hono', 'astro', '@sveltejs/kit', '@remix-run/node', 'react-scripts', 'expo']);
/** A dev script that starts a server or a dev server (not `tsc --watch`, not `vite build --watch`). */
const DEV_SERVER = /^(?!.*\bbuild\b).*\b(?:vite|next|nuxt|astro|remix|webpack-dev-server|parcel|expo|wrangler|nodemon|ng serve)\b/;

/**
 * Whether a package.json starts something: a `bin`, a `start` script, a server framework among its own
 * dependencies, or a dev server. A workspace root starts its packages, not itself.
 */
export function nodeRuns(manifest: Record<string, unknown>): boolean {
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const own = isRecord(manifest.dependencies) ? manifest.dependencies : {};
  const dev = isRecord(manifest.devDependencies) ? manifest.devDependencies : {};
  if (Object.keys(own).some((name) => NODE_SERVERS.has(name)) || (typeof scripts.dev === 'string' && DEV_SERVER.test(scripts.dev))) return true;
  // A workspace root's `start` runs its packages (`turbo run start`), not itself.
  const root = manifest.workspaces !== undefined || 'turbo' in dev || 'lerna' in dev || 'nx' in dev;
  return !root && (typeof manifest.bin === 'string' || isRecord(manifest.bin) || typeof scripts.start === 'string');
}

export function pythonTech(content: string): string {
  for (const [pattern, framework] of PYTHON_FRAMEWORKS) {
    if (pattern.test(content)) return framework;
  }
  return 'Python';
}

export function goTech(content: string): string {
  for (const [pattern, framework] of GO_FRAMEWORKS) {
    if (pattern.test(content)) return framework;
  }
  return 'Go';
}

/**
 * Config values that name another service (`CART_SERVICE_ADDR: cartservice:7070`)
 * are calls. The target is resolved by name when discovery finishes, so a host
 * that names no unit (a SaaS URL, a port, `true`) draws nothing.
 */
export function callsFromConfig(builder: Builder, from: string, values: readonly ConfigLine[], file: string): void {
  for (const { value, line, text } of values) {
    for (const host of envHosts(value)) builder.relation(from, { name: host }, 'calls', file, line, text);
  }
}
