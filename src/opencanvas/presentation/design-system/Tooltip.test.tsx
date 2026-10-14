import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IconButton } from './Button';
import { Tooltip } from './Tooltip';
import { foundation } from './tokens';

// jsdom has no ResizeObserver; the popover places itself with one.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => vi.useRealTimers());

it('removes the native title from a custom tooltip trigger', () => {
  render(
    <Tooltip content="Zoom to fit">
      <IconButton label="Zoom to fit" title="Browser tooltip" icon={<span />} />
    </Tooltip>
  );

  expect(screen.getByRole('button', { name: 'Zoom to fit' })).not.toHaveAttribute('title');
});

it('shows one tooltip at a time: a tip left open (focus returned after a popover) hides when another opens', () => {
  vi.useFakeTimers();
  render(
    <>
      <Tooltip content="Canvas menu"><IconButton label="Canvas menu" icon={<span />} /></Tooltip>
      <Tooltip content="AI assistant"><IconButton label="AI assistant" icon={<span />} /></Tooltip>
    </>
  );
  const anchor = (name: string) => screen.getByRole('button', { name }).parentElement!;
  // No pointerleave on the first: the case where focus, not the pointer, keeps it open.
  fireEvent.pointerEnter(anchor('Canvas menu'), { pointerType: 'mouse' });
  act(() => void vi.advanceTimersByTime(foundation.motion.tooltipDelay + 10));
  expect(screen.getAllByRole('tooltip').map((tip) => tip.textContent)).toEqual(['Canvas menu']);

  fireEvent.pointerEnter(anchor('AI assistant'), { pointerType: 'mouse' });
  act(() => void vi.advanceTimersByTime(foundation.motion.tooltipDelay + 10));
  expect(screen.getAllByRole('tooltip').map((tip) => tip.textContent)).toEqual(['AI assistant']);
});

// Review 2 #7: the other tip was hidden only when a timer was scheduled, so two pending timers showed two tips.
it('shows one tooltip when two are pending at once: the later one wins', () => {
  vi.useFakeTimers();
  render(
    <>
      <Tooltip content="Canvas menu"><IconButton label="Canvas menu" icon={<span />} /></Tooltip>
      <Tooltip content="AI assistant"><IconButton label="AI assistant" icon={<span />} /></Tooltip>
    </>
  );
  const anchor = (name: string) => screen.getByRole('button', { name }).parentElement!;
  // Entered one after the other with no leave between (focus can hold a tip the same way): both timers pending together.
  fireEvent.pointerEnter(anchor('Canvas menu'), { pointerType: 'mouse' });
  fireEvent.pointerEnter(anchor('AI assistant'), { pointerType: 'mouse' });
  act(() => void vi.advanceTimersByTime(foundation.motion.tooltipDelay + 10));
  expect(screen.getAllByRole('tooltip').map((tip) => tip.textContent)).toEqual(['AI assistant']);
});
