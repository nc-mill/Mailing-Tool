// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { GreetingLocaleSectionView, type GreetingLocaleSummary } from './greeting-locale-section';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
vi.mock('./actions', () => ({
  alignGreetingLocaleAction: vi.fn(),
  updateAddressFormAction: vi.fn(),
  deleteWorkspaceAction: vi.fn(),
}));

const messages = { settings: csSettings };

/** Stav, ve kterém uživatel vadu nahlásil: projekt česky, kontakty zděděné v angličtině. */
const MISMATCHED: GreetingLocaleSummary = {
  workspace_locale: 'cs',
  total: 55,
  mismatched: 52,
  by_locale: [
    { locale: 'en', count: 52 },
    { locale: 'cs', count: 3 },
  ],
};

function renderSection(
  summary: GreetingLocaleSummary = MISMATCHED,
  options: {
    canWrite?: boolean;
    action?: (p: ActionState, f: FormData) => Promise<ActionState>;
  } = {},
) {
  const action = options.action ?? vi.fn(async () => IDLE);
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <GreetingLocaleSectionView
        workspaceId="ws1"
        canWrite={options.canWrite ?? true}
        summary={summary}
        action={action}
      />
    </NextIntlClientProvider>,
  );
  return action;
}

describe('GreetingLocaleSectionView', () => {
  it('řekne, kolik kontaktů má jiný jazyk, a rozepíše to po jazycích', () => {
    renderSection();
    expect(screen.getByTestId('greeting-locale-mismatched')).toHaveTextContent('52');
    // Jazyk se vypisuje jménem, ne kódem: „en" uživateli nic neříká.
    expect(screen.getByText(/angličtina/i)).toBeInTheDocument();
  });

  it('u srovnaného projektu nenabízí nic k opravě', () => {
    renderSection({
      workspace_locale: 'cs',
      total: 3,
      mismatched: 0,
      by_locale: [{ locale: 'cs', count: 3 }],
    });
    expect(screen.getByTestId('greeting-locale-aligned')).toBeInTheDocument();
    expect(screen.queryByTestId('greeting-locale-mismatched')).not.toBeInTheDocument();
  });

  it('bez oprávnění zápisu tlačítko nenabídne, ale stav ukáže', () => {
    renderSection(MISMATCHED, { canWrite: false });
    expect(screen.getByTestId('greeting-locale-mismatched')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sjednotit jazyk/i })).not.toBeInTheDocument();
  });

  /**
   * Přepočet se NESMÍ spustit hned po kliknutí: mění jazyk u desítek tisíc lidí
   * a uživatel musí předem vidět, co to udělá se zamknutými tvary.
   */
  it('spustí přepočet až po potvrzení dialogu', async () => {
    const action = renderSection();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Sjednotit jazyk/i }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(/Ručně potvrzené tvary zůstanou/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sjednotit a přepočítat' }));
    expect(action).toHaveBeenCalledTimes(1);
    const formData = (action as unknown as { mock: { calls: [ActionState, FormData][] } }).mock
      .calls[0]![1];
    expect(formData.get('workspace_id')).toBe('ws1');
  });
});
