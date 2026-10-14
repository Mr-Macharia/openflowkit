import type { APIRoute } from 'astro';
import { groupedPages, HEADER, SITE, url } from '../llms/pages';

// llms.txt (llmstxt.org): the docs as an index an agent can read in one fetch, each page with its one-line description.
export const GET: APIRoute = async () => {
  const sections = (await groupedPages()).map(([label, pages]) =>
    `## ${label}\n\n${pages.map((page) => `- [${page.data.title}](${url(page.id)}): ${page.data.description ?? ''}`.trimEnd()).join('\n')}`);
  const body = `${HEADER}\n${sections.join('\n\n')}\n\n## Optional\n\n- [Every page in one file](${SITE}/llms-full.txt): the full text of the docs, for a single read.\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
