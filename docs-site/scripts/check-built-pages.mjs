// Runs after the build: every markdown page must render a body. Astro can cache
// a failed markdown render and emit an empty page with exit 0 (seen 2026-10-11
// on templates.md), which no source-side check can see.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_SITE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONTENT = resolve(DOCS_SITE, 'src', 'content', 'docs');
const DIST = resolve(DOCS_SITE, 'dist');
const MIN_CHARS = 80;

const slugs = (await readdir(CONTENT)).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3));
const empty = [];
for (const slug of slugs) {
  const html = await readFile(resolve(DIST, slug, 'index.html'), 'utf8').catch(() => '');
  const start = html.indexOf('sl-markdown-content');
  const body = start < 0 ? '' : html.slice(start).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (body.length < MIN_CHARS) empty.push(slug);
}
if (empty.length > 0) {
  console.error(`[docs-gate] built pages with no body: ${empty.join(', ')} (clear docs-site/node_modules/.astro and rebuild)`);
  process.exit(1);
}
console.log(`[docs-gate] ${slugs.length} built pages have a body`);
