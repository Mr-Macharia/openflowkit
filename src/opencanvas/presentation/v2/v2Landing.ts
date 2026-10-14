import { dslFrames } from '../../../dsl/frameScene';
import { dslFrameMeta } from '../../../dsl/sceneMeta';
import { dslFamilyDirection } from '../../../dsl/vocabulary';
import type { LandingDirection } from '../../domain/camera/readableLanding';
import type { ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import { shortcutGroups } from './v2Shortcuts';

// ponytail: direction of the page's last diagram — a reply with mixed directions lands on the last one.
export const landingDirectionOf = (page: ScenePage | null): LandingDirection => {
  const last = page ? dslFrames(page).at(-1) : undefined;
  const meta = last ? dslFrameMeta(last) : null;
  return (meta?.direction as LandingDirection | undefined) ?? (meta ? dslFamilyDirection(meta.family) : 'down');
};

/** What says the camera moved in to read, and how to see it all. */
export const zoomedToReadToast = (): ToastItem => {
  const fit = shortcutGroups().flatMap(({ rows }) => rows).find(({ label }) => label === 'Zoom to fit')?.keys;
  return { id: `landing-${Date.now()}`, tone: 'info', title: 'Zoomed in to read', description: `Press ${fit} to see it all.` };
};
