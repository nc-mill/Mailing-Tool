import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsentHistory, type ConsentRecord } from './consent-history';
import { renderWithProviders } from './test-utils';

const push = vi.fn();

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const granted: ConsentRecord = {
  id: 'k-1',
  purpose: 'email_marketing',
  scope_list_id: null,
  status: 'granted',
  legal_basis: 'consent',
  source: 'form',
  consent_text: 'Souhlasím se zasíláním novinek.',
  evidence: {
    page_url: 'https://firma.cz/newsletter',
    user_agent: 'Mozilla/5.0',
    ip: null,
    double_opt_in_at: '2026-06-12T14:25:00.000Z',
  },
  occurred_at: '2026-06-12T14:20:00.000Z',
  created_at: '2026-06-12T14:20:00.000Z',
};

const withdrawn: ConsentRecord = {
  id: 'k-2',
  purpose: 'email_marketing',
  scope_list_id: 'l-1',
  status: 'withdrawn',
  legal_basis: 'consent',
  source: 'preference_center',
  consent_text: null,
  evidence: {},
  occurred_at: '2026-07-20T09:00:00.000Z',
  created_at: '2026-07-20T09:00:00.000Z',
};

function renderHistory(records: ConsentRecord[]) {
  return renderWithProviders(
    <ConsentHistory
      basePath="/w/eshop/contacts"
      contact={{ id: 'c-1', name: 'Jana Nováková' }}
      records={records}
    />,
  );
}

describe('ConsentHistory', () => {
  it('u záznamu ukáže účel, stav, právní základ, kdy a odkud', () => {
    renderHistory([granted]);
    const record = screen.getByTestId('consent-record');
    expect(record).toHaveTextContent('Zasílání newsletteru');
    expect(within(record).getByTestId('consent-status')).toHaveTextContent('Udělen');
    expect(record).toHaveTextContent('Souhlas');
    expect(record).toHaveTextContent('Formulář na webu');
    expect(record).toHaveTextContent('12.');
  });

  it('vypíše doklad větami, ne výpisem JSON', () => {
    renderHistory([granted]);
    const record = screen.getByTestId('consent-record');
    expect(record).toHaveTextContent('Souhlasím se zasíláním novinek.');
    expect(record).toHaveTextContent('https://firma.cz/newsletter');
    expect(record).toHaveTextContent('Potvrzeno e-mailem');
  });

  it('u vypnutého ukládání IP to řekne větou, ne prázdnem', () => {
    // `ip: null` znamená „projekt si adresy neukládá" (rozhodnutí R8), ne „nevíme".
    // Prázdná buňka by obojí spojila do jednoho, přitom je to pro doklad rozdíl.
    renderHistory([granted]);
    expect(screen.getByText('IP adresa se v tomhle projektu neukládá')).toBeInTheDocument();
  });

  it('u běžného zápisu neopakuje datum podruhé jako „Zapsáno"', () => {
    // `occurred_at` a `created_at` se u běžného zápisu liší o zlomek sekundy.
    // Doslovné porovnání řetězců by proto větu ukázalo u každého řádku.
    renderHistory([{ ...granted, created_at: '2026-06-12T14:20:00.480Z' }]);
    expect(screen.queryByText(/^Zapsáno/)).toBeNull();
  });

  it('u historického souhlasu z importu ukáže i datum zápisu', () => {
    renderHistory([
      {
        ...granted,
        occurred_at: '2024-03-01T10:00:00.000Z',
        created_at: '2026-06-12T14:20:00.000Z',
      },
    ]);
    expect(screen.getByText(/^Zapsáno/)).toBeInTheDocument();
  });

  it('rozliší souhlas pro celý projekt a pro jeden seznam', () => {
    renderHistory([granted, withdrawn]);
    const records = screen.getAllByTestId('consent-record');
    expect(records[0]).toHaveTextContent('Platí pro celý projekt');
    expect(records[1]).toHaveTextContent('Platí jen pro jeden seznam');
  });

  it('odvolání ukáže jako odvolání, ne jako další souhlas', () => {
    renderHistory([withdrawn]);
    expect(screen.getByTestId('consent-status')).toHaveTextContent('Odvolán');
  });

  it('záznam bez důkazů to řekne, místo aby nechal prázdno', () => {
    renderHistory([withdrawn]);
    expect(screen.getByText('Bez dalšího dokladu')).toBeInTheDocument();
  });

  it('nenabízí žádnou akci, protože historie souhlasů je append only', () => {
    renderHistory([granted, withdrawn]);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('prázdná historie má vysvětlující stav, ne prázdnou stránku', () => {
    renderHistory([]);
    expect(screen.getByText('Zatím tu není žádný záznam')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-record')).toBeNull();
  });

  it('prázdný stav nenabízí založení souhlasu, jen návrat na kontakt', () => {
    // Souhlas vzniká projevem vůle toho člověka, ne kliknutím správce. Tlačítko
    // „Zapsat souhlas" by tady bylo pozvánkou k výrobě dokladu, který nikdo nedal.
    renderHistory([]);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Zpět na kontakt');
  });

  it('vede odkazem zpět na detail kontaktu', () => {
    renderHistory([granted]);
    expect(screen.getByRole('link', { name: 'Zpět na kontakt' })).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1',
    );
  });
});
