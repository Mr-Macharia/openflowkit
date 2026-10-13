import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Checkbox, NumberField, Segmented } from './Controls';

it('checkbox keeps native semantics under the drawn box and shows a minus when indeterminate', () => {
  const { rerender } = render(<Checkbox label="Grid" indeterminate onChange={() => undefined} />);
  const input = screen.getByRole('checkbox', { name: 'Grid' }) as HTMLInputElement;
  expect(input.indeterminate).toBe(true);
  expect(input.nextElementSibling?.querySelector('.tabler-icon-minus')).not.toBeNull();

  rerender(<Checkbox label="Grid" checked onChange={() => undefined} />);
  expect(input.indeterminate).toBe(false);
  expect(input.nextElementSibling?.querySelector('.tabler-icon-check')).not.toBeNull();
  fireEvent.click(input);
});

it('segmented with a visible caption names its radio group by that caption', () => {
  render(<Segmented label="Format" showLabel value="png" onChange={() => undefined}
    options={[{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG' }]} />);
  expect(screen.getByText('Format')).toBeVisible();
  expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'PNG' })).toBeChecked();
});

function typeInto(onCommit: (value: number) => void, text: string) {
  render(<NumberField label="Opacity" value={100} onChange={() => undefined} onCommit={onCommit} />);
  const input = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: text } });
  return input;
}

it('number field commits an Enter edit exactly once', () => {
  const onCommit = vi.fn();
  const input = typeInto(onCommit, '40');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(40);
  expect(input).not.toHaveFocus();
});

it('number field commits a blur edit once and Escape cancels', () => {
  const onCommit = vi.fn();
  const input = typeInto(onCommit, '40');
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
  cleanup();
  const cancelled = vi.fn();
  const field = typeInto(cancelled, '40');
  fireEvent.keyDown(field, { key: 'Escape' });
  fireEvent.blur(field);
  expect(cancelled).not.toHaveBeenCalled();
});
