// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { SystemMailScreen } from './system-mail-screen';
import type { SystemMailStatus } from './types';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
vi.mock('./actions', () => ({ saveSystemMailSettingsAction: vi.fn() }));

const messages = { settings: csSettings };

/**
 * Projekt bez jediného odesílacího účtu.
 *
 * DŘÍV TU BYL PROJEKT S ÚČTEM TYPU SES a měřilo se, že mu obrazovka řekne
 * „systémová pošta nefunguje". Od doplnění větve pro SES je to nepravda: účtem
 * typu SES pošta odejde, viz fixture `SES` níž. Nefunkční stav zbyl jen tenhle
 * a chybějící vybraný účet.
 */
const NO_ACCOUNT: SystemMailStatus = {
  available: false,
  reason: 'no_account',
  provider_id: null,
  provider_type: null,
  from_address: 'mlain@mlain.test',
  from_source: 'app_url',
  capable_types: ['smtp', 'ses'],
  settings: { provider_id: null, from_address: null },
  accounts: [],
};

const SES: SystemMailStatus = {
  available: true,
  reason: null,
  provider_id: '11111111-1111-4111-8111-111111111111',
  provider_type: 'ses',
  from_address: 'mlain@firma.cz',
  from_source: 'verified_domain',
  capable_types: ['smtp', 'ses'],
  settings: { provider_id: null, from_address: null },
  accounts: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Amazon SES',
      type: 'ses',
      status: 'ready',
      is_default: true,
      capable: true,
      domain: 'firma.cz',
    },
  ],
};

const SMTP: SystemMailStatus = {
  available: true,
  reason: null,
  provider_id: '22222222-2222-4222-8222-222222222222',
  provider_type: 'smtp',
  from_address: 'mlain@firma.cz',
  from_source: 'verified_domain',
  capable_types: ['smtp', 'ses'],
  settings: { provider_id: null, from_address: null },
  accounts: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Firemní SMTP',
      type: 'smtp',
      status: 'ready',
      is_default: true,
      capable: true,
      domain: 'firma.cz',
    },
  ],
};

function renderScreen(status: SystemMailStatus, canConfigure = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SystemMailScreen
        status={status}
        workspaceId="ws1"
        slug="eshop"
        canConfigure={canConfigure}
        action={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('SystemMailScreen', () => {
  /**
   * Jádro celé opravy: projekt, který systémovou poštu odeslat nemá čím, musí
   * na obrazovce vidět, že nefunguje, PROČ, a co kvůli tomu nejde. Dřív o tom
   * nebylo nikde ani slovo a uživatel hledal chybu u sebe.
   */
  it('bez odesílacího účtu řekne, že pošta nefunguje, proč a co kvůli tomu nejde', () => {
    renderScreen(NO_ACCOUNT);
    expect(screen.getByText('Systémová pošta nefunguje')).toBeInTheDocument();
    expect(
      screen.getByText(/Projekt nemá odesílací účet, kterým by šlo e-mail poslat/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Odejdou účtem typu SES i SMTP/)).toBeInTheDocument();
    expect(screen.getByText(/Pozvánka do projektu e-mailem/)).toBeInTheDocument();
    expect(screen.getByText(/mlain reset-password/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Přejít na Odesílání' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/sending',
    );
  });

  /**
   * Druhá strana téže opravy. Instalace po průvodci má typicky jediný účet typu
   * SES a do doplnění větve pro SES jí obrazovka hlásila, že pošta nefunguje.
   * Dnes funguje a obrazovka to musí říct, jinak by uživatel hledal náhradní
   * cestu, kterou nepotřebuje.
   */
  it('u účtu typu SES hlásí funkční poštu, ne omezení', () => {
    renderScreen(SES);
    expect(screen.getByText('Systémová pošta funguje')).toBeInTheDocument();
    expect(screen.getByText(/Odesílá se účtem Amazon SES typu ses/)).toBeInTheDocument();
    expect(screen.queryByText(/Co kvůli tomu nejde/)).not.toBeInTheDocument();
  });

  it('vždycky ukáže adresu odesílatele i to, odkud se vzala', () => {
    renderScreen(NO_ACCOUNT);
    expect(
      screen.getByText('Systémové e-maily chodí z adresy mlain@mlain.test.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Odvozeno z adresy aplikace/)).toBeInTheDocument();
  });

  it('u funkční pošty vysvětlení omezení nezobrazuje', () => {
    renderScreen(SMTP);
    expect(screen.getByText('Systémová pošta funguje')).toBeInTheDocument();
    expect(screen.queryByText(/Co kvůli tomu nejde/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Systémové e-maily chodí z adresy mlain@firma.cz.'),
    ).toBeInTheDocument();
  });

  it('bez oprávnění měnit nastavení ukáže důvod místo formuláře', () => {
    renderScreen(SMTP, false);
    expect(screen.getByText(/Systémovou poštu nastavuje Správce a Vlastník/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uložit nastavení' })).not.toBeInTheDocument();
  });
});
