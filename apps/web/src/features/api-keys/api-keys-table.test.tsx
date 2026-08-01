// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { ApiKeysTable, type ApiKeyRow } from './api-keys-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
vi.mock('./actions', () => ({
  createApiKeyAction: vi.fn(),
  rotateApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));

const messages = { settings: csSettings };

const ROWS: ApiKeyRow[] = [
  {
    id: 'k1',
    name: 'E-shop, objednávky',
    prefix: 'ugzmhvhf',
    kind: 'secret',
    scopes: ['contacts:read', 'contacts:write'],
    created_by_name: 'Jana Nováková',
    last_used_at: '2026-07-30T10:00:00.000Z',
    expires_at: null,
    revoked_at: null,
    previous_expires_at: null,
    created_at: '2026-05-01T10:00:00.000Z',
  },
  {
    id: 'k2',
    name: 'Starý import',
    prefix: 'abcdefgh',
    kind: 'secret',
    scopes: ['contacts:read'],
    created_by_name: 'Petr Svoboda',
    last_used_at: null,
    expires_at: null,
    revoked_at: '2026-07-01T10:00:00.000Z',
    previous_expires_at: null,
    created_at: '2026-02-01T10:00:00.000Z',
  },
];

function renderTable(keys: Result<{ data: ApiKeyRow[] }>, canWrite = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ApiKeysTable
        keys={keys}
        canWrite={canWrite}
        workspaceId="ws1"
        slug="eshop"
        onCreate={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('ApiKeysTable', () => {
  it('ukáže jen prefix, nikdy sekret', () => {
    const { container } = renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText(/ml_live_ugzmhvhf/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('__79_Pv6');
  });

  it('u prázdného seznamu ukáže vysvětlení a primární akci, strukturálně', () => {
    renderTable({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.apiKeys.empty,
    );
    expect(
      within(empty).getByRole('button', { name: csSettings.apiKeys.emptyAction }),
    ).toBeInTheDocument();
  });

  it('stav klíče sděluje slovem, ne jen barvou', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
    expect(screen.getByText('Zrušený')).toBeInTheDocument();
  });

  it('u nepoužitého klíče napíše Nikdy, ne prázdno', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('Nikdy')).toBeInTheDocument();
  });

  it('u zrušeného klíče nenabídne rotaci ani revokaci', () => {
    renderTable({ ok: true, data: { data: ROWS } });
    expect(screen.getAllByRole('button', { name: 'Rotovat sekret' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Zrušit klíč' })).toHaveLength(1);
  });

  it('u klíče v přechodném období uvede, do kdy platí starý sekret', () => {
    renderTable({
      ok: true,
      data: {
        // Datum musí být v budoucnosti, jinak přechodné období už doběhlo
        // a hlášku by tabulka právem neukázala.
        data: [{ ...ROWS[0]!, previous_expires_at: '2099-07-31T12:00:00.000Z' }],
      },
    });
    expect(screen.getByText(/starý sekret platí do/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže klíče, ale žádné akce', () => {
    renderTable({ ok: true, data: { data: ROWS } }, false);
    expect(screen.getByText('E-shop, objednávky')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotovat sekret' })).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', async () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/api-keys',
        code: 'service_unavailable',
        request_id: 'req_31',
      },
    });
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_31')).toBeInTheDocument();
  });
});
