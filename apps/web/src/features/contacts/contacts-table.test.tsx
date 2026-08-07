import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsTable, type ContactRow } from './contacts-table';
import { renderWithProviders } from './test-utils';

/**
 * Radix Popover si měří spouštěč a `cmdk` roluje na vybranou položku. jsdom neumí ani
 * jedno, takže by se nabídka výběru seznamu a štítku vůbec neotevřela. Netýká se to toho,
 * co se v testech měří: filtr `cmdk` běží nad hodnotami, ne nad rozměry.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
});

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const createContactExportAction = vi
  .fn()
  .mockResolvedValue({ status: 'success', id: 'e-1', downloadUrl: '/api/v1/x?token=t' });
const deleteContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const unsubscribeContactAction = vi.fn().mockResolvedValue({ status: 'success' });

// Rozsah hromadného mazání se ověřuje na SKUTEČNÉM volání, ne na textu v pruhu:
// právě tím, že se pruh a odeslaný rozsah rozešly, vznikl celý nález.
const bulkDeleteContactsAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  bulkDeleteContactsAction: (...args: unknown[]) => bulkDeleteContactsAction(...args),
  bulkTagContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  createContactExportAction: (...args: unknown[]) => createContactExportAction(...args),
  exportStatusAction: vi.fn().mockResolvedValue({ status: 'success', state: 'completed' }),
  deleteContactAction: (...args: unknown[]) => deleteContactAction(...args),
  unsubscribeContactAction: (...args: unknown[]) => unsubscribeContactAction(...args),
}));

const restrictProcessingAction = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./restriction-actions', () => ({
  restrictProcessingAction: (...args: unknown[]) => restrictProcessingAction(...args),
  liftProcessingRestrictionAction: vi.fn().mockResolvedValue({ status: 'success' }),
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
    subscribed_list_ids: ['l-1'],
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
    subscribed_list_ids: [],
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
      canManageRestriction
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  createContactExportAction.mockClear();
  deleteContactAction.mockClear().mockResolvedValue({ status: 'success' });
  unsubscribeContactAction.mockClear().mockResolvedValue({ status: 'success' });
  restrictProcessingAction.mockClear().mockResolvedValue({ status: 'success' });
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
  // Vlnovka stojí na dvou místech: v meta řádku pod názvem obrazovky a ve stránkování
  // pod tabulkou. Obě musí přiznat, že je počet odhad (princip P7), proto se hledá
  // výskyt, ne jediný prvek.
  it('ukáže počet s vlnovkou, když je odhadovaný', () => {
    renderTable();
    expect(screen.getAllByText(/~\s?12\s?480/).length).toBeGreaterThanOrEqual(1);
  });

  it('u přesného počtu vlnovku nepíše', () => {
    renderTable({ total: { count: 2, precision: 'exact' } });
    expect(screen.queryAllByText(/~/)).toHaveLength(0);
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

  // Hledá se UVNITŘ MŘÍŽKY: nad tabulkou stojí segmentový přepínač stavu, který má
  // tatáž slova, a bez zúžení by dotaz našel dva prvky.
  it('stav nese slovo, ne jen barvu', () => {
    renderTable();
    const grid = within(screen.getByRole('grid'));
    expect(grid.getByText('Aktivní')).toBeInTheDocument();
    expect(grid.getByText('Nepotvrzený')).toBeInTheDocument();
  });

  it('stav jde přepnout přepínačem nad tabulkou, ne jen ručně v adrese', async () => {
    const user = userEvent.setup();
    renderTable();
    const group = screen.getByRole('group', { name: 'Filtr stavu' });
    await user.click(within(group).getByRole('button', { name: 'Nepotvrzené' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?status=unconfirmed');
  });

  it('hledání posílá výraz do adresy, aby na filtrovaný seznam šlo odkázat', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByRole('searchbox', { name: 'Hledat kontakt' }), 'novak{Enter}');
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?q=novak');
  });

  it('hledání nese značky, kterými správci hesel vypínají svoji nabídku', () => {
    // Vada z provozu: nabídka uložených přihlášení se vysune nad polem a zakryje
    // první řádky. Zavřít se nedá, patří rozšíření v prohlížeči, ne stránce.
    renderTable();
    const search = screen.getByRole('searchbox', { name: 'Hledat kontakt' });
    expect(search).toHaveAttribute('data-1p-ignore', 'true');
    expect(search).toHaveAttribute('data-lpignore', 'true');
    expect(search).toHaveAttribute('data-bwignore', 'true');
    expect(search).toHaveAttribute('data-form-type', 'other');
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

  /*
   * ROZDÍL MEZI „NA TÉTO STRÁNCE" A „VŠECH" MUSÍ BÝT ZE SLOV POZNAT. Je to past z 6.5:
   * uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků, a smaže 50 000.
   *
   * Věta se 7. 8. 2026 na přání zadavatele zkrátila („Vybráno všech 12 480 kontaktů"
   * místo „…kontaktů odpovídajících filtru"), ale rozlišení nezmizelo: nese ho dvojice
   * „na této stránce" proti „všech", identitní barva pruhu a dialog mazání, který filtr
   * pořád vypisuje slovy.
   */
  it('rozšíření výběru na celý filtr se od výběru na stránce liší slovy', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    await user.click(within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' })[0]!);

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('Vybrán 1 kontakt na této stránce');

    await user.click(within(bar).getByRole('button', { name: /Vybrat všech/ }));

    expect(bar).toHaveTextContent('Vybráno všech 12 480 kontaktů');
    expect(bar).not.toHaveTextContent('odpovídajících filtru');
    expect(within(bar).getByRole('button', { name: 'Zrušit výběr' })).toBeInTheDocument();
  });

  /*
   * Zrušení výběru patří na KONEC řady, za poslední tlačítko akce. Přání zadavatele
   * a platí v obou režimech, aby půlka pruhu neměla jedno pořadí a půlka druhé.
   */
  it('zrušení výběru stojí až za poslední akcí, a to v obou režimech', async () => {
    const user = userEvent.setup();
    renderTable();
    const grid = screen.getByRole('grid');
    await user.click(within(grid).getAllByRole('checkbox', { name: 'Vybrat kontakt' })[0]!);

    const poradi = () => {
      const bar = screen.getByTestId('selection-bar');
      const buttons = within(bar).getAllByRole('button');
      return {
        zrusit: buttons.findIndex((node) => node.textContent === 'Zrušit výběr'),
        smazat: buttons.findIndex((node) => node.textContent?.trim() === 'Smazat'),
        posledni: buttons.length - 1,
      };
    };

    const naStrance = poradi();
    expect(naStrance.zrusit).toBe(naStrance.posledni);
    expect(naStrance.zrusit).toBeGreaterThan(naStrance.smazat);

    await user.click(
      within(screen.getByTestId('selection-bar')).getByRole('button', {
        name: /Vybrat všech/,
      }),
    );

    const vseVFiltru = poradi();
    expect(vseVFiltru.zrusit).toBe(vseVFiltru.posledni);
    expect(vseVFiltru.zrusit).toBeGreaterThan(vseVFiltru.smazat);
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
    // Návrh má počet jako samostatný mono údaj vedle popisku, ne v závorce za ním.
    expect(link).toHaveTextContent('Kontrola oslovení');
    expect(within(link).getByText('7')).toBeInTheDocument();
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

  /*
   * FILTROVANÝ SEZNAM MUSÍ ŘÍCT, ŽE JE FILTROVANÝ.
   *
   * Po prokliku ze štítku viděl uživatel jeden kontakt a nikde se nedozvěděl proč:
   * filtr žije v URL a `filterDescription` se v `DataTable` používá jedině uvnitř
   * lišty výběru, tedy až po zaškrtnutí řádku.
   */
  /*
   * Pruh popisuje UŽ JEN TO, CO Z LIŠTY NENÍ VIDĚT. Dokud v liště žádné ovládání
   * filtru nebylo, byl jediným místem, kde se dalo přečíst, podle čeho je seznam
   * zúžený. Nad tlačítkem „Brno" by ale věta „Filtr: štítek Brno" jen opisovala
   * sama sebe.
   */
  it('pruh neopisuje to, co je vidět na tlačítkách lišty', () => {
    renderTable({
      filters: { tag_id: 't-1' },
      tags: [{ id: 't-1', name: 'Brno' }],
      names: { lists: {}, tags: { 't-1': 'Brno' }, segments: {} },
    });

    expect(screen.getByTestId('contacts-filter-tag')).toHaveTextContent('Brno');
    expect(screen.queryByTestId('contacts-filter-summary')).toBeNull();
  });

  it('filtr bez ovládání v liště se pořád vypisuje slovy', () => {
    renderTable({
      // Nejisté oslovení ani stav „odražený" v liště tlačítko nemají: přepínač zná
      // jen Všechny, Aktivní a Nepotvrzené. Bez pruhu by takový odkaz vypadal jako
      // nefiltrovaný seznam.
      filters: { vocative_confidence: 'low', status: 'bounced' },
      names: { lists: {}, tags: {}, segments: {} },
    });

    const summary = screen.getByTestId('contacts-filter-summary');
    expect(summary).toHaveTextContent('nejisté oslovení');
    expect(summary).toHaveTextContent('stav Nedoručitelný');
  });

  it('filtr seznamu se vypíše i tehdy, když se nabídka seznamů nekreslí', () => {
    renderTable({
      filters: { list_id: 'l-1' },
      lists: [],
      names: { lists: { 'l-1': 'Zákazníci' }, tags: {}, segments: {} },
    });

    expect(screen.queryByTestId('contacts-filter-list')).toBeNull();
    expect(screen.getByTestId('contacts-filter-summary')).toHaveTextContent('seznam Zákazníci');
  });

  it('bez filtru se pruh s filtrem neukazuje', () => {
    renderTable();
    expect(screen.queryByTestId('contacts-filter-summary')).toBeNull();
  });

  /*
   * ZRUŠENÍ CELÉHO FILTRU STOJÍ NA KONCI ŘADY FILTRŮ, ne v pruhu pod ní.
   * Přání zadavatele: „Pokud mám vybrané nějaké filtry, tak tam doprava přidej
   * tlačítko Zrušit filtry, které je všechny odstraní."
   */
  it('zrušení celého filtru je na konci řady a ruší opravdu všechno', async () => {
    const user = userEvent.setup();
    renderTable({
      filters: { list_id: 'l-1', tag_id: 't-1', status: 'active', q: 'novák' },
      lists: [{ id: 'l-1', name: 'Zákazníci' }],
      tags: [{ id: 't-1', name: 'Brno' }],
      names: { lists: { 'l-1': 'Zákazníci' }, tags: { 't-1': 'Brno' }, segments: {} },
    });

    await user.click(screen.getByTestId('contacts-clear-filters'));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts');
  });

  it('bez zapnutého filtru se zrušení nenabízí, nemělo by co udělat', () => {
    renderTable();
    expect(screen.queryByTestId('contacts-clear-filters')).toBeNull();
  });

  it('zrušení se nabízí i u filtru, který v liště vlastní ovládání nemá', () => {
    renderTable({ filters: { vocative_confidence: 'low' } });
    expect(screen.getByTestId('contacts-clear-filters')).toBeInTheDocument();
  });

  it('seznam jde vyexportovat a posílá publikum podle filtru', async () => {
    const user = userEvent.setup();
    renderTable({
      filters: { tag_id: 't-1' },
      names: { lists: {}, tags: { 't-1': 'Brno' }, segments: {} },
    });

    await user.click(screen.getByRole('button', { name: 'Exportovat' }));

    await waitFor(() => expect(createContactExportAction).toHaveBeenCalled());
    const [call] = createContactExportAction.mock.calls as [[{ audience: unknown }]];
    expect(JSON.stringify(call[0].audience)).toContain('has_any');
    expect(JSON.stringify(call[0].audience)).not.toContain('tag_id');
  });

  it('export podle hledaného výrazu se neposílá a řekne se proč', async () => {
    const user = userEvent.setup();
    renderTable({ filters: { q: 'novak' }, names: { lists: {}, tags: {}, segments: {} } });

    await user.click(screen.getByRole('button', { name: 'Exportovat' }));

    expect(await screen.findByText(/Podle hledaného výrazu exportovat neumíme/)).toBeVisible();
    expect(createContactExportAction).not.toHaveBeenCalled();
  });
});

/**
 * NABÍDKA „…" V ŘÁDKU. Čtyři akce z detailu kontaktu, aby se kvůli nim nemuselo
 * rozklikávat: upravit, odhlásit, omezit zpracování, smazat.
 *
 * Testy hlídají dvě věci naráz. Za prvé že se akce SKUTEČNĚ nabízejí a míří tam,
 * kam mají. Za druhé, a to je důležitější, že se NENABÍZÍ TAM, KDE NEDÁVAJÍ SMYSL:
 * odhlásit už odhlášeného, omezit už omezeného ani sáhnout na smazaný kontakt.
 * Nabídka je zkratka k hotovým akcím, ne druhá cesta kolem jejich pojistek.
 */
describe('ContactsTable: nabídka akcí v řádku', () => {
  const restricted: ContactRow = { ...rows[0]!, id: 'c-4', processing_restricted: true };
  const unsubscribed: ContactRow = {
    ...rows[0]!,
    id: 'c-5',
    email: 'odhlaseny@firma.cz',
    status: 'unsubscribed',
    subscribed_list_ids: [],
  };
  const deleted: ContactRow = {
    ...rows[0]!,
    id: 'c-6',
    email: 'smazany@firma.cz',
    status: 'deleted',
    subscribed_list_ids: [],
  };

  async function openMenu(email: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Další akce s kontaktem ${email}` }));
    return user;
  }

  it('nabídne čtyři akce z detailu a mazání odděluje', async () => {
    renderTable();
    await openMenu('jana@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Odhlásit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Omezit zpracování' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Smazat' })).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('úprava vede na formulář kontaktu, ne na detail', async () => {
    renderTable();
    const user = await openMenu('jana@firma.cz');
    await user.click(await screen.findByRole('menuitem', { name: 'Upravit kontakt' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts/c-1/edit');
  });

  it('odhlášení jde ze všech seznamů, ve kterých kontakt ještě je', async () => {
    renderTable();
    const user = await openMenu('jana@firma.cz');
    await user.click(await screen.findByRole('menuitem', { name: 'Odhlásit' }));

    await waitFor(() =>
      expect(unsubscribeContactAction).toHaveBeenCalledWith({
        workspaceId: 'w-1',
        email: 'jana@firma.cz',
        listIds: ['l-1'],
      }),
    );
  });

  /**
   * Nález zadavatele u potvrzení v řádku, který platí i tady: co nedává smysl, se
   * nenabízí vůbec. Odhlášený kontakt už odhlášený je a přihlásit ho zpět je jiná
   * akce s vlastním oknem, ne položka „Odhlásit".
   */
  it('u odhlášeného kontaktu se odhlášení nenabízí', async () => {
    renderTable({ rows: [unsubscribed] });
    await openMenu('odhlaseny@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Odhlásit' })).toBeNull();
  });

  it('u kontaktu bez přihlášení do seznamu se odhlášení nenabízí, protože není odkud', async () => {
    renderTable();
    // Druhý řádek je nepotvrzený kontakt bez jediného seznamu. Stav odhlášení
    // dovoluje, ale `DELETE /lists/{id}/subscribe` by nemělo co zavolat.
    await openMenu('petr@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Odhlásit' })).toBeNull();
  });

  it('u už omezeného kontaktu se omezení nenabízí', async () => {
    renderTable({ rows: [restricted] });
    await openMenu('jana@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Omezit zpracování' })).toBeNull();
  });

  it('bez oprávnění se omezení nenabízí vůbec', async () => {
    renderTable({ canManageRestriction: false });
    await openMenu('jana@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Omezit zpracování' })).toBeNull();
  });

  it('smazaný kontakt nabídku nemá, protože by v ní nebylo nic', () => {
    renderTable({ rows: [deleted] });

    expect(
      screen.queryByRole('button', { name: 'Další akce s kontaktem smazany@firma.cz' }),
    ).toBeNull();
  });

  /**
   * POJISTKY HOTOVÝCH AKCÍ SE NABÍDKOU NEOBCHÁZEJÍ. Omezení zpracování je táž
   * komponenta jako na detailu, takže povinné odůvodnění platí i tady: bez něj
   * se na server neposílá nic a audit nemá zůstat s „kdo a kdy" bez „proč".
   */
  it('omezení zpracování chce odůvodnění i z řádku', async () => {
    renderTable();
    const user = await openMenu('jana@firma.cz');
    await user.click(await screen.findByRole('menuitem', { name: 'Omezit zpracování' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('vypadne ze všech segmentů');
    await user.click(screen.getAllByRole('button', { name: /^omezit zpracování$/i }).at(-1)!);

    expect(restrictProcessingAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/Bez odůvodnění to neuděláme/i)).toBeInTheDocument();

    await user.type(await screen.findByLabelText(/čeho se žádost týká/i), 'Žádost e-mailem 4. 8.');
    await user.click(screen.getAllByRole('button', { name: /^omezit zpracování$/i }).at(-1)!);

    await waitFor(() =>
      expect(restrictProcessingAction).toHaveBeenCalledWith({
        workspaceId: 'w-1',
        id: 'c-1',
        note: 'Žádost e-mailem 4. 8.',
      }),
    );
  });

  it('mazání se ptá oknem s následky a bez potvrzení nemaže', async () => {
    renderTable();
    const user = await openMenu('jana@firma.cz');
    await user.click(await screen.findByRole('menuitem', { name: 'Smazat' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Smazat kontakt Jana Nováková?');
    expect(dialog).toHaveTextContent('zmizí ze všech seznamů');
    // Nabídka stáhnout data předem je podle 6.5 části 6 silnější ochrana než
    // opisování textu, takže z řádku nesmí zmizet.
    expect(within(dialog).getByRole('button', { name: 'Stáhnout data kontaktu' })).toBeVisible();
    expect(deleteContactAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Smazat kontakt' }));
    await waitFor(() =>
      expect(deleteContactAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'c-1' }),
    );
  });

  /**
   * Nabídka stáhnout data před smazáním musí SKUTEČNĚ EXPORTOVAT, ne jen být vidět.
   * Export jednoho kontaktu je v téhle doméně místo, kde tři různé akce posílaly
   * neplatné tělo a končily na 422, aniž si toho kdokoli všiml.
   */
  it('stažení dat před smazáním vyveze právě ten kontakt', async () => {
    renderTable();
    const user = await openMenu('jana@firma.cz');
    await user.click(await screen.findByRole('menuitem', { name: 'Smazat' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Stáhnout data kontaktu',
      }),
    );

    await waitFor(() => expect(createContactExportAction).toHaveBeenCalled());
    const [call] = createContactExportAction.mock.calls as [[{ audience: unknown }]];
    expect(JSON.stringify(call[0].audience)).toContain('jana@firma.cz');
    expect(deleteContactAction).not.toHaveBeenCalled();
  });

  it('otevření nabídky neotevře detail kontaktu', async () => {
    renderTable();
    await openMenu('jana@firma.cz');

    expect(await screen.findByRole('menuitem', { name: 'Upravit kontakt' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * ZÚŽENÍ NA SEZNAM A NA ŠTÍTEK MUSÍ JÍT ZAPNOUT NA OBRAZOVCE.
 *
 * Nález zadavatele ze 7. 8. 2026: „Nemám jak filtrovat kontakty z konkrétního seznamu
 * nebo s konkrétním štítkem." API oba filtry umělo od začátku a zapnutý filtr se nad
 * tabulkou i vypisoval, ale ovládací prvek, kterým se zapne, na obrazovce nebyl žádný:
 * dalo se to jedině proklikem odjinud nebo dopsáním parametru do adresy.
 */
describe('ContactsTable: zúžení na seznam a na štítek', () => {
  const lists = [
    { id: 'l-1', name: 'Novinky' },
    { id: 'l-2', name: 'Zákazníci' },
  ];
  const tags = [
    { id: 't-1', name: 'Brno' },
    { id: 't-2', name: 'Praha' },
  ];

  it('výběr seznamu zapíše filtr do adresy, ať jde výsledek poslat odkazem', async () => {
    const user = userEvent.setup();
    renderTable({ lists, tags });

    await user.click(screen.getByTestId('contacts-filter-list'));
    await user.click(await screen.findByRole('option', { name: 'Zákazníci' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-2');
  });

  it('výběr štítku zapisuje do téže adresy a nezahodí filtr seznamu', async () => {
    const user = userEvent.setup();
    renderTable({ lists, tags, filters: { list_id: 'l-1' } });

    await user.click(screen.getByTestId('contacts-filter-tag'));
    await user.click(await screen.findByRole('option', { name: 'Praha' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-1&tag_id=t-2');
  });

  /*
   * Seznamů a štítků bývají v projektu desítky. Rozbalovátko bez hledání se u nich
   * čte řádek po řádku, proto je nabídka tatáž hledatelná paletka jako v editoru.
   */
  it('nabídka jde prohledat, protože seznamů bývají desítky', async () => {
    const user = userEvent.setup();
    renderTable({ lists, tags });

    await user.click(screen.getByTestId('contacts-filter-list'));
    await user.type(screen.getByPlaceholderText('Hledat seznam'), 'zák');

    expect(await screen.findByRole('option', { name: 'Zákazníci' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Novinky' })).toBeNull();
  });

  it('zrušit jde jen jeden filtr, ne rovnou všechny', async () => {
    const user = userEvent.setup();
    renderTable({ lists, tags, filters: { list_id: 'l-1', tag_id: 't-1' } });

    await user.click(screen.getByTestId('contacts-filter-list'));
    await user.click(await screen.findByRole('option', { name: 'Všechny seznamy' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?tag_id=t-1');
  });

  it('zapnutý filtr je na tlačítku vidět jménem, ne jen v pruhu nad tabulkou', () => {
    renderTable({ lists, tags, filters: { list_id: 'l-1' } });
    expect(screen.getByTestId('contacts-filter-list')).toHaveTextContent('Novinky');
    expect(screen.getByTestId('contacts-filter-tag')).toHaveTextContent('Štítek');
  });

  it('bez jediného seznamu se výběr nekreslí, aby neotevíral prázdné okno', () => {
    renderTable({ lists: [], tags });
    expect(screen.queryByTestId('contacts-filter-list')).toBeNull();
    expect(screen.getByTestId('contacts-filter-tag')).toBeInTheDocument();
  });

  /*
   * Prázdný výsledek filtru dřív zahodil celou obrazovku i s ovládáním. Kdo si vybral
   * seznam, ve kterém nikdo není, neměl jak přepnout na jiný: zbývalo zrušit všechno
   * a začít znovu.
   */
  it('prázdný výsledek nechá ovládání na obrazovce, aby šel filtr rovnou přepnout', async () => {
    const user = userEvent.setup();
    renderTable({
      rows: [],
      total: { count: 0, precision: 'exact' },
      lists,
      tags,
      filters: { list_id: 'l-1' },
      names: { lists: { 'l-1': 'Novinky' }, tags: {}, segments: {} },
    });

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    // Pruh s filtrem se nad prázdným stavem neopakuje: ten si filtr vypisuje sám.
    expect(screen.queryByTestId('contacts-filter-summary')).toBeNull();

    await user.click(screen.getByTestId('contacts-filter-list'));
    await user.click(await screen.findByRole('option', { name: 'Zákazníci' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-2');
  });

  it('u prázdného výsledku meta řádek netvrdí, že jsou všechny potvrzené', () => {
    renderTable({
      rows: [],
      total: { count: 0, precision: 'exact' },
      unconfirmed: 0,
      lists,
      tags,
      filters: { list_id: 'l-1' },
      names: { lists: { 'l-1': 'Novinky' }, tags: {}, segments: {} },
    });
    // Meta řádek pod názvem obrazovky, ne nadpis prázdného stavu: shoda je přesná.
    expect(screen.getByText('Žádný kontakt')).toBeInTheDocument();
    expect(screen.queryByText(/všechny potvrzené/)).toBeNull();
  });

  it('projekt bez jediného kontaktu ovládání filtru neukazuje, filtrovat není co', () => {
    renderTable({ rows: [], total: { count: 0, precision: 'exact' }, lists, tags });
    expect(screen.queryByTestId('contacts-filter-list')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Zatím tu nejsou žádné kontakty' }),
    ).toBeInTheDocument();
  });
});

/**
 * PRUH HROMADNÝCH AKCÍ MUSÍ PO AKCI ZMIZET.
 *
 * Nález zadavatele ze 7. 8. 2026: „Vyberu nějaké kontakty, udělám nad nimi nějakou
 * operaci. Ta proběhne, ale tohle tam zůstane viset a nejde se toho zbavit. Pokud
 * kontakty například smažu, tak nemá co s tím dál dělat."
 *
 * Po akci se volalo jen `router.refresh()`, takže se obnovila DATA, ale výběr zůstal.
 * Po smazání v něm dokonce ležely identifikátory kontaktů, které už neexistují.
 */
describe('ContactsTable: úklid výběru po hromadné akci', () => {
  async function selectFirstRow(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[1]!);
    expect(await screen.findByTestId('selection-bar')).toBeInTheDocument();
  }

  it('po úspěšném povýšení na potvrzené pruh zmizí', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectFirstRow(user);

    await user.click(screen.getByRole('button', { name: 'Označit jako potvrzené' }));

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
  });

  /*
   * Po chybě výběr ZŮSTÁVÁ. Uživatel by jinak přišel o odklikanou práci a musel
   * označovat znovu, přestože se ve skutečnosti nic nestalo.
   */
  it('po neúspěšné akci výběr zůstane, ať se nemusí označovat znovu', async () => {
    confirmContactsAction.mockResolvedValue({ status: 'error', code: 'server_error' });
    const user = userEvent.setup();
    renderTable();
    await selectFirstRow(user);

    await user.click(screen.getByRole('button', { name: 'Označit jako potvrzené' }));

    await waitFor(() => expect(confirmContactsAction).toHaveBeenCalled());
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
  });

  /*
   * Nejdůležitější případ celého nálezu. Výběr rozšířený na „vše odpovídající filtru"
   * nedrží obrazovka, ale tabulka, a počet si v něm bere z celkového čísla, ne z délky
   * pole identifikátorů. Vynulovat vlastní pole tedy nestačí: bez `clearToken` pruh
   * po smazání zůstane viset nad tabulkou, ze které kontakty právě mizí.
   */
  it('po smazání zmizí pruh i u výběru rozšířeného na celý filtr', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectFirstRow(user);
    await user.click(screen.getByRole('button', { name: /Vybrat všech/ }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('Vybráno všech');

    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    // Potvrzení mazání nese POČET Z FILTRU, ne počet zaškrtnutých řádků. Do 7. 8. 2026
    // tu stálo „Smazat 1 kontakt", přestože pruh nad tím sliboval všech 12 480: režim
    // z tabulky ven netekl, takže hromadná akce dostala jediný zaškrtnutý řádek.
    // Tlačítko v pruhu se jmenuje jinak než tlačítko v okně, proto kotva na začátek.
    const confirm = await screen.findByRole('button', { name: /^Smazat 12.480 kontaktů$/ });
    await user.click(screen.getAllByRole('checkbox', { name: /Rozumím|Vím/ })[0]!);
    await user.click(confirm);

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
  });

  /*
   * Export je jediná akce, po které výběr ZŮSTÁVÁ, a je to vědomé rozhodnutí: nic
   * se jím nezměnilo, tytéž kontakty jsou pořád v tabulce a bývá to mezikrok.
   */
  it('po exportu výběr zůstává, protože se jím nic nezměnilo', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectFirstRow(user);

    await user.click(screen.getByRole('button', { name: 'Exportovat' }));

    await waitFor(() => expect(createContactExportAction).toHaveBeenCalled());
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
  });

  /*
   * Zrušit výběr musí jít i bez akce. V režimu „vybráno na stránce" v pruhu do téhle
   * chvíle žádné zrušení nebylo, takže jedinou cestou ven bylo odškrtat řádky zpátky.
   */
  it('výběr jde zrušit rovnou z pruhu, i když se žádná akce nedělá', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectFirstRow(user);

    const bar = screen.getByTestId('selection-bar');
    await user.click(within(bar).getByRole('button', { name: 'Zrušit výběr' }));

    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

/**
 * ROZŠÍŘENÍ VÝBĚRU NA CELÝ FILTR, tedy druhá polovina nálezu ze 7. 8. 2026.
 *
 * Odkaz „Vybrat všech N" přepínal režim jen uvnitř `DataTable`. Pruh napsal „Vybráno
 * všech 12 480", ale hromadné akce dostávaly `mode: 'ids'` natvrdo, takže tlačítko pod
 * tím textem pracovalo s tím, co bylo opravdu zaškrtnuté. Větve `allMatching`
 * v `bulk-actions.tsx` byly celou dobu mrtvý kód.
 */
describe('ContactsTable: výběr všeho, co odpovídá filtru', () => {
  async function selectAllMatching(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[1]!);
    await user.click(await screen.findByRole('button', { name: /Vybrat všech/ }));
  }

  it('mazání jde na FILTR, ne na zaškrtnuté identifikátory', async () => {
    const user = userEvent.setup();
    renderTable({ filters: { status: 'active' } });
    await selectAllMatching(user);

    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    const confirm = await screen.findByRole('button', { name: /^Smazat 12.480 kontaktů$/ });
    await user.click(screen.getAllByRole('checkbox', { name: /Rozumím|Vím/ })[0]!);
    await user.click(confirm);

    await waitFor(() => expect(bulkDeleteContactsAction).toHaveBeenCalled());
    expect(bulkDeleteContactsAction).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { mode: 'filter', filters: { status: 'active' } } }),
    );
  });

  /*
   * Hromadná akce nad celým filtrem je nebezpečnější než nad zaškrtnutými řádky:
   * člověk vidí dvacet řádků a smaže sedm tisíc. Potvrzení proto musí říct, čeho
   * přesně se to týká, ne jen kolika kontaktů.
   */
  it('potvrzení vypíše filtr slovy', async () => {
    const user = userEvent.setup();
    renderTable({
      filters: { list_id: 'l-1', status: 'active' },
      names: { lists: { 'l-1': 'Novinky' }, tags: {}, segments: {} },
    });
    await selectAllMatching(user);
    await user.click(screen.getByRole('button', { name: 'Smazat' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('seznam Novinky');
    expect(dialog).toHaveTextContent('stav Aktivní');
  });

  /*
   * Bez zapnutého filtru je rozsah největší možný, tedy celý projekt. Prázdné místo,
   * kde jindy stojí výčet filtru, by se dalo přečíst jako „rozsah je malý".
   */
  it('bez zapnutého filtru potvrzení řekne, že jde o celý projekt', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectAllMatching(user);
    await user.click(screen.getByRole('button', { name: 'Smazat' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('všechny kontakty v projektu');
  });

  /*
   * Štítky, seznamy ani potvrzení nad filtrem nejedou: API u nich zná jen výčet
   * identifikátorů. Nenabízejí se proto vůbec, místo aby svítily zašedle bez
   * vysvětlení (kritérium 18 části 6).
   */
  it('nabízí jen to, co server nad filtrem umí, a řekne proč', async () => {
    const user = userEvent.setup();
    renderTable({ tags: [{ id: 't-1', name: 'Brno' }], lists: [{ id: 'l-1', name: 'Novinky' }] });
    await selectAllMatching(user);

    const bar = screen.getByTestId('selection-bar');
    expect(within(bar).getByRole('button', { name: /Exportovat/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Smazat' })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Štítky' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'Seznamy' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'Označit jako potvrzené' })).toBeNull();
    expect(within(bar).getByTestId('bulk-whole-filter-note')).toHaveTextContent(
      'potřebují označené řádky',
    );
  });

  /*
   * Zaškrtnutí řádku je návrat k výběru na stránce. Kdyby režim zůstal viset, spustila
   * by obrazovka nad jedním řádkem akci nad celým filtrem.
   */
  it('zaškrtnutí řádku režim celého filtru zase opustí', async () => {
    const user = userEvent.setup();
    renderTable();
    await selectAllMatching(user);
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('Vybráno všech');

    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[0]!);

    const bar = screen.getByTestId('selection-bar');
    expect(bar).not.toHaveTextContent('Vybráno všech');
    expect(within(bar).getByRole('button', { name: 'Označit jako potvrzené' })).toBeInTheDocument();
  });

  /*
   * VADA A na Kontaktech: bez další stránky není co dalšího vybrat, takže odkaz mizí.
   * Nad nestránkovanou tabulkou nabízel přesně ty řádky, které už byly zaškrtnuté.
   */
  it('na jediné stránce se rozšíření výběru vůbec nenabízí', async () => {
    const user = userEvent.setup();
    renderTable({
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
      total: { count: 2, precision: 'exact' },
    });
    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[1]!);

    const bar = await screen.findByTestId('selection-bar');
    expect(within(bar).queryByRole('button', { name: /Vybrat všech/ })).toBeNull();
  });

  /*
   * Bez známého počtu se odkaz nenabízí taky: potvrzení mazání by nemělo co říct
   * o tom, kolika kontaktů se akce týká.
   */
  it('bez zjištěného počtu se rozšíření výběru nenabízí', async () => {
    const user = userEvent.setup();
    renderTable({ total: null });
    await user.click(screen.getAllByRole('checkbox', { name: 'Vybrat kontakt' })[1]!);

    const bar = await screen.findByTestId('selection-bar');
    expect(within(bar).queryByRole('button', { name: /Vybrat všech/ })).toBeNull();
  });
});
