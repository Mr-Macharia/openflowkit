import { SHARE_ORIGIN } from '../share/origin';
import { ShareError } from '../share/shareClient';
import { getTurnstileToken } from '../share/turnstile';
import type { FeedbackBody } from '../usage/usageEvents';

export const MAX_FEEDBACK_TEXT = 2000;
export const MAX_FEEDBACK_EMAIL = 254;

type FeedbackErrorCode = 'offline' | 'unreachable' | 'turnstile' | 'invalid' | 'rate-limited' | 'server';

export class FeedbackError extends Error {
  constructor(readonly code: FeedbackErrorCode, message: string) {
    super(message);
    this.name = 'FeedbackError';
  }
}

/** The human check, in feedback's words: the share helper speaks of links. */
async function humanCheck(get: () => Promise<string>): Promise<string> {
  try { return await get(); } catch (error) {
    if (error instanceof ShareError && error.code === 'offline') throw new FeedbackError('offline', error.message);
    if (error instanceof ShareError && error.code === 'no-site-key') throw new FeedbackError('server', 'Feedback isn’t set up in this build.');
    throw new FeedbackError('turnstile', 'The human check didn’t finish. Try again.');
  }
}

/** Posts one answer. A text or email rides with a Turnstile token; a bare rating or choice needs none. */
export async function sendFeedback(
  body: FeedbackBody,
  deps: { origin?: string; fetcher?: typeof fetch; getToken?: () => Promise<string> } = {},
): Promise<void> {
  const { origin = SHARE_ORIGIN, fetcher = fetch, getToken = getTurnstileToken } = deps;
  const text = body.text?.trim().slice(0, MAX_FEEDBACK_TEXT);
  const email = body.email?.trim().slice(0, MAX_FEEDBACK_EMAIL);
  const payload: FeedbackBody = { ...body, text: text || undefined, email: email || undefined };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (payload.text || payload.email) headers['X-Turnstile-Token'] = await humanCheck(getToken);
  let response: Response;
  try {
    response = await fetcher(`${origin}/feedback`, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch {
    if (globalThis.navigator?.onLine === false) throw new FeedbackError('offline', 'You’re offline. Your note is still here; send it when you’re connected.');
    throw new FeedbackError('unreachable', 'The feedback service isn’t reachable right now. Try again in a minute.');
  }
  if (response.ok) return;
  if (response.status === 400) throw new FeedbackError('invalid', 'That couldn’t be sent as written. Check the email address and try again.');
  if (response.status === 403) throw new FeedbackError('turnstile', 'The human check failed. Try again.');
  if (response.status === 429) throw new FeedbackError('rate-limited', 'Too much feedback from this network. Wait a minute and try again.');
  throw new FeedbackError('server', `The feedback service failed (${response.status}). Try again later.`);
}
