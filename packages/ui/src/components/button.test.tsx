import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('primární tlačítko nikdy nemá atribut disabled', () => {
    render(
      <Button variant="primary" unavailableReason="K odeslání je potřeba oprávnění campaigns:send.">
        Odeslat 1 129 e-mailů
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Odeslat 1 129 e-mailů/ });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby');
  });

  it('nedostupné tlačítko neprovede akci, ale vysvětlí důvod', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <Button
        variant="primary"
        unavailableReason="Nejdřív potvrďte, že rozumíte následkům."
        onUnavailable={onUnavailable}
        onClick={onClick}
      >
        Smazat 3 402 kontaktů
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nejdřív potvrďte, že rozumíte následkům.')).toBeVisible();
  });

  it('čekající tlačítko zůstává čitelné, hlásí aria-busy a nespustí akci podruhé', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" pending pendingLabel="Ukládáme…" onClick={onClick}>
        Uložit
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Ukládáme…');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sekundární tlačítko disabled mít smí', () => {
    render(
      <Button variant="secondary" disabled>
        Předchozí
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('destruktivní varianta je barevně odlišená a nese sloveso s číslem', () => {
    render(<Button variant="destructive">Smazat 12 kontaktů</Button>);
    const button = screen.getByRole('button', { name: 'Smazat 12 kontaktů' });
    expect(button.className).toContain('bg-danger');
  });

  it('respektuje minimální cílovou plochu', () => {
    render(<Button variant="primary">Uložit</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
  });
});
