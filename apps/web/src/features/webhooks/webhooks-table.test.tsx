// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { WebhooksTable, type WebhookRow } from './webhooks-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const messages = { settings: csSettings };

const ACTIVE: WebhookRow = {
  id: 'w1',
  url: 'https://eshop.cz/hooks/mlain',
  description: 'Objednávky',
  event_types: ['contact.created'],
  status: 'active',
  disabled_reason: null,
  disabled_at: null,
  consecutive_failures: 0,
  last_success_at: '2026-07-31T10:00:00.000Z',
  last_failure_at: null,
};

function renderTable(endpoints: Result<{ data: WebhookRow[] }>, emptied = false) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <WebhooksTable
        endpoints={endpoints}
        canWrite
        workspaceId="ws1"
        slug="eshop"
        emptied={emptied}
        enableAction={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function manyEndpoints(count: number): WebhookRow[] {
  return Array.from({ length: count }, (_value, index) => ({ ...ACTIVE, id: `w${index}` }));
}

describe('WebhooksTable', () => {
  it('vypíše adresu, události a stav', () => {
    renderTable({ ok: true, data: { data: [ACTIVE] } });
    expect(screen.getByText('https://eshop.cz/hooks/mlain')).toBeInTheDocument();
    expect(screen.getByText('contact.created')).toBeInTheDocument();
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
  });

  it('u prázdného seznamu ukáže variantu first s vysvětlením a akcí', () => {
    renderTable({ ok: true, data: { data: [] } });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'first');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.webhooks.empty,
    );
    expect(within(empty).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('po smazání posledního webhooku ukáže variantu emptied, ne first', () => {
    renderTable({ ok: true, data: { data: [] } }, true);
    // Rozlišení S1 a S3 podle rozhodnutí R8. Varianta je v DOM, takže na ni
    // jde sáhnout, aniž by se kontrolovalo znění věty.
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'emptied');
    expect(within(empty).getByTestId('empty-explanation')).toHaveTextContent(
      csSettings.webhooks.emptyAfterDelete,
    );
  });

  it('u vypnutého webhooku ukáže pruh s vysvětlením a s tlačítkem zapnout', () => {
    renderTable({
      ok: true,
      data: {
        data: [
          {
            ...ACTIVE,
            status: 'disabled',
            disabled_reason: 'too_many_failures',
            disabled_at: '2026-07-31T09:00:00.000Z',
            consecutive_failures: 20,
          },
        ],
      },
    });
    expect(screen.getByRole('button', { name: 'Zapnout znovu' })).toBeInTheDocument();
  });

  it('u selhávajícího, ale zapnutého webhooku uvede počet neúspěchů', () => {
    renderTable({ ok: true, data: { data: [{ ...ACTIVE, consecutive_failures: 3 }] } });
    expect(screen.getByText(/3 neúspěchy po sobě/)).toBeInTheDocument();
  });

  it('u dvaceti webhooků ukáže stav přes limit', () => {
    renderTable({ ok: true, data: { data: manyEndpoints(20) } });
    expect(screen.getByText('Víc webhooků přidat nejde')).toBeInTheDocument();
    expect(screen.getByText(/20 webhooků, což je maximum/)).toBeInTheDocument();
  });

  it('u devatenácti webhooků limit nehlásí', () => {
    renderTable({ ok: true, data: { data: manyEndpoints(19) } });
    expect(screen.queryByText('Víc webhooků přidat nejde')).not.toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', async () => {
    renderTable({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/webhook-endpoints',
        code: 'forbidden',
        request_id: 'req_41',
      },
    });
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_41')).toBeInTheDocument();
  });
});
