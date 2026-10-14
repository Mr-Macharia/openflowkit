import { SERVICE_RULES, basename, dirname, extname, type ScannedFile } from './rules';
import type { Builder } from './discoveryBuilder';
import { serviceKind, slugDiscoveryId, type Ecosystem, type UnitDraft } from './discoveryShared';

/* ---------------------------------------------------------------- imports */

export const SCRIPT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);

export interface ImportFact {
  specifier: string;
  line: number;
  text: string;
}

/** `dependencies`/`devDependencies` keys of a package manifest are edges too. */
function manifestDependencyFacts(file: ScannedFile): ImportFact[] {
  const facts: ImportFact[] = [];
  let inDeps = false;
  let depth = 0;
  file.content.split(/\r?\n/).forEach((raw, index) => {
    const marker = /"(?:dev|peer|optional)?[Dd]ependencies"\s*:/.exec(raw);
    if (!inDeps && marker) {
      inDeps = true;
      depth = 0;
      // Single-line manifests carry every dependency on the marker line.
      const tail = raw.slice(marker.index + marker[0].length);
      for (const match of tail.matchAll(/"([^"]+)"\s*:/g)) {
        facts.push({ specifier: match[1]!, line: index + 1, text: raw.trim() });
      }
      depth += (tail.match(/\{/g)?.length ?? 0) - (tail.match(/\}/g)?.length ?? 0);
      if (depth <= 0) inDeps = false;
      return;
    }
    if (!inDeps) return;
    depth += (raw.match(/\{/g)?.length ?? 0) - (raw.match(/\}/g)?.length ?? 0);
    const key = /^\s*"([^"]+)"\s*:/.exec(raw)?.[1];
    if (key) facts.push({ specifier: key, line: index + 1, text: raw.trim() });
    if (depth <= 0 && raw.includes('}') && !key) inDeps = false;
  });
  return facts;
}

/**
 * A requirements.txt or go.mod with what only came in through another package blanked (line numbers kept):
 * pip-compile's `# via flask` (anything but `# via -r …`) and go's `// indirect`. A pinned lockfile-style list
 * names every transitive client; only the direct ones say what the code talks to.
 */
export function directLines(file: ScannedFile): string[] {
  const lines = file.content.split(/\r?\n/);
  if (basename(file.path) === 'go.mod') return lines.map((line) => (/\/\/\s*indirect\b/.test(line) ? '' : line));
  let requirement = -1;
  let via: string[] | null = null;
  const transitive = new Set<number>();
  const settle = () => { if (requirement !== -1 && via?.length && !via.some((from) => from.startsWith('-'))) transitive.add(requirement); };
  lines.forEach((raw, index) => {
    const comment = /^\s*#\s*(.*)$/.exec(raw)?.[1];
    if (comment === undefined) {
      if (!/^\s*[A-Za-z0-9]/.test(raw)) return;
      settle();
      requirement = index;
      const inline = /#\s*via\s+(.+)$/.exec(raw)?.[1];
      via = inline ? inline.split(/[\s,]+/).filter(Boolean) : null;
    } else if (requirement !== -1) {
      const words = comment.trim();
      if (/^via\b/.test(words)) via = words.replace(/^via\s*/, '') ? [words.replace(/^via\s*/, '')] : [];
      else if (via && words) via.push(words);
    }
  });
  settle();
  return lines.map((line, index) => (transitive.has(index) ? '' : line));
}

/** pyproject tables whose arrays list requirements, and the poetry tables whose keys are dependencies. */
const PYPROJECT_ARRAYS = /^(?:project\.optional-dependencies|dependency-groups)$/;
const POETRY_TABLE = /^tool\.poetry\.(?:dev-)?dependencies$|^tool\.poetry\.group\.[^.]+\.dependencies$/;

/** A pyproject's dependencies: PEP 621 / uv arrays (`"redis>=5"`) and poetry tables (`redis = "^5"`). */
function pyprojectDependencyFacts(file: ScannedFile): ImportFact[] {
  const facts: ImportFact[] = [];
  let table = '';
  let inArray = false;
  file.content.split(/\r?\n/).forEach((raw, index) => {
    const header = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*(?:#.*)?$/.exec(raw);
    if (header) { table = header[1]!.trim(); inArray = false; return; }
    const opens = !inArray && ((table === 'project' && /^\s*dependencies\s*=\s*\[/.test(raw)) || (PYPROJECT_ARRAYS.test(table) && /^\s*[A-Za-z0-9_.-]+\s*=\s*\[/.test(raw)));
    if (opens || inArray) {
      const items = opens ? raw.slice(raw.indexOf('[') + 1) : raw;
      for (const match of items.matchAll(/["']([A-Za-z0-9][A-Za-z0-9_.-]*)/g)) facts.push({ specifier: match[1]!, line: index + 1, text: raw.trim() });
      // Extras (`uvicorn[standard]`) sit inside the strings: only a bracket outside them closes the list.
      inArray = !/\]/.test(items.replace(/"[^"]*"|'[^']*'/g, ''));
      return;
    }
    const key = POETRY_TABLE.test(table) ? /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=/.exec(raw)?.[1] : undefined;
    if (key && key.toLowerCase() !== 'python') facts.push({ specifier: key, line: index + 1, text: raw.trim() });
  });
  return facts;
}

export function importFacts(file: ScannedFile): ImportFact[] {
  const ext = extname(file.path).toLowerCase();
  const facts: ImportFact[] = [];
  if (ext === '.json' && /(^|\/)package\.json$/.test(file.path)) facts.push(...manifestDependencyFacts(file));
  const base = basename(file.path);
  if (base === 'pyproject.toml') return pyprojectDependencyFacts(file);
  if (base === 'requirements.txt' || base === 'go.mod') {
    // `redis==5.0` and `github.com/redis/go-redis/v9 v9.5.0` (in or after `require`) name a dependency.
    directLines(file).forEach((raw, index) => {
      const specifier = base === 'requirements.txt'
        ? /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:[=<>~!;[]|$)/.exec(raw)?.[1]
        : /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/\S+)\s+v\d/.exec(raw)?.[1];
      if (specifier) facts.push({ specifier, line: index + 1, text: raw.trim() });
    });
    return facts;
  }
  file.content.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    let specifier: string | undefined;
    if (SCRIPT_EXT.has(ext)) {
      specifier = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/.exec(raw)?.[1]
        ?? /^\s*import\s+['"]([^'"]+)['"]/.exec(raw)?.[1];
    } else if (ext === '.py') {
      specifier = /^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/.exec(raw)?.[1];
    } else if (ext === '.go') {
      specifier = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*\s+)?"([^"]+)"\s*$/.exec(raw)?.[1]
        ?? /^import\s+"([^"]+)"/.exec(raw)?.[1];
    } else if (ext === '.rb') {
      specifier = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(raw)?.[1];
    } else if (ext === '.java' || ext === '.kt' || ext === '.scala') {
      specifier = /^\s*import\s+([A-Za-z0-9_.]+)/.exec(raw)?.[1];
    }
    if (specifier) facts.push({ specifier, line, text: raw.trim() });
  });
  return facts;
}

interface SdkService { pattern: RegExp; name: string }

export const SDK_SERVICES: ReadonlyArray<SdkService> = [
  { pattern: /^(?:@aws-sdk\/|aws-sdk$|boto3$|botocore$)/, name: 'AWS' },
  { pattern: /^(?:@google-cloud\/|google\.cloud|google-cloud-)/, name: 'Google Cloud' },
  { pattern: /^(?:@azure\/|azure-|msrestazure)/, name: 'Azure' },
  { pattern: /^stripe$/, name: 'Stripe' },
  { pattern: /^@slack\//, name: 'Slack' },
  { pattern: /^openai$/, name: 'OpenAI' },
  { pattern: /^@anthropic-ai\/sdk$/, name: 'Anthropic' },
  { pattern: /^twilio$/, name: 'Twilio' },
  { pattern: /^@sendgrid\//, name: 'SendGrid' },
  { pattern: /^(?:firebase|firebase-admin)$/, name: 'Firebase' },
  { pattern: /^@supabase\//, name: 'Supabase' },
  { pattern: /^@sentry\//, name: 'Sentry' },
];

export const CLIENT_CALL = /\b(?:fetch|axios|got|superagent|requests\.|httpx|aiohttp|urllib|http\.Get|http\.NewRequest)\b/;
/** A URL that opens a string (`fetch("https://…`, f"https://…"): one in prose or a comment calls nothing. */
export const URL_LITERAL = /["'`]https?:\/\/(?:[^/@\s"'`]*@)?([A-Za-z0-9.-]+)/;
/** `//`, `#`, `*` (inside a block comment), `<!--`: documentation, even when it says `fetch`. */
export const COMMENT_LINE = /^\s*(?:\/\/|#|\/?\*|<!--)/;

/** Hosts that are never architecture: local dev, docs, schemas. */
const SKIP_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'www.example.com',
  'github.com', 'raw.githubusercontent.com', 'schema.org', 'www.w3.org', 'w3.org',
  'json-schema.org', 'opensource.org', 'npmjs.com', 'www.npmjs.com', 'pypi.org',
]);

export function skipHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^www\./, '');
  // A name with no dot is no public service: a Durable Object or service-binding stub (`fetch('https://quota/…')`), a compose host.
  return !lower.includes('.') || SKIP_HOSTS.has(lower) || lower.endsWith('.local') || lower.endsWith('.example')
    || lower === 'example.org' || lower === 'example.net' || lower.startsWith('docs.')
    || lower.endsWith('.readthedocs.io') || /^\d+\.\d+\.\d+\.\d+$/.test(lower);
}

/** Which package names a file's imports can mean: its language's, or none (Java, Ruby: matched to services only). */
export function ecosystemOf(file: string): Ecosystem | undefined {
  const base = basename(file);
  const ext = extname(file).toLowerCase();
  if (base === 'package.json' || SCRIPT_EXT.has(ext)) return 'js';
  if (base === 'pyproject.toml' || base === 'requirements.txt' || ext === '.py') return 'py';
  if (base === 'go.mod' || ext === '.go') return 'go';
  return undefined;
}

/** pip names ignore case and treat `-` and `_` alike (`my-lib` is imported as `my_lib`). */
const pythonName = (name: string) => name.toLowerCase().replace(/-/g, '_');

/** Index keys a package answers to: `@acme/api` also as `api`, a Python name normalised, a Go module as itself. */
export function packageKeys(eco: Ecosystem, name: string): string[] {
  if (eco === 'py') return [`py:${pythonName(name)}`];
  if (eco === 'go') return [`go:${name}`];
  return [`js:${name}`, `js:${name.split('/').pop()!}`];
}

export function packageTarget(index: ReadonlyMap<string, UnitDraft>, eco: Ecosystem | undefined, specifier: string): UnitDraft | undefined {
  if (!eco || specifier.startsWith('.')) return undefined;
  const parts = specifier.split('/');
  // A Go import names a package inside a module: the longest module path it starts with.
  const candidates = eco === 'go' ? parts.map((_, end) => `go:${parts.slice(0, parts.length - end).join('/')}`)
    : eco === 'py' ? [`py:${pythonName(specifier.split('.')[0]!)}`]
      : specifier.startsWith('@') ? [`js:${parts[0]}/${parts[1] ?? ''}`, `js:${specifier}`] : [`js:${parts[0]}`, `js:${specifier}`];
  for (const candidate of candidates) {
    const hit = index.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

/** Top-level folders a lone root app does not own: its docs and samples are not its code. */
const NOT_ROOT_CODE = new Set(['docs', 'doc', 'example', 'examples', 'samples']);

/**
 * The unit whose code holds a file: the deepest unit folder with code in it (a deploy yaml's folder holds none).
 * A repo with one app at its root (saleor, gitea) gives it every file no other unit claims; with several root
 * units, or none, root files have no owner.
 */
export function ownerOf(units: readonly UnitDraft[], file: string): UnitDraft | undefined {
  const dir = dirname(file);
  let best: UnitDraft | undefined;
  const roots: UnitDraft[] = [];
  for (const unit of units) {
    if (!unit.code || (unit.kind !== 'container' && unit.kind !== 'system')) continue;
    if (unit.dir === '') {
      roots.push(unit);
      continue;
    }
    if (dir !== unit.dir && !dir.startsWith(`${unit.dir}/`)) continue;
    if (!best || unit.dir.length > best.dir.length) best = unit;
  }
  if (best || roots.length !== 1) return best;
  return NOT_ROOT_CODE.has(file.split('/')[0]!) && file.includes('/') ? undefined : roots[0];
}

/** The scanner's rule for a client import or a host; cluster tooling is never a service here. */
export function serviceRuleFor(value: string): (typeof SERVICE_RULES)[number] | undefined {
  return SERVICE_RULES.find((rule) => rule.provider !== 'cncf' && rule.provider !== 'docker'
    && rule.patterns.some((pattern) => pattern.test(value)));
}

/** The rule's unit: a compose/k8s store already running it (`cache` on redis), else one named for it. */
export function serviceUnit(builder: Builder, rule: (typeof SERVICE_RULES)[number]): UnitDraft {
  const kind = serviceKind(rule.type, rule.provider);
  return builder.named(kind, rule.name) ?? builder.unit({ id: slugDiscoveryId(rule.name), name: rule.name, kind, dir: '' });
}
