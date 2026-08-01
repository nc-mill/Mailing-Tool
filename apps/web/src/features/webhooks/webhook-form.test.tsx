// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import type { WebhookSecretResult } from './actions';
import { WebhookFormView } from './webhook-form';

vi.mock('./actions', () => ({
  createWebhookAction: vi.fn(),
  updateWebhookAction: vi.fn(),
  deleteWebhookAction: vi.fn(),
  testWebhookAction: vi.fn(),
  enableWebhookAction: vi.fn(),
  retryDeliveryAction: vi.fn(),
}));

/**
 * Radix `Checkbox` uvnitř `<form>` vykreslí skryté pole a měří ho přes
 * `ResizeObserver`, který jsdom nemá. Prázdná náhrada stačí: měření jen
 * dorovnává velikost, na chování formuláře nemá vliv.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const messages = { settings: csSettings };

const EVENT_TYPES = ['contact.created', 'contact.updated', 'campaign.sent'];

function renderForm(
  initialState?: ActionState<WebhookSecretResult>,
  mode: 'create' | 'edit' = 'create',
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <WebhookFormView
        mode={mode}
        workspaceId="ws1"
        slug="eshop"
        availableEventTypes={EVENT_TYPES}
        action={vi.fn()}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('WebhookFormView', () => {
  it('má pole adresy, popisu a výběr událostí', () => {
    renderForm();
    expect(screen.getByLabelText('Adresa, kam události posílat')).toBeInTheDocument();
    expect(screen.getByLabelText('Popis')).toBeInTheDocument();
    expect(screen.getByText('Které události posílat')).toBeInTheDocument();
  });

  it('u adresy říká jen to, kam neposíláme, nikdy proč byla adresa zablokovaná', () => {
    renderForm();
    expect(screen.getByText(/Jen https/)).toBeInTheDocument();
    expect(screen.queryByText(/privátní rozsah/)).not.toBeInTheDocument();
  });

  it('upozorní předem na doručení nejméně jednou a na ML-Event-Id', () => {
    renderForm();
    expect(screen.getByText(/nejméně jednou/)).toBeInTheDocument();
    expect(screen.getByText(/ML-Event-Id/)).toBeInTheDocument();
  });

  it('seskupí typy událostí podle předpony', () => {
    renderForm();
    expect(screen.getByRole('group', { name: 'contact' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'campaign' })).toBeInTheDocument();
  });

  it('po vytvoření ukáže podpisový sekret právě jednou', () => {
    renderForm({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'webhooks.secret.title',
      data: { id: 'w1', secret: 'whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk' },
    });
    expect(
      screen.getByText('Zkopírujte si podpisový sekret teď. Už ho nikdy neuvidíme ani my.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk'),
    ).toBeInTheDocument();
  });

  it('chybu adresy ukáže u pole', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/webhook-endpoints',
        code: 'validation_failed',
        request_id: 'req_51',
        errors: [{ path: 'url', code: 'blocked_target', message: 'Tuhle adresu volat neumíme.' }],
      },
      fieldErrors: { url: ['Tuhle adresu volat neumíme.'] },
    });
    expect(screen.getByLabelText('Adresa, kam události posílat')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('v režimu úprav použije jiný nadpis a jiný text tlačítka', () => {
    renderForm(undefined, 'edit');
    expect(screen.getByRole('heading', { name: 'Úprava webhooku' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uložit změny' })).toBeInTheDocument();
  });
});
