import { describe, expect, it } from 'vitest';
import {
  EMPTY_FEEDBACK_STATE, FIRST_VISIT_QUIET_MS, PROMPT_DELAY_MS, PROMPT_GAP_MS, SNOOZE_MS, featureOf, nextCheckAt, nextPrompt,
  readFeedbackState, recordAnswered, recordDismissed, recordNever, recordSession, recordShown, writeFeedbackState,
  type FeedbackState, type PromptContext,
} from './promptRules';

const T0 = new Date(2026, 9, 11, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A person whose first visit was a day ago, back today. */
const seasoned: FeedbackState = recordSession(recordSession(EMPTY_FEEDBACK_STATE, T0 - DAY), T0);
const quiet: PromptContext = { sessionStartedAt: T0, successes: {} };
const exported = (at: number): PromptContext => ({ sessionStartedAt: T0, successes: { export: at } });

describe('featureOf', () => {
  it('maps success events to the feature asked about', () => {
    expect(featureOf('repo_map_ok')).toBe('repo_map');
    expect(featureOf('ai_applied')).toBe('ai');
    expect(featureOf('agent_mcp')).toBe('agent');
    expect(featureOf('agent_webmcp')).toBe('agent');
    expect(featureOf('export_image')).toBe('export');
    expect(featureOf('export_data')).toBe('export');
    expect(featureOf('export_motion')).toBe('export');
    expect(featureOf('share_view')).toBe('share');
    expect(featureOf('share_edit')).toBe('share');
    for (const event of ['session', 'repo_map_fail', 'created_draw', 'code_opened', 'prompt_shown', 'shared_copied'] as const) expect(featureOf(event)).toBeNull();
  });
});

describe('nextPrompt: feature prompts', () => {
  it('asks about a success once it has settled for 20 s', () => {
    expect(nextPrompt(seasoned, T0 + 1000, exported(T0))).toBeNull();
    expect(nextPrompt(seasoned, T0 + PROMPT_DELAY_MS, exported(T0))).toEqual({ kind: 'feature', feature: 'export' });
  });
  it('never without a success this session', () => {
    expect(nextPrompt(seasoned, T0 + HOUR, quiet)).toBeNull();
  });
  it('never in the first 2 minutes of the first visit', () => {
    const fresh = recordSession(EMPTY_FEEDBACK_STATE, T0);
    expect(nextPrompt(fresh, T0 + FIRST_VISIT_QUIET_MS - 1, exported(T0))).toBeNull();
    expect(nextPrompt(fresh, T0 + FIRST_VISIT_QUIET_MS, exported(T0))).toEqual({ kind: 'feature', feature: 'export' });
    expect(nextPrompt(EMPTY_FEEDBACK_STATE, T0 + DAY, exported(T0))).toBeNull(); // no session recorded yet
  });
  it('each feature once, ever', () => {
    const asked = recordShown(seasoned, { kind: 'feature', feature: 'export' }, T0 - 10 * DAY);
    expect(nextPrompt(asked, T0 + HOUR, exported(T0))).toBeNull();
    expect(nextPrompt(asked, T0 + HOUR, { sessionStartedAt: T0, successes: { export: T0, share: T0 + 1 } })).toEqual({ kind: 'feature', feature: 'share' });
  });
  it('the earliest settled success goes first', () => {
    const context = { sessionStartedAt: T0, successes: { share: T0 + 5000, ai: T0 } };
    expect(nextPrompt(seasoned, T0 + HOUR, context)).toEqual({ kind: 'feature', feature: 'ai' });
  });
  it('at most one prompt per 3 days', () => {
    const shown = recordShown(seasoned, { kind: 'feature', feature: 'ai' }, T0);
    expect(nextPrompt(shown, T0 + PROMPT_GAP_MS - 1, exported(T0 + PROMPT_GAP_MS - 2 * PROMPT_DELAY_MS))).toBeNull();
    expect(nextPrompt(shown, T0 + PROMPT_GAP_MS, exported(T0))).toEqual({ kind: 'feature', feature: 'export' });
  });
  it('never after Don’t ask again', () => {
    expect(nextPrompt(recordNever(seasoned), T0 + HOUR, exported(T0))).toBeNull();
  });
});

describe('nextPrompt: the product question', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => T0 - (n - 1 - i) * DAY).reduce(recordSession, EMPTY_FEEDBACK_STATE);
  it('comes on the 3rd distinct active day, 20 s into the session, once', () => {
    expect(nextPrompt(days(2), T0 + HOUR, quiet)).toBeNull();
    expect(nextPrompt(days(3), T0 + 1000, quiet)).toBeNull();
    expect(nextPrompt(days(3), T0 + PROMPT_DELAY_MS, quiet)).toEqual({ kind: 'product' });
    const asked = recordShown(days(3), { kind: 'product' }, T0 - 10 * DAY);
    expect(nextPrompt(recordSession(asked, T0 + 5 * DAY), T0 + 5 * DAY, { sessionStartedAt: T0 + 4 * DAY, successes: {} })).toBeNull();
  });
  it('the same day twice is one day', () => {
    const state = [T0, T0 + HOUR, T0 + 2 * HOUR].reduce(recordSession, EMPTY_FEEDBACK_STATE);
    expect(state.activeDays).toHaveLength(1);
  });
  it('a settled success is asked about before the product question', () => {
    expect(nextPrompt(days(3), T0 + HOUR, exported(T0))).toEqual({ kind: 'feature', feature: 'export' });
  });
});

describe('dismissals', () => {
  it('two in a row snooze every prompt for 30 days', () => {
    const once = recordDismissed(seasoned, T0);
    expect(once.snoozedUntil).toBeNull();
    const twice = recordDismissed(once, T0 + 4 * DAY);
    expect(twice).toMatchObject({ dismissals: 0, snoozedUntil: T0 + 4 * DAY + SNOOZE_MS });
    expect(nextPrompt(twice, T0 + 20 * DAY, exported(T0 + 20 * DAY - HOUR))).toBeNull();
    expect(nextPrompt(twice, T0 + 4 * DAY + SNOOZE_MS, exported(T0))).toEqual({ kind: 'feature', feature: 'export' });
  });
  it('an answer resets the streak', () => {
    const state = recordDismissed(recordAnswered(recordDismissed(seasoned, T0)), T0 + DAY);
    expect(state).toMatchObject({ dismissals: 1, snoozedUntil: null });
  });
});

describe('nextCheckAt', () => {
  it('is the next moment a rule can open on its own', () => {
    expect(nextCheckAt(seasoned, T0 + 1000, exported(T0 + 500))).toBe(T0 + PROMPT_DELAY_MS);
    expect(nextCheckAt(seasoned, T0 + HOUR, exported(T0 + HOUR - 1000))).toBe(T0 + HOUR - 1000 + PROMPT_DELAY_MS);
    expect(nextCheckAt(seasoned, T0 + HOUR, quiet)).toBeNull();
    const fresh = recordSession(EMPTY_FEEDBACK_STATE, T0);
    expect(nextCheckAt(fresh, T0 + 30_000, quiet)).toBe(T0 + FIRST_VISIT_QUIET_MS);
  });
});

describe('storage', () => {
  it('round-trips and caps active days at 10', () => {
    const state = Array.from({ length: 14 }, (_, i) => T0 + i * DAY).reduce(recordSession, EMPTY_FEEDBACK_STATE);
    expect(state.activeDays).toHaveLength(10);
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const full = recordNever(recordShown(state, { kind: 'feature', feature: 'ai' }, T0));
    writeFeedbackState(storage, full);
    expect(readFeedbackState(storage)).toEqual(full);
  });
  it('anything unreadable is a fresh start, and blocked storage never throws', () => {
    expect(readFeedbackState({ getItem: () => 'not json' })).toEqual(EMPTY_FEEDBACK_STATE);
    expect(readFeedbackState({ getItem: () => '[1,2]' })).toEqual(EMPTY_FEEDBACK_STATE);
    expect(readFeedbackState({ getItem: () => JSON.stringify({ asked: ['ai', 'bogus'], dismissals: 'x', activeDays: ['2026-10-11', 5] }) }))
      .toMatchObject({ asked: ['ai'], dismissals: 0, activeDays: ['2026-10-11'] });
    const blocked = { getItem: () => { throw new DOMException('denied'); }, setItem: () => { throw new DOMException('denied'); } };
    expect(readFeedbackState(blocked)).toEqual(EMPTY_FEEDBACK_STATE);
    expect(() => writeFeedbackState(blocked, seasoned)).not.toThrow();
    expect(readFeedbackState(null)).toEqual(EMPTY_FEEDBACK_STATE);
  });
});
