// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { AuditTable, type AuditRow } from './audit-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROW: AuditRow = {
  id: 'a1',
  actor_type: 'user',
  actor_id: 'u1',
  actor_label: 'jana@firma.cz',
  action: 'api_key.created',
  target_type: 'api_key',
  target_id: 'k1',
  request_id: 'req_81',
  metadata: {},
  created_at: '2026-07-31T12:32:07.000Z',
};

function page(rows: AuditRow[]): Paginated<AuditRow> {
  return {
    data: rows,
    pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
  };
}

function renderTable(entries: Result<Paginated<AuditRow>>, filters: Record<string, string> = {}) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AuditTable
        entries={entries}
        filters={filters}
        basePath="/w/eshop/settings/audit"
        cursorDropped={false}
      />
    </NextIntlClientProvider>,
  );
}

describe('AuditTable', () => {
  it('vypíše čas, aktéra, akci a číslo požadavku', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Vytvořil klíč k API')).toBeInTheDocument();
    expect(screen.getByText('req_81')).toBeInTheDocument();
  });

  it('u cizí akce ukáže kód, ne prázdno', () => {
    renderTable({ ok: true, data: page([{ ...ROW, action: 'contacts.imported' }]) });
    expect(screen.getByText('contacts.imported')).toBeInTheDocument();
  });

  it('typ aktéra pojmenuje slovem', () => {
    renderTable({
      ok: true,
      data: page([{ ...ROW, actor_type: 'api_key', actor_label: 'E-shop' }]),
    });
    expect(screen.getByText('Klíč k API')).toBeInTheDocument();
  });

  it('u prázdného seznamu použije doslovný text ze specifikace', () => {
    renderTable({ ok: true, data: page([]) });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation').textContent!.length).toBeGreaterThan(20);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u prázdného seznamu s filtrem ukáže variantu filtered a zrušení filtru vrátí na základní cestu', async () => {
    renderTable({ ok: true, data: page([]) }, { action: 'api_key.created' });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    await userEvent.click(within(empty).getByRole('button', { name: 'Zrušit filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/settings/audit');
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', async () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/audit-log',
        code: 'forbidden',
        request_id: 'req_82',
      },
    });
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_82')).toBeInTheDocument();
  });

  it('připomene, jak dlouho se záznamy drží', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('Záznamy držíme 24 měsíců.')).toBeInTheDocument();
  });

  it('nikde nezobrazuje čísla stránek', () => {
    const { container } = renderTable({
      ok: true,
      data: {
        data: [ROW],
        pagination: { next_cursor: 'CUR', prev_cursor: null, has_more: true, limit: 50 },
      },
    });
    expect(container.textContent).not.toMatch(/Stránka \d/);
    expect(screen.getByRole('link', { name: 'Další' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/audit?cursor=CUR',
    );
  });

  it('u zastaralých dat ukáže pruh se stářím a data nechá čitelná', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <AuditTable
          entries={{ ok: true, data: page([ROW]) }}
          filters={{}}
          basePath="/w/eshop/settings/audit"
          cursorDropped={false}
          staleSince="2026-07-31T12:00:00.000Z"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('stale-banner')).toBeInTheDocument();
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
  });
});
