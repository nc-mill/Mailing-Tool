import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsTable, type ContactRow } from './contacts-table';
import { renderWithProviders } from './test-utils';

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  bulkDeleteContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  exportContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  bulkTagContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

// Serverové akce se musí odstínit VŠECHNY, jinak se přes ně načte
// `@/lib/api-client/*` s importem `server-only`, který v testu vyhodí
// „This module cannot be imported from a Client Component module" a shodí
// celý soubor ještě před prvním testem.
const confirmContactsAction = vi.fn();
vi.mock('./confirm-actions', () => ({
  confirmContactsAction: (...args: unknown[]) => confirmContactsAction(...args),
}));

vi.mock('./list-actions', () => ({
  addContactsToListAction: vi.fn().mockResolvedValue({
    status: 'success',
    summary: { confirmed: 0, pending: 0, already: 0, blocked: 0 },
  }),
}));

const rows: ContactRow[] = [
  {
    id: 'c-1',
    email: 'jana@firma.cz',
    name: 'Jana Nováková',
    greeting: {
      greeting: 'Dobrý den, Jano',
      first_name: 'Jana',
      first_name_vocative: 'Jano',
      vocative_confidence: 'high',
      vocative_locked: false,
      locale: 'cs',
    },
    status: 'active',
    processing_restricted: false,
    snooze_until: null,
    anonymized_at: null,
    lists: ['Zákazníci'],
    tags: ['Brno'],
    created_at: '2026-06-12T14:20:00.000Z',
  },
  {
    id: 'c-2',
    email: 'petr@firma.cz',
    name: null,
    greeting: {
      greeting: 'Dobrý den',
      first_name: null,
      first_name_vocative: null,
      vocative_confidence: 'none',
      vocative_locked: false,
      locale: 'cs',
    },
    status: 'unconfirmed',
    processing_restricted: false,
    snooze_until: null,
    anonymized_at: null,
    lists: [],
    tags: [],
    created_at: '2026-07-01T08:00:00.000Z',
  },
];

function renderTable(props: Partial<React.ComponentProps<typeof ContactsTable>> = {}) {
  return renderWithProviders(
    <ContactsTable
      basePath="/w/eshop/contacts"
      workspaceId="w-1"
      rows={rows}
      pagination={{ next_cursor: 'c2', prev_cursor: null, has_more: true, limit: 50 }}
      total={{ count: 12480, precision: 'estimated' }}
      filters={{}}
      names={{ lists: {}, tags: {}, segments: {} }}
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  confirmContactsAction.mockReset().mockResolvedValue({
    status: 'success',
    outcomes: [
      {
        id: 'c-2',
        fromStatus: 'unconfirmed',
        changed: true,
        listsConfirmed: 0,
        suppressionBlocking: null,
      },
    ],
  });
});

describe('ContactsTable', () => {
  it('ukáže počet s vlnovkou, když je odhadovaný', () => {
    renderTable();
    expect(screen.getByText(/~/)).toBeInTheDocument();
    expect(screen.getByText(/12\s?480/)).toBeInTheDocument();
  });

  it('u přesného počtu vlnovku nepíše', () => {
    renderTable({ total: { count: 2, precision: 'exact' } });
    expect(screen.queryByText(/~/)).toBeNull();
  });

  it('nemá čísla stránek, jen tlačítko na další stránku se stejným filtrem', async () => {
    const user = userEvent.setup();
    renderTable({ filters: { status: 'active' } });
    expect(screen.queryByRole('link', { name: '2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Další' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?status=active&cursor=c2');
  });

  it('na poslední stránce další stránku nenabízí', () => {
    renderTable({
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
    });
    expect(screen.getByRole('button', { name: 'Další' })).toBeDisabled();
  });

  it('stav nese slovo, ne jen barvu', () => {
    renderTable();
    expect(screen.getByText('Aktivní')).toBeInTheDocument();
    expect(screen.getByText('Nepotvrzený')).toBeInTheDocument();
  });

  it('odkaz na detail je pojmenovaný adresou, ať čtečka ví, kam vede', () => {
    renderTable();
    expect(screen.getByLabelText('Otevřít kontakt jana@firma.cz')).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1',
    );
  });

  it('prázdný seznam vysvětlí pojem, nabídne tři cesty a nepíše o filtru', () => {
    renderTable({ rows: [], total: { count: 0, precision: 'exact' } });
    expect(
      screen.getByRole('heading', { name: 'Zatím tu nejsou žádné kontakty' }),
    ).toBeInTheDocument();
    const explanation = screen.getByTestId('empty-explanation');
    expect(explanation.textContent!.match(/[.!?]/g)!.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Naimportovat ze souboru' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Vytvořit přihlašovací formulář' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat jeden kontakt ručně' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Žádný kontakt neodpovídá' })).toBeNull();
  });

  it('prázdný výsledek filtru vypíše filtr slovy a nabídne dvě různá zrušení', async () => {
    const user = userEvent.setup();
    renderTable({
      rows: [],
      total: { count: 0, precision: 'exact' },
      filters: { list_id: 'l-1', status: 'active', q: 'novák' },
      names: { lists: { 'l-1': 'Zákazníci' }, tags: {}, segments: {} },
    });
    const state = screen.getByTestId('empty-state');
    expect(
      within(state).getByRole('heading', { name: 'Žádný kontakt neodpovídá' }),
    ).toBeInTheDocument();
    expect(state).toHaveTextContent('seznam Zákazníci');
    expect(state).toHaveTextContent('stav Aktivní');
    expect(state).toHaveTextContent('hledání');

    await user.click(within(state).getByRole('button', { name: 'Zrušit všechny filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts');

    await user.click(within(state).getByRole('button', { name: 'Zrušit jen hledání' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-1&status=active');
  });

  it('vybraný řádek ohlásí pruh s počtem a nabídne hromadné akce', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    const checkboxes = within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' });
    await user.click(checkboxes[0]!);
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('Vybrán 1 kontakt na této stránce');
    expect(within(bar).getByRole('button', { name: 'Smazat' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Vybrat všech/ })).toBeInTheDocument();
  });

  it('nabídne rozšíření výběru na všechny odpovídající filtru a rozliší to slovy', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    await user.click(within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' })[0]!);
    const expand = screen.getByRole('button', { name: /Vybrat všech/ });
    await user.click(expand);
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('Vybráno všech 12 480 kontaktů odpovídajících filtru');
    expect(within(bar).getByRole('button', { name: 'Zrušit výběr' })).toBeInTheDocument();
  });
});

/**
 * Pátý pád je hlavní odlišující vlastnost produktu a do téhle chvíle na nejčastěji
 * otevírané obrazovce vidět nebyl. Tyhle testy hlídají, že sloupec ukazuje TVAR
 * i jeho původ a že z obrazovky vede cesta do fronty kontroly.
 */
describe('ContactsTable, sloupec oslovení', () => {
  it('ukáže tvar v 5. pádu a jeho původ, ne jen celou větu', () => {
    renderTable();
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Jano')).toBeInTheDocument();
    expect(within(grid).getByText('Ze slovníku')).toBeInTheDocument();
  });

  it('kontakt bez jména hlásí neutrální oslovení, ne chybu', () => {
    renderTable();
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Bez jména')).toBeInTheDocument();
    expect(within(grid).getByText('Neutrální')).toBeInTheDocument();
  });

  it('kontakt v jazyce bez 5. pádu se hlásí jako nejistý, i když má jistotu high', () => {
    renderTable({
      rows: [
        {
          ...rows[0]!,
          greeting: {
            greeting: 'Hello Petr',
            first_name: 'Petr',
            first_name_vocative: 'Petr',
            vocative_confidence: 'high',
            vocative_locked: false,
            locale: 'en',
          },
        },
      ],
    });
    expect(within(screen.getByRole('grid')).getByText('Bez 5. pádu')).toBeInTheDocument();
  });

  it('nabídne cestu do fronty Kontrola oslovení i s počtem', async () => {
    const user = userEvent.setup();
    renderTable({ vocativeReview: { href: '/w/eshop/contacts/vocative-review', uncertain: 7 } });
    const link = screen.getByTestId('vocative-review-link');
    expect(link).toHaveTextContent('Kontrola oslovení (7)');
    await user.click(link);
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts/vocative-review');
  });

  it('bez známého počtu ukáže odkaz bez čísla, ne nulu', () => {
    renderTable({ vocativeReview: { href: '/w/eshop/contacts/vocative-review' } });
    expect(screen.getByTestId('vocative-review-link')).toHaveTextContent('Kontrola oslovení');
  });
});

/**
 * Potvrzení PŘÍMO V ŘÁDKU. Do téhle chvíle šlo kontakt potvrdit jedině z detailu nebo
 * hromadnou akcí nad zaškrtnutým výběrem, tedy vždycky nejmíň o dvě kliknutí navíc.
 */
describe('ContactsTable: potvrzení v řádku', () => {
  const unsubscribed: ContactRow = {
    ...rows[1]!,
    id: 'c-3',
    email: 'odhlaseny@firma.cz',
    status: 'unsubscribed',
  };

  it('u nepotvrzeného kontaktu je akce rovnou v řádku, bez odbočky na detail', async () => {
    const user = userEvent.setup();
    renderTable();

    const action = screen.getByRole('button', {
      name: 'Označit kontakt petr@firma.cz jako potvrzený',
    });
    await user.click(action);

    await waitFor(() =>
      expect(confirmContactsAction).toHaveBeenCalledWith({ workspaceId: 'w-1', ids: ['c-2'] }),
    );
    // Klik na tlačítko NESMÍ zároveň otevřít detail, jinak by uživatel skončil jinde,
    // než čekal. `DataTable` proto cíle uvnitř `button` z aktivace řádku vyjímá.
    expect(push).not.toHaveBeenCalled();
  });

  /**
   * Nález zadavatele: u odhlášeného kontaktu tlačítko NEMÁ CO ŘÍCT. Potvrzený už byl,
   * jinak by mu nemohlo nic dojít a neměl by se jak odhlásit. Nabízet mu „označit jako
   * potvrzený" znamená slovem „potvrzený" zakrýt, že se přepisuje jeho rozhodnutí.
   * Cesta zpátky je „přihlásit zpět" (`resubscribe`), samostatná a poctivě pojmenovaná.
   */
  it('u odhlášeného kontaktu se akce nenabízí, protože potvrzený už byl', () => {
    renderTable({ rows: [...rows, unsubscribed] });

    expect(
      screen.queryByRole('button', { name: 'Označit kontakt odhlaseny@firma.cz jako potvrzený' }),
    ).toBeNull();
  });

  it('u potvrzeného kontaktu se akce nenabízí', () => {
    renderTable();
    expect(
      screen.queryByRole('button', { name: 'Označit kontakt jana@firma.cz jako potvrzený' }),
    ).toBeNull();
  });

  it('nikde v seznamu nestojí, že kontakt povýšit nejde', () => {
    renderTable({ rows: [...rows, unsubscribed] });
    expect(screen.queryByText(/povýšit nejde/i)).toBeNull();
    expect(screen.queryByText(/jde to jen u kontaktu/i)).toBeNull();
    expect(screen.queryByText(/povýšit jde jen kontakt/i)).toBeNull();
  });

  it('hromadná akce nad výběrem zůstává, protože je užitečná u dávky', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[1]!);

    expect(
      await screen.findByRole('button', { name: 'Označit jako potvrzené' }),
    ).toBeInTheDocument();
  });
});
