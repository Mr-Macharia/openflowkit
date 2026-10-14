import { basename, dirname, isScannedFileName, isSkippedDir, type ScannedFile } from './rules';
import { buildDir, callsFromConfig, goTech, nodeRuns, nodeTech, parseComposeServices, parseK8sWorkloads, pythonTech, sideDockerfile, terraformKind, TERRAFORM_RESOURCE } from './discoveryManifests';
import {
  CLIENT_CALL, COMMENT_LINE, SDK_SERVICES, URL_LITERAL, directLines, ecosystemOf, importFacts, ownerOf, packageKeys, packageTarget,
  serviceRuleFor, serviceUnit, skipHost,
} from './discoveryImports';
import { Builder } from './discoveryBuilder';
import {
  PACKAGE_MANIFESTS, composeImage, dataRuleOfImage, imageTech, isRecord, normalizeName, parseJsonObject, pushEvidence, scalar, serviceDir,
  slugDiscoveryId, unitId, type Ecosystem, type UnitDraft, type UnitInput,
} from './discoveryShared';
import type { ArchitectureDiscovery } from './discoveryTypes';

// The public surface stays here; the stages live in the sibling modules.
export { slugDiscoveryId } from './discoveryShared';
export type { ArchitectureDiscovery, DiscoveredRelation, DiscoveredUnit, DiscoveredUnitKind, DiscoveryEvidence } from './discoveryTypes';
export { capUnits, discoveryToDsl } from './discoveryEmit';
export { discoverySummary, driftReport, modelFromDocument, modelFromNode, readArchModel } from './discoveryModel';
export type {
  ArchElementData, ArchFlowData, ArchFlowStepData, ArchModelData, ArchRelationData, ArchViewData, DriftChange, DriftFinding, DriftReportResult,
} from './discoveryModel';

/**
 * Deterministic architecture discovery, pure: it takes files already read
 * (repo-relative POSIX paths) and does no I/O. It reads the manifests a deployable
 * unit leaves behind — compose, Dockerfiles, k8s, terraform, package manifests —
 * plus the datastore/queue/HTTP clients the scanner already knows, and proposes a
 * C4 workspace. Every finding carries at most two evidence lines, so a human can
 * check the claim. Callers walk or fetch the files; `acceptsArchitectureFile` is the filter.
 */

/* ------------------------------------------------------------------ files */

const DOCKERFILE = /^(?:Dockerfile(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_-]+\.dockerfile)$/i;
/** `compose.yaml`, `docker-compose.yml` and their override and per-environment files (`compose.override.yml`, `docker-compose.prod.yaml`). */
const COMPOSE = /^(?:docker-)?compose(?:\.[A-Za-z0-9_-]+)?\.ya?ml$/i;
const PLAIN_COMPOSE = /^(?:docker-)?compose\.ya?ml$/i;
const WRANGLER = /^wrangler\.(?:toml|jsonc?)$/;
const LOOSE_MANIFESTS = new Set(['go.mod', 'requirements.txt', 'pom.xml']);
/** Lock files list every transitive dependency: pure noise for discovery. */
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'composer.lock', 'go.sum', 'Gemfile.lock',
]);

/** Sample apps beside the product (supabase's `examples/`, cal.com's `example-apps/`): read, but drawn last. */
/** Folders and files that test, fake or measure the system rather than run it. */
const NON_PRODUCTION_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'fixtures', '__fixtures__', 'testdata', '__mocks__', 'evals']);
const NON_PRODUCTION_FILE = /\.(?:test|spec)\.[^.]+$|_test\.(?:go|py)$|^test_[^/]*\.py$/;

/** A file that can define a deployable unit by itself (compose, Dockerfile, k8s yaml, terraform, a Worker or package manifest): a capped reader takes these before source. */
export function definesUnit(file: string): boolean {
  const name = basename(file);
  return DOCKERFILE.test(name) || COMPOSE.test(name) || WRANGLER.test(name) || PACKAGE_MANIFESTS.has(name) || /\.(?:ya?ml|tf)$/i.test(name);
}

/** The shared filter: skipped directories out, then the analyzer's extensions widened for the files that define a deployable unit; takes a repo-relative path. */
export function acceptsArchitectureFile(file: string): boolean {
  const segments = file.split(/[\\/]/);
  const name = segments.pop()!;
  if (LOCKFILES.has(name) || NON_PRODUCTION_FILE.test(name)) return false;
  if (segments.some((segment) => isSkippedDir(segment) || NON_PRODUCTION_DIRS.has(segment))) return false;
  return isScannedFileName(name) || DOCKERFILE.test(name) || COMPOSE.test(name) || WRANGLER.test(name) || LOOSE_MANIFESTS.has(name);
}

/* --------------------------------------------------------------- scanning */

/**
 * Discovery over files already read: repo-relative POSIX paths and their text. `rootName` names a unit whose
 * manifest sits at the repo root. The MCP server walks a checkout to call this;
 * the repo page fetches the same files from GitHub.
 */
export function discoverArchitecture(files: readonly ScannedFile[], rootName: string): ArchitectureDiscovery {
  // Callers filter already; filtering here too means no caller can feed tests or evals in.
  const ordered = files.filter((file) => acceptsArchitectureFile(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  const builder = new Builder();
  const packageDirs = new Set(ordered
    .filter((file) => PACKAGE_MANIFESTS.has(basename(file.path)))
    .map((file) => dirname(file.path)));
  // An override or per-environment compose file beside a plain one adds dev tooling (mailpit, a test runner) or
  // repeats it as published tags; alone in its folder, it is the deployment.
  const composeDirs = new Set(ordered.filter((file) => PLAIN_COMPOSE.test(basename(file.path))).map((file) => dirname(file.path)));
  const readPaths = new Set(ordered.map((file) => file.path));

  for (const file of ordered) {
    const base = basename(file.path);
    const dir = dirname(file.path) === '.' ? '' : dirname(file.path);
    const lines = file.content.split(/\r?\n/);

    if (COMPOSE.test(base) && (PLAIN_COMPOSE.test(base) || !composeDirs.has(dirname(file.path)))) {
      for (const service of parseComposeServices(file.content)) {
        // No image, no build, nothing inherited: an override's patch (`db:` with volumes) of a service defined elsewhere.
        if (!service.image && !service.build && !service.inherits) continue;
        const folder = service.build && !sideDockerfile(service.build) ? buildDir(dir, service.build) : null;
        // A build whose Dockerfile is not in the repo (a context meant to be run from elsewhere) names no folder.
        const built = folder !== null && readPaths.has(`${folder ? `${folder}/` : ''}${basename(service.build!.dockerfile ?? 'Dockerfile')}`) ? folder : null;
        // Named like the Dockerfile's own unit: `src/cart/src/Dockerfile` builds `src/cart`.
        const home = built === null ? null : serviceDir(built, packageDirs);
        const image = service.image ? composeImage(service.image) : undefined;
        // A service built from this repo runs its code: `image:` is only the tag it is pushed as, never its tech.
        const data = home === null && image ? dataRuleOfImage(image) : undefined;
        const { tech, techRank } = home !== null || !image ? {} : data ? { tech: data.name, techRank: 2 } : imageTech(image);
        const input: UnitInput = {
          id: unitId(home ?? dir, service.name), name: service.name, kind: data?.kind ?? 'container', dir: home ?? dir, deployed: true, runs: true,
          ...(image ? { image } : {}), ...(tech ? { tech, techRank: techRank ?? 0 } : {}),
        };
        const draft = home === null ? builder.unit(input) : builder.built(input, dir);
        if (data) builder.alias(draft, data.name);
        pushEvidence(draft, file.path, service.line, service.text);
        for (const dependency of service.dependsOn) {
          builder.relation(draft.id, { id: unitId(dir, dependency.name), name: dependency.name }, 'depends on', file.path, dependency.line, dependency.text);
        }
        callsFromConfig(builder, draft.id, service.environment, file.path);
      }
    }

    if (DOCKERFILE.test(base)) {
      const home = serviceDir(dir, packageDirs);
      const name = home ? basename(home) : rootName;
      // `FROM --platform=$BUILDPLATFORM golang:1.23 AS builder`: the image is the first non-flag word.
      const aliases = new Set<string>();
      const stages = lines.flatMap((line) => {
        const words = /^\s*FROM\s+(.+)$/i.exec(line)?.[1]?.split(/\s+/).filter((word) => !word.startsWith('--')) ?? [];
        const image = words[0] && !aliases.has(words[0].toLowerCase()) ? scalar(words[0]) : undefined;
        // `FROM base AS builder` builds on an earlier stage: `base` names no image.
        if (words[1]?.toLowerCase() === 'as' && words[2]) aliases.add(words[2].toLowerCase());
        return image ? [imageTech(image)] : [];
      });
      // The last stage with a language runs the code (python after a bun build stage, golang before a bare alpine);
      // without one, the first image that names anything (nginx serving a build).
      const { tech, eco, techRank } = [...stages].reverse().find((stage) => stage.techRank === 1) ?? stages.find((stage) => stage.tech) ?? {};
      const draft = builder.manifest({
        id: unitId(home, name), name, kind: 'container', dir: home, runs: true,
        ...(tech ? { tech, techRank: techRank ?? 0 } : {}), ...(eco ? { eco } : {}),
      });
      const fromLine = lines.findIndex((line) => /^\s*FROM\s+/i.test(line));
      if (fromLine >= 0) pushEvidence(draft, file.path, fromLine + 1, lines[fromLine]!);
      const exposeLine = lines.findIndex((line) => /^\s*EXPOSE\s+/i.test(line));
      if (exposeLine >= 0) pushEvidence(draft, file.path, exposeLine + 1, lines[exposeLine]!);
    }

    if ((base.endsWith('.yml') || base.endsWith('.yaml')) && /\bkind:\s*(?:Deployment|StatefulSet|CronJob|DaemonSet)\b/.test(file.content)) {
      for (const workload of parseK8sWorkloads(file.content)) {
        // A workload is the store only when that is all it runs; a store sidecar doesn't make it one.
        const data = workload.images.length === 1 ? dataRuleOfImage(workload.images[0]!.image) : undefined;
        const draft = builder.unit({
          id: unitId(dir, workload.name), name: workload.name, kind: data?.kind ?? 'container', dir, deployed: true, runs: true,
          ...(data ? { tech: data.name } : {}),
        });
        if (data) builder.alias(draft, data.name);
        pushEvidence(draft, file.path, workload.kindLine, `kind: ${workload.kind}`);
        pushEvidence(draft, file.path, workload.nameLine, `metadata.name: ${workload.name}`);
        for (const image of workload.images) {
          pushEvidence(draft, file.path, image.line, image.text);
          builder.relation(draft.id, { image: image.image }, 'deploys', file.path, image.line, image.text);
        }
        callsFromConfig(builder, draft.id, workload.values, file.path);
      }
    }

    if (base.endsWith('.tf')) {
      lines.forEach((line, index) => {
        const match = TERRAFORM_RESOURCE.exec(line);
        if (!match) return;
        const [, type, resource] = match;
        const draft = builder.unit({
          id: unitId(dir, resource!), name: resource!, kind: terraformKind(type!), dir, tech: type!,
        });
        pushEvidence(draft, file.path, index + 1, line);
      });
    }

    if (base === 'package.json') {
      const parsed = parseJsonObject(file.content);
      if (parsed) {
        const name = typeof parsed.name === 'string' ? parsed.name.split('/').pop()! : (dir ? basename(dir) : rootName);
        const dependencies = {
          ...(isRecord(parsed.dependencies) ? parsed.dependencies : {}),
          ...(isRecord(parsed.devDependencies) ? parsed.devDependencies : {}),
        };
        const hasBin = typeof parsed.bin === 'string' || isRecord(parsed.bin);
        const draft = builder.manifest({
          id: unitId(dir, name), name, kind: 'container', dir, eco: 'js', runs: nodeRuns(parsed),
          tech: nodeTech(dependencies, hasBin),
          ...(typeof parsed.name === 'string' ? { packageName: parsed.name } : {}),
        });
        pushEvidence(draft, file.path, 1, `package.json: ${typeof parsed.name === 'string' ? parsed.name : name}`);
      }
    }

    // An assets-only config (no `main`) deploys a static site, not a Worker: the folder's own manifest names it.
    if (WRANGLER.test(base) && lines.some((line) => /^\s*["']?main["']?\s*[=:]\s*"/.test(line))) {
      // toml and json(c) alike: `name`, then the bucket/database names under `r2_buckets` / `d1_databases`.
      const nameLine = lines.findIndex((line) => /^\s*["']?name["']?\s*[=:]\s*"[^"]+"/.test(line));
      const name = nameLine >= 0 ? /"([^"]+)"/.exec(lines[nameLine]!.replace(/^\s*["']?name["']?/, ''))![1]! : (dir ? basename(dir) : rootName);
      const draft = builder.manifest({ id: unitId(dir, name), name, kind: 'container', dir, tech: 'Cloudflare Workers', runs: true });
      draft.tech = 'Cloudflare Workers';
      pushEvidence(draft, file.path, nameLine >= 0 ? nameLine + 1 : 1, nameLine >= 0 ? lines[nameLine]! : `${base}: ${name}`);
      let tech = '';
      lines.forEach((line, index) => {
        tech = /r2_buckets/.test(line) ? 'R2' : /d1_databases/.test(line) ? 'D1' : tech;
        const resource = tech && /["']?(?:bucket|database)_name["']?\s*[=:]\s*"([^"]+)"/.exec(line)?.[1];
        if (!resource) return;
        const store = builder.unit({ id: slugDiscoveryId(resource), name: resource, kind: 'store', dir: '', tech });
        pushEvidence(store, file.path, index + 1, line);
        builder.relation(draft.id, { id: store.id }, 'uses', file.path, index + 1, line);
      });
    }

    if (base === 'pyproject.toml' || base === 'requirements.txt') {
      const name = base === 'pyproject.toml'
        ? (/^\s*name\s*=\s*"([^"]+)"/m.exec(file.content)?.[1] ?? (dir ? basename(dir) : rootName))
        : (dir ? basename(dir) : rootName);
      const draft = builder.manifest({
        id: unitId(dir, name), name, kind: 'container', dir, eco: 'py', runs: true,
        tech: pythonTech(base === 'requirements.txt' ? directLines(file).join('\n') : file.content),
        ...(base === 'pyproject.toml' ? { packageName: name } : {}),
      });
      pushEvidence(draft, file.path, 1, `${base}: ${name}`);
    }

    if (base === 'go.mod') {
      const module = /^module\s+(\S+)/m.exec(file.content)?.[1];
      const name = module?.split('/').pop() ?? (dir ? basename(dir) : rootName);
      const draft = builder.manifest({
        id: unitId(dir, name), name, kind: 'container', dir, eco: 'go', runs: true,
        tech: goTech(directLines(file).join('\n')),
        ...(module ? { packageName: module } : {}),
      });
      const moduleLine = lines.findIndex((line) => /^module\s+/.test(line));
      pushEvidence(draft, file.path, moduleLine >= 0 ? moduleLine + 1 : 1, moduleLine >= 0 ? lines[moduleLine]! : `go.mod: ${name}`);
    }
  }

  const all = builder.all();
  const packageIndex = new Map<string, UnitDraft>();
  for (const unit of all) {
    for (const [eco, name] of Object.entries(unit.packages) as [Ecosystem, string][]) {
      for (const key of packageKeys(eco, name)) if (!packageIndex.has(key)) packageIndex.set(key, unit);
    }
  }

  for (const file of ordered) {
    const owner = ownerOf(all, file.path);
    const eco = ecosystemOf(file.path);
    for (const fact of importFacts(file)) {
      const target = packageTarget(packageIndex, eco, fact.specifier);
      if (target && owner && target.id !== owner.id) {
        builder.relation(owner.id, { id: target.id }, 'imports', file.path, fact.line, fact.text);
        continue;
      }
      // Local modules (`./lambda/handler`) and type packages never talk to a service.
      if (/^(?:\.|\/|@\/|~\/|@types\/)/.test(fact.specifier)) continue;
      // A datastore, queue or cloud service counts only when code imports its client
      // (or a manifest depends on it): a word in a comment or a string is not a service.
      const rule = serviceRuleFor(fact.specifier);
      if (rule) {
        const service = serviceUnit(builder, rule);
        pushEvidence(service, file.path, fact.line, fact.text);
        if (owner) builder.relation(owner.id, { id: service.id }, 'uses', file.path, fact.line, fact.text);
        continue;
      }
      const sdk = SDK_SERVICES.find((entry) => entry.pattern.test(fact.specifier));
      if (!sdk) continue;
      const external = builder.unit({
        id: slugDiscoveryId(sdk.name), name: sdk.name, kind: 'external', dir: '',
        tech: fact.specifier,
      });
      pushEvidence(external, file.path, fact.line, fact.text);
      if (owner) builder.relation(owner.id, { id: external.id }, 'uses', file.path, fact.line, fact.text);
    }

    file.content.split(/\r?\n/).forEach((line, index) => {
      if (!CLIENT_CALL.test(line) || COMMENT_LINE.test(line)) return;
      const host = URL_LITERAL.exec(line)?.[1];
      if (!host || skipHost(host)) return;
      const name = host.replace(/^www\./, '');
      // `api.stripe.com` is Stripe, `sqs.us-east-1.amazonaws.com` is SQS.
      const rule = serviceRuleFor(name);
      // `api.openai.com` is the OpenAI the import pass already found.
      const known = builder.all().find((unit) => unit.kind === 'external'
        && normalizeName(unit.name).length > 2 && normalizeName(name).includes(normalizeName(unit.name)));
      const external = rule ? serviceUnit(builder, rule) : known ?? builder.unit({
        id: slugDiscoveryId(name), name, kind: 'external', dir: '', tech: 'http',
      });
      pushEvidence(external, file.path, index + 1, line);
      if (owner) builder.relation(owner.id, { id: external.id }, 'calls', file.path, index + 1, line);
    });
  }

  return builder.finish(ordered);
}
