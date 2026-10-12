import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnStaleChunk, V2ErrorBoundary } from './V2ErrorBoundary';

window.matchMedia ??= (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;

function Boom(): React.JSX.Element {
  throw new Error('render failed');
}

describe('V2ErrorBoundary', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the shared error state with Reload instead of a blank page', async () => {
    const reload = vi.fn();
    render(<V2ErrorBoundary reload={reload}><Boom /></V2ErrorBoundary>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('renders children untouched when nothing throws', () => {
    render(<V2ErrorBoundary reload={vi.fn()}><p>fine</p></V2ErrorBoundary>);
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});

describe('reloadOnStaleChunk', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('reloads once per session, so a persistent failure can never loop', () => {
    const reload = vi.fn();
    expect(reloadOnStaleChunk(reload)).toBe(true);
    expect(reloadOnStaleChunk(reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
