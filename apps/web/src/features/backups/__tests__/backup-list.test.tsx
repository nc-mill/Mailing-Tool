import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@mlain/i18n/messages/cs/onboarding.json' with { type: 'json' };
import { BackupList, type BackupListEntry } from '../backup-list';

const entry: BackupListEntry = {
  name: 'mlain-20260731T030000Z',
  createdAt: '2026-07-31T03:00:00.000Z',
  bytes: 184_320_000,
  contacts: 48_211,
  verifiedAt: null,
  verifiedOk: null,
};

const renderList = (entries: readonly BackupListEntry[]) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ onboarding: messages }}>
      <BackupList entries={entries} />
    </NextIntlClientProvider>,
  );

describe('BackupList', () => {
  it('prázdný stav vysvětluje a nabízí akci', () => {
    renderList([]);
    expect(screen.getByText(/Zatím žádná záloha/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spustit zálohu/ })).toBeInTheDocument();
  });

  it('vypíše počet kontaktů v záloze, ne jen velikost souboru', () => {
    renderList([entry]);
    expect(screen.getByText(/48\s?211/)).toBeInTheDocument();
  });

  it('neověřenou zálohu označí, místo aby mlčela', () => {
    renderList([entry]);
    expect(screen.getByText(/Zatím neověřeno/)).toBeInTheDocument();
  });

  it('selhané ověření odliší od úspěšného', () => {
    renderList([{ ...entry, verifiedAt: '2026-07-31T04:00:00.000Z', verifiedOk: false }]);
    expect(screen.getByText(/selhalo/)).toBeInTheDocument();
  });

  it('trvale zobrazuje varování, že klíč v záloze není', () => {
    renderList([entry]);
    expect(screen.getByRole('note')).toHaveTextContent(/keyring/i);
  });

  it('varování o klíči je vidět i u prázdného seznamu', () => {
    // Instalace bez jediné zálohy je přesně ta, u které je potřeba klíč uložit
    // dřív, než vzniknou data. Kdyby se varování ukazovalo až u prvního
    // řádku, přišlo by pozdě.
    renderList([]);
    expect(screen.getByRole('note')).toHaveTextContent(/SECRET_KEY_PREVIOUS/);
  });
});
