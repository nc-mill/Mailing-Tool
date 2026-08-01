// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { DeliveriesTable, type DeliveryRow } from './deliveries-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ROW: DeliveryRow = {
  id: 'd1',
  event_id: 'e1',
  event_type: 'contact.created',
  status: 'failed',
  attempt: 3,
  next_attempt_at: '2026-07-31T13:00:00.000Z',
  response_status: 500,
  response_body_snippet: 'Internal Server Error',
  duration_ms: 812,
  error_code: null,
  delivered_at: null,
  created_at: '2026-07-31T12:00:00.000Z',
};

function page(rows: DeliveryRow[]): Paginated<DeliveryRow> {
  return {
    data: rows,
    pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
  };
}

function renderTable(
  deliveries: Result<Paginated<DeliveryRow>>,
  filters: Record<string, string> = {},
  cursorDropped = false,
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DeliveriesTable
        deliveries={deliveries}
        filters={filters}
        basePath="/w/eshop/settings/webhooks/w1"
        cursorDropped={cursorDropped}
        canWrite
        workspaceId="ws1"
        slug="eshop"
        endpointId="w1"
        retryAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('DeliveriesTable', () => {
  it('vypíše událost, výsledek, pokus a odpověď', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByText('contact.created')).toBeInTheDocument();
    expect(screen.getByText('Nedoručeno')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('u prázdného seznamu bez filtru ukáže vysvětlení', () => {
    renderTable({ ok: true, data: page([]) });
    // Strukturálně, ne na doslovné znění (kritérium 76c): stav má vysvětlení
    // a aspoň jednu akci, a to hlídá i sama komponenta z P05.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation').textContent!.length).toBeGreaterThan(20);
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('u prázdného seznamu s filtrem popíše filtr slovy a zrušení filtru vrátí na základní cestu', async () => {
    renderTable({ ok: true, data: page([]) }, { status: 'failed' });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    // Filtr se zopakuje slovy, ne jménem parametru v URL.
    expect(within(empty).getByText(/Nedoručeno/)).toBeInTheDocument();
    await userEvent.click(within(empty).getByRole('button', { name: 'Zrušit filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/settings/webhooks/w1');
  });

  it('u neplatného kurzoru ukáže hlášku a první stránku, ne prázdno ani chybu', () => {
    renderTable({ ok: true, data: page([ROW]) }, {}, true);
    expect(screen.getByText(/Ukazujeme první stránku stejného filtru/)).toBeInTheDocument();
    expect(screen.getByText('contact.created')).toBeInTheDocument();
  });

  it('nikde nezobrazuje čísla stránek', () => {
    const { container } = renderTable({
      ok: true,
      data: {
        data: [ROW],
        pagination: { next_cursor: 'CUR', prev_cursor: null, has_more: true, limit: 50 },
      },
    });
    expect(screen.getByRole('link', { name: 'Další' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/webhooks/w1?cursor=CUR',
    );
    expect(container.textContent).not.toMatch(/Stránka \d/);
  });

  it('u zablokované adresy vysvětlí, co s tím, bez uvedení rozsahu', () => {
    renderTable({
      ok: true,
      data: page([{ ...ROW, error_code: 'blocked_target', response_status: null }]),
    });
    expect(screen.getByText(/nezměnil DNS záznam/)).toBeInTheDocument();
    expect(screen.queryByText(/privátní rozsah/)).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id a s tlačítkem Zkusit znovu', async () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Dependency timeout',
        status: 504,
        detail: '',
        instance: '/api/v1/webhook-deliveries',
        code: 'dependency_timeout',
        request_id: 'req_61',
      },
    });
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_61')).toBeInTheDocument();
  });

  it('u neúspěšného doručení nabídne ruční opakování', () => {
    renderTable({ ok: true, data: page([ROW]) });
    expect(screen.getByRole('button', { name: 'Zkusit doručit znovu' })).toBeInTheDocument();
  });

  it('u úspěšného doručení opakování nenabízí', () => {
    renderTable({ ok: true, data: page([{ ...ROW, status: 'succeeded', response_status: 200 }]) });
    expect(screen.queryByRole('button', { name: 'Zkusit doručit znovu' })).not.toBeInTheDocument();
  });
});
