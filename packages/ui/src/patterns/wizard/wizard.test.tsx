import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Wizard } from './wizard';

const steps = [
  { id: 'upload', label: 'Nahrání souboru' },
  { id: 'mapping', label: 'Přiřazení sloupců' },
  { id: 'preview', label: 'Náhled' },
];

const labels = {
  stepOf: (current: number, total: number) => `Krok ${current} z ${total}`,
  back: 'Předchozí krok',
  next: 'Pokračovat',
  destructiveBackTitle: 'Změna mapování založí nový import',
  destructiveBackConfirm: 'Vrátit se a začít znovu',
  destructiveBackRetreat: 'Zůstat v náhledu',
};

function base(overrides: Partial<React.ComponentProps<typeof Wizard>> = {}) {
  return {
    steps,
    current: 'mapping',
    onNavigate: vi.fn(),
    labels,
    children: <p>Obsah kroku</p>,
    ...overrides,
  };
}

describe('Wizard', () => {
  it('ohlásí krok a jeho pořadí', () => {
    render(<Wizard {...base()} />);
    expect(screen.getByText('Krok 2 z 3')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Přiřazení sloupců' })).toBeVisible();
  });

  it('po přechodu přesune fokus na nadpis kroku', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { rerender } = render(<Wizard {...base({ onNavigate })} />);
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }));
    expect(onNavigate).toHaveBeenCalledWith('preview');

    rerender(<Wizard {...base({ current: 'preview', onNavigate })} />);
    expect(screen.getByRole('heading', { name: 'Náhled' })).toHaveFocus();
  });

  it('změnu kroku ohlásí čtečce přes aria-live', () => {
    render(<Wizard {...base()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Krok 2 z 3');
  });

  it('nedestruktivní návrat jde rovnou', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Wizard {...base({ onNavigate })} />);
    await user.click(screen.getByRole('button', { name: 'Předchozí krok' }));
    expect(onNavigate).toHaveBeenCalledWith('upload');
  });

  it('destruktivní návrat se nejdřív zeptá a řekne, co se ztratí', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const warning = 'Když se vrátíte, rozpracovaný náhled se zahodí a import začne znovu.';
    render(<Wizard {...base({ current: 'preview', destructiveBack: warning, onNavigate })} />);

    await user.click(screen.getByRole('button', { name: 'Předchozí krok' }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Změna mapování založí nový import')).toBeVisible();
    // Věta o tom, co se ztratí, přichází od obrazovky, protože jen ona ví,
    // co konkrétně se v tomhle kroku zahodí.
    expect(screen.getByText(warning)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Vrátit se a začít znovu' }));
    expect(onNavigate).toHaveBeenCalledWith('mapping');
  });

  it('na prvním kroku se návrat nenabízí', () => {
    render(<Wizard {...base({ current: 'upload' })} />);
    expect(screen.queryByRole('button', { name: 'Předchozí krok' })).toBeNull();
  });
});
