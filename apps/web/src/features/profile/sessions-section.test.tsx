// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { SessionsSectionView, type SessionRow } from './sessions-section';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
// Pohled si obě akce bere propem, takže stačí prázdné náhrady.
vi.mock('./actions', () => ({ revokeSessionAction: vi.fn(), logoutAllAction: vi.fn() }));

const messages = { settings: csSettings };

const ROWS: SessionRow[] = [
  {
    id: 's1',
    ip: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
    last_used_at: '2026-07-31T12:00:00.000Z',
    created_at: '2026-07-20T09:00:00.000Z',
    current: true,
  },
  {
    id: 's2',
    ip: '10.0.0.5',
    user_agent: '',
    last_used_at: '2026-07-30T18:00:00.000Z',
    created_at: '2026-07-01T09:00:00.000Z',
    current: false,
  },
];

function renderSection(sessions: Result<{ data: SessionRow[] }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SessionsSectionView sessions={sessions} revokeAction={vi.fn()} onLogoutAll={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('SessionsSectionView', () => {
  it('vypíše relace a označí tu aktuální', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Tato relace')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.10/)).toBeInTheDocument();
  });

  it('u aktuální relace nenabídne odhlášení jednoho zařízení', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getAllByRole('button', { name: 'Odhlásit toto zařízení' })).toHaveLength(1);
  });

  it('u neznámého prohlížeče použije náhradní text', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Neznámé zařízení')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže vysvětlení a akci, ne prázdnou tabulku', () => {
    renderSection({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.profile.sessions.empty,
    );
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', async () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/auth/sessions',
        code: 'dependency_timeout',
        request_id: 'req_7',
      },
    });
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    // ODCHYLKA OD PLÁNU, vynucená komponentou P05: technické detaily kreslí
    // Radix `Collapsible`, který sbalený obsah do dokumentu vůbec nevloží.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_7')).toBeInTheDocument();
  });

  it('odhlášení ze všech zařízení má potvrzovací dialog s počtem a s větou o téhle kartě', async () => {
    renderSection({ ok: true, data: { data: ROWS } });
    await userEvent.click(screen.getByRole('button', { name: 'Odhlásit ze všech zařízení' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/2 relace, tuhle kartu nevyjímaje/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nechat přihlášené' })).toBeInTheDocument();
  });

  it('u chyby se tlačítko odhlášení ze všech zařízení nevykreslí', () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/auth/sessions',
        code: 'service_unavailable',
        request_id: '',
      },
    });
    expect(
      screen.queryByRole('button', { name: 'Odhlásit ze všech zařízení' }),
    ).not.toBeInTheDocument();
  });
});
