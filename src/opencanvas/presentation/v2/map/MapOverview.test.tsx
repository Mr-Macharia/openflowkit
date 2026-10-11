import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MapModel } from '../../../../dsl/map/types';
import type { ArchModel } from '../../../../dsl/model/types';
import { MapOverview } from './MapOverview';

const node = (id: string, name: string, kind: string, parent: string | null, loc = 0) =>
  ({ id, name, kind, parent, children: [], loc, files: kind === 'file' ? 1 : 0, path: id });
const model = {
  root: 'root',
  nodes: { root: node('root', 'repo', 'dir', null), 'a.ts': node('a.ts', 'a.ts', 'file', 'root', 1200), 'b.ts': node('b.ts', 'b.ts', 'file', 'root', 10) },
  links: [{ from: 'a.ts', to: 'b.ts', kind: 'import', line: 1, text: '' }],
  source: {}, stats: {},
} as unknown as MapModel;
const arch = (flows: unknown[]) => ({ flows }) as unknown as ArchModel;

describe('MapOverview', () => {
  it('counts boxes (not the root) and connections', () => {
    render(<MapOverview model={model} arch={null} onSelect={vi.fn()} />);
    expect(screen.getByText('2 boxes · 1 connection')).toBeTruthy();
  });

  it('insight rows select the box they name', () => {
    const onSelect = vi.fn();
    render(<MapOverview model={model} arch={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('a.ts — one of the largest files'));
    expect(onSelect).toHaveBeenCalledWith('a.ts');
  });

  it('lists flows only when the model has them', () => {
    const { unmount } = render(<MapOverview model={model} arch={arch([])} onSelect={vi.fn()} />);
    expect(screen.queryByLabelText('Flows in this map')).toBeNull();
    unmount();
    render(<MapOverview model={model} arch={arch([{ id: 'f', name: 'Checkout', steps: [1, 2, 3] }])} onSelect={vi.fn()} />);
    expect(screen.getByText('Checkout')).toBeTruthy();
    expect(screen.getByText('3 steps')).toBeTruthy();
  });

  it('renders nothing for an empty map', () => {
    const empty = { ...model, nodes: { root: model.nodes.root }, links: [] } as MapModel;
    const { container } = render(<MapOverview model={empty} arch={null} onSelect={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('puts a space between an insight and its note', () => {
    const { container } = render(<MapOverview model={model} arch={null} onSelect={vi.fn()} />);
    const row = [...container.querySelectorAll('li')].find((li) => li.textContent?.includes('lines'));
    expect(row?.textContent).toBe('a.ts — one of the largest files (1,200 lines)');
  });

  it('names a file once among the largest, even when two folders hold one by that name', () => {
    const twin = {
      ...model,
      nodes: { ...model.nodes, 'x/demo.pb.go': node('x/demo.pb.go', 'demo.pb.go', 'file', 'root', 2610), 'y/demo.pb.go': node('y/demo.pb.go', 'demo.pb.go', 'file', 'root', 2610) },
    } as MapModel;
    render(<MapOverview model={twin} arch={null} onSelect={vi.fn()} />);
    expect(screen.getAllByText(/one of the largest/).map((b) => b.textContent)).toEqual(['demo.pb.go — one of the largest files', 'a.ts — one of the largest files']);
  });
});
