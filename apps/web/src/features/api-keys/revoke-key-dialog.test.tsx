// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ApiKeyRow } from './api-keys-table';
import { RevokeKeyDialogView } from './revoke-key-dialog';

vi.mock('./actions', () => ({
  createApiKeyAction: vi.fn(),
  rotateApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));

const messages = { settings: csSettings };

const KEY: ApiKeyRow = {
  id: 'k1',
  name: 'E-shop, objednávky',
  prefix: 'ugzmhvhf',
  kind: 'secret',
  scopes: ['contacts:read'],
  created_by_name: 'Jana Nováková',
  last_used_at: '2026-07-30T10:00:00.000Z',
  expires_at: null,
  revoked_at: null,
  previous_expires_at: null,
  created_at: '2026-05-01T10:00:00.000Z',
};

function renderDialog(lastUsedAt: string | null = KEY.last_used_at) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <RevokeKeyDialogView
        apiKey={{ ...KEY, last_used_at: lastUsedAt }}
        workspaceId="ws1"
        slug="eshop"
        onClose={vi.fn()}
        action={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('RevokeKeyDialogView', () => {
  it('nadpis jmenuje konkrétní klíč a tlačítko taky', () => {
    renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Zrušit klíč E-shop, objednávky?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Zrušit klíč E-shop, objednávky' }),
    ).toBeInTheDocument();
  });

  it('řekne, že akce je okamžitá a nevratná', () => {
    renderDialog();
    expect(screen.getByText(/přestanou fungovat okamžitě/)).toBeInTheDocument();
    expect(screen.getByText(/Obnovit ho nejde/)).toBeInTheDocument();
  });

  it('uvede, kdy byl klíč naposledy použit', () => {
    renderDialog();
    expect(screen.getByText(/Naposledy byl použit/)).toBeInTheDocument();
  });

  it('u nepoužitého klíče napíše Nikdy, ne prázdno', () => {
    renderDialog(null);
    expect(screen.getByText(/Nikdy/)).toBeInTheDocument();
  });

  it('vyžaduje zaškrtnutí konkrétní věty', () => {
    renderDialog();
    expect(
      screen.getByLabelText('Rozumím, že zrušený klíč už nepůjde obnovit'),
    ).toBeInTheDocument();
  });

  it('tlačítko ústupu je pojmenované slovesem, ne slovem Ne', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Nechat klíč' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ne' })).not.toBeInTheDocument();
  });
});
