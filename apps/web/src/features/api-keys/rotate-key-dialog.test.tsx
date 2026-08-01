// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ApiKeyRow } from './api-keys-table';
import { RotateKeyDialogView } from './rotate-key-dialog';

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

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <RotateKeyDialogView
        apiKey={KEY}
        workspaceId="ws1"
        slug="eshop"
        onClose={vi.fn()}
        action={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

async function openConfirmation() {
  await userEvent.click(screen.getByRole('button', { name: 'Rotovat sekret' }));
}

describe('RotateKeyDialogView', () => {
  it('nadpis jmenuje konkrétní klíč', async () => {
    renderDialog();
    await openConfirmation();
    expect(
      screen.getByRole('heading', { name: 'Rotovat sekret klíče E-shop, objednávky?' }),
    ).toBeInTheDocument();
  });

  it('vyjmenuje následky včetně toho, že se oprávnění nemění', async () => {
    renderDialog();
    await openConfirmation();
    expect(screen.getByText(/nový sekret a ukážeme ho jednou/)).toBeInTheDocument();
    expect(
      screen.getByText(/přestanou fungovat, jakmile doběhne přechodné období/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Oprávnění klíče se nemění/)).toBeInTheDocument();
  });

  /**
   * ODCHYLKA OD PLÁNU, vynucená rozhraním P05: plán čekal nativní `<select>`
   * s `<option>`. Výběr je `SelectField` nad Radixem, takže volby existují
   * teprve v otevřeném seznamu a v jsdom je Radix neotevře (chybí mu
   * `elementFromPoint` a zachytávání ukazatele). Testuje se proto to, co
   * v DOM skutečně je: pojmenovaný spouštěč a hodnota ve skrytém poli.
   * Volba tří hodnot je ověřená průchodem v prohlížeči.
   */
  it('nabídne výběr přechodného období, ne volné pole', () => {
    renderDialog();
    expect(
      screen.getByRole('combobox', { name: 'Přechodné období pro starý sekret' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Přechodné období pro starý sekret')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('vyžaduje zaškrtnutí konkrétní věty, ne obecného souhlasu', async () => {
    renderDialog();
    await openConfirmation();
    expect(screen.getByLabelText('Rozumím, že starý sekret přestane platit')).toBeInTheDocument();
    expect(screen.queryByLabelText('Souhlasím')).not.toBeInTheDocument();
  });

  it('tlačítko ústupu je pojmenované slovesem', async () => {
    renderDialog();
    await openConfirmation();
    expect(screen.getByRole('button', { name: 'Nechat současný sekret' })).toBeInTheDocument();
  });

  it('výchozí hodnota přechodného období je nula', () => {
    const { container } = renderDialog();
    expect(container.querySelector('input[name="grace_seconds"]')).toHaveValue('0');
  });

  it('následky dialogu jmenují zvolené přechodné období', async () => {
    renderDialog();
    await openConfirmation();
    // Uvnitř dialogu, protože stejný text nese i výběr pod ním.
    expect(
      within(screen.getByRole('dialog')).getByText(/Bez přechodného období/),
    ).toBeInTheDocument();
  });
});
