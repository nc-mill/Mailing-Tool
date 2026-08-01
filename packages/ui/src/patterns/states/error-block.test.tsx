import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBlock } from './error-block';

const labels = {
  technicalDetails: 'Podrobnosti pro technickou podporu',
  code: 'Kód',
  requestId: 'Číslo požadavku',
  time: 'Čas',
  copyBlock: 'Zkopírovat podrobnosti',
  copied: 'Zkopírováno',
  tryAgain: 'Zkusit znovu',
};

const problem = {
  code: 'db_timeout',
  requestId: 'req_01J8XK2M9P',
  occurredAt: new Date('2026-07-31T12:32:07.000Z'),
};

describe('ErrorBlock', () => {
  it('má nadpis, důvod a akci, v tomhle pořadí', () => {
    render(
      <ErrorBlock
        title="Kontakty se nepodařilo načíst"
        reason="Databáze neodpověděla včas. Většinou je to přechodné a druhý pokus projde."
        problem={problem}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Kontakty se nepodařilo načíst' })).toBeVisible();
    expect(screen.getByText(/Databáze neodpověděla včas/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeVisible();
  });

  it('kód chyby je v DOM jako data-error-code kvůli testům', () => {
    render(
      <ErrorBlock
        title="Chyba"
        reason="Důvod."
        problem={problem}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.getByTestId('error-block')).toHaveAttribute('data-error-code', 'db_timeout');
  });

  it('technické podrobnosti jsou sbalené, ale dostupné', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBlock
        title="Chyba"
        reason="Důvod."
        problem={problem}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.queryByText('req_01J8XK2M9P')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Podrobnosti pro technickou podporu/ }));
    expect(screen.getByText('req_01J8XK2M9P')).toBeVisible();
    expect(screen.getByText('db_timeout')).toBeVisible();
  });

  it('umí zkopírovat celý blok naráz', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ErrorBlock
        title="Chyba"
        reason="Důvod."
        problem={problem}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Podrobnosti pro technickou podporu/ }));
    await user.click(screen.getByRole('button', { name: 'Zkopírovat podrobnosti' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain('db_timeout');
    expect(writeText.mock.calls[0]![0]).toContain('req_01J8XK2M9P');
  });

  it('neznámý kód zobrazí detail ze serveru, nikdy prázdno', () => {
    render(
      <ErrorBlock
        title="Něco se nepovedlo"
        reason="Neznámý stav objednávky."
        problem={{ code: 'weird_unknown_code', requestId: 'req_x', occurredAt: new Date() }}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.getByText('Neznámý stav objednávky.')).toBeVisible();
  });
});
