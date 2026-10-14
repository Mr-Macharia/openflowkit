import type { SceneDocumentV1 } from '../../domain/document/types';
import { V2_THUMBNAIL_MAX_CHARS, type V2DocumentRepository, type V2Thumbnail } from '../../../services/storage/v2/v2Repository';
import { exportCanonicalSvg } from '../../infrastructure/export/canonicalSvg';
import { loadIconArt } from './v2IconArt';

const drawn = (page: SceneDocumentV1['pages'][number]) => page.nodes.length + page.connectors.length > 0;

/**
 * First page, both themes, no background: the home card supplies its own surface. A first page with
 * nothing on it (a repo document's map page: its map is drawn live, not stored) gives way to the newest page that has a drawing.
 * No embedded font (a saved SVG file has one): at card size the system face reads the same,
 * and every stored preview would carry another 65 KB.
 */
export async function buildV2Thumbnail(document: SceneDocumentV1, limit = V2_THUMBNAIL_MAX_CHARS): Promise<V2Thumbnail | null> {
  const first = document.pages[0];
  const page = first && drawn(first) ? first : document.pages.findLast(drawn);
  if (!page) return null;
  const iconArt = await loadIconArt(document);
  const build = (art: Record<string, string> | undefined) => (): V2Thumbnail | null => {
    const draw = (theme: 'light' | 'dark') =>
      exportCanonicalSvg(document, { pageId: page.id, ...(art ? { iconArt: art } : {}), theme, pixelRatio: 1, transparent: true });
    const light = draw('light');
    const dark = draw('dark');
    return light && dark ? { light, dark } : null;
  };
  // A big map with icon art outgrows what a card may store: the same picture with plain icon plates still names every box.
  return fitThumbnail([build(iconArt), build(undefined)], limit);
}

/** The first try whose two themes together fit `limit` (each try drawn only when the one before did not fit), else null. */
export function fitThumbnail(tries: readonly (() => V2Thumbnail | null)[], limit: number): V2Thumbnail | null {
  for (const attempt of tries) {
    const thumbnail = attempt();
    if (thumbnail && thumbnail.light.length + thumbnail.dark.length <= limit) return thumbnail;
  }
  return null;
}

// ponytail: a preview still pending when you go home lands after the list, so that card shows its
// placeholder until the next visit; a document deleted inside the wait leaves one orphan preview row.
// Re-list previews on save, or check the document still exists before writing, if either shows up.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const QUIET_MS = 1_200;

/**
 * After a save: wait for the edits to settle, then draw the preview when the browser is idle.
 * Off the save's critical path; a failure only costs the preview, never the document.
 */
export function scheduleV2Thumbnail(repository: V2DocumentRepository, id: string, document: SceneDocumentV1): void {
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(() => {
    pending.delete(id);
    const run = () => {
      void buildV2Thumbnail(document)
        .then((thumbnail) => repository.saveThumbnail(id, thumbnail))
        .catch(() => undefined);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2_000 });
    else run();
  }, QUIET_MS));
}
