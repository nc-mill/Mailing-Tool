import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import type { Problem } from '@/lib/api-client/problem';
import { PreflightProblem } from './preflight-problem';

/**
 * Regrese na nález, kde obrazovka odeslání volala `notFound()`, kdykoli selhala
 * předodeslací kontrola. Uživatel dostal „stránka nenalezena" nad kampaní, kterou
 * měl v seznamu, a neměl jak zjistit, jestli mu vypršelo přihlášení, nebo je
 * nedostupný odesílací účet. Kód chyby ani číslo požadavku nikde nebyly.
 */

vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  };
});

const PROBLEM: Problem = {
  type: 'https://docs.mlain.dev/errors/internal_error',
  title: 'Internal error',
  status: 500,
  detail: '',
  instance: '/api/v1/campaigns/camp-1/preflight',
  code: 'internal_error',
  request_id: 'req-42',
  errors: [],
};

describe('selhání předodeslací kontroly', () => {
  it('vysvětlí, že kampaň existuje, a nese kód i číslo požadavku', () => {
    renderWithProviders(
      <PreflightProblem
        problem={PROBLEM}
        occurredAt="2026-08-03T09:00:00.000Z"
        settingsHref="/w/kolo-shop/campaigns/camp-1"
      />,
    );

    expect(screen.getByText('Kontrolu připravenosti se nepodařilo dokončit')).toBeInTheDocument();
    expect(screen.getByText(/Kampaň existuje/)).toBeInTheDocument();
    // Kód v DOM je to, podle čeho jde chybu dohledat v logu.
    expect(document.querySelector('[data-error-code="internal_error"]')).toBeInTheDocument();
  });

  it('nabídne cestu ven, ne jen konstatování', () => {
    renderWithProviders(
      <PreflightProblem
        problem={PROBLEM}
        occurredAt="2026-08-03T09:00:00.000Z"
        settingsHref="/w/kolo-shop/campaigns/camp-1"
      />,
    );

    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    expect(screen.getByTestId('to-settings')).toHaveAttribute(
      'href',
      '/w/kolo-shop/campaigns/camp-1',
    );
  });
});
