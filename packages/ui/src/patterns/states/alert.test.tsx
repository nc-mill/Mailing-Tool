import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it('unese samotný nadpis i samotný obsah', () => {
    const { rerender } = render(<Alert tone="warning" title="Doména není ověřená" />);
    expect(screen.getByText('Doména není ověřená')).toBeVisible();

    rerender(<Alert tone="error">Odesílání je pozastavené.</Alert>);
    expect(screen.getByText('Odesílání je pozastavené.')).toBeVisible();
  });

  it('chybu a varování ohlásí čtečce, informaci a úspěch ne', () => {
    const { rerender } = render(<Alert tone="error">Chyba</Alert>);
    expect(screen.getByRole('alert')).toBeVisible();

    rerender(<Alert tone="warning">Varování</Alert>);
    expect(screen.getByRole('alert')).toBeVisible();

    rerender(<Alert tone="info">Poznámka</Alert>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ke každému tónu patří ikona, takže barva není jediný rozlišovací znak', () => {
    for (const tone of ['info', 'warning', 'error', 'success'] as const) {
      const { container, unmount } = render(<Alert tone={tone}>Text</Alert>);
      expect(container.querySelector('svg'), `${tone} nemá ikonu`).not.toBeNull();
      unmount();
    }
  });

  it('propustí data atributy, aby na něj šlo v testech obrazovky mířit', () => {
    render(
      <Alert tone="warning" data-testid="pause-box">
        Pozastaveno
      </Alert>,
    );
    expect(screen.getByTestId('pause-box')).toHaveAttribute('data-tone', 'warning');
  });
});
