// This page load's side of the prompt rules: the stored state, the session's start and its success moments.
import { onTrack } from '../usage/usage';
import type { FeedbackFeature } from '../usage/usageEvents';
import {
  featureOf, readFeedbackState, recordSession, writeFeedbackState, type FeedbackState, type PromptContext,
} from './promptRules';

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

let startedAt: number | null = null;
const successes: Partial<Record<FeedbackFeature, number>> = {};
const listeners = new Set<() => void>();

/** Once at boot: an active day, and the success events from here on. A shared link's viewer is not a session of the app. */
export function startFeedbackSession(now = Date.now(), viewer = false): void {
  if (startedAt !== null) return;
  startedAt = now;
  if (!viewer) writeFeedbackState(storage(), recordSession(readFeedbackState(storage()), now));
  onTrack((event) => {
    const feature = featureOf(event);
    if (!feature || successes[feature] !== undefined) return;
    successes[feature] = Date.now();
    for (const listener of listeners) listener();
  });
}

export const feedbackState = (): FeedbackState => readFeedbackState(storage());

export function updateFeedbackState(change: (state: FeedbackState) => FeedbackState): void {
  writeFeedbackState(storage(), change(feedbackState()));
}

export const feedbackContext = (): PromptContext => ({ sessionStartedAt: startedAt ?? Date.now(), successes: { ...successes } });

/** A first success this session: the rules may now have something to ask. */
export function onFeedbackSuccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
