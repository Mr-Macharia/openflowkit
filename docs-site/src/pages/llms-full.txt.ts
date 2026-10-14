import type { APIRoute } from 'astro';
import { groupedPages, HEADER, url } from '../llms/pages';

// llms-full.txt: every docs page's markdown in sidebar order, each under its title and URL.
export const GET: APIRoute = async () => {
  const pages = (await groupedPages()).flatMap(([, list]) => list);
  const body = [HEADER, ...pages.map((page) =>
    `\n---\n\n# ${page.data.title}\n\nSource: ${url(page.id)}\n${page.data.description ? `\n> ${page.data.description}\n` : ''}\n${(page.body ?? '').trim()}\n`)].join('');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
