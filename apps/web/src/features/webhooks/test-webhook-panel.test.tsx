// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { TestWebhookPanelView } from './test-webhook-panel';

vi.mock('./actions', () => ({
  createWebhookAction: vi.fn(),
  updateWebhookAction: vi.fn(),
  deleteWebhookAction: vi.fn(),
  testWebhookAction: vi.fn(),
  enableWebhookAction: vi.fn(),
  retryDeliveryAction: vi.fn(),
}));

const messages = { settings: csSettings };

function renderPanel(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <TestWebhookPanelView
        workspaceId="ws1"
        slug="eshop"
        endpointId="w1"
        action={vi.fn()}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('TestWebhookPanelView', () => {
  it('nabídne poslání testovací události', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Poslat testovací událost' })).toBeInTheDocument();
  });

  it('výsledek ukáže inline v místě akce, ne toastem', () => {
    // ODCHYLKA OD PLÁNU: endpoint testu vrací `202 { event_id }`, tedy zařazení
    // do fronty, ne synchronní odpověď se stavovým kódem a trváním. Text i test
    // proto mluví o zařazení a odkazují na log doručení, viz komentář v `actions.ts`.
    renderPanel({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.test.successTitle',
    });
    expect(screen.getByText('Testovací událost jsme zařadili')).toBeInTheDocument();
    expect(screen.getByText(/v logu doručení/)).toBeInTheDocument();
  });

  it('výsledek zůstává, dokud ho uživatel nepřepíše', () => {
    renderPanel({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.test.successTitle',
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('u chyby ukáže blok s request_id', async () => {
    renderPanel({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Service unavailable',
        status: 503,
        detail: '',
        instance: '/api/v1/webhook-endpoints/w1/test',
        code: 'service_unavailable',
        request_id: 'req_71',
      },
      fieldErrors: {},
    });
    // Číslo požadavku je ve sbalených technických detailech, viz `ErrorBlock`.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_71')).toBeInTheDocument();
  });

  it('tlačítko nemá disabled ani během odesílání', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Poslat testovací událost' })).not.toHaveAttribute(
      'disabled',
    );
  });
});
