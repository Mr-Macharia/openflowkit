import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { V2LoadCenter } from './V2LoadCenter';

describe('V2LoadCenter', () => {
  // U1-08 + review 2026-10-11: true whether the id came from another browser, or was deleted or evicted here.
  it('a document that is not here says so, with a way to a new diagram and home', () => {
    render(<MemoryRouter><V2LoadCenter phase="not-found" documentId="doc-x" corruptIssues={[]} loadError={null}
      onRetry={vi.fn()} onDownloadDiagnostic={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('That diagram isn’t in this browser.')).toBeTruthy();
    expect(screen.getByText(/deleted, or made in another browser — ask for a share link/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New diagram' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });
});
