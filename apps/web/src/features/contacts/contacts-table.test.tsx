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

const createContactExportAction = vi
  .fn()
  .mockResolvedValue({ status: 'success', id: 'e-1', downloadUrl: '/api/v1/x?token=t' });
const deleteContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const unsubscribeContactAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  bulkDeleteContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
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
  it('nad seznamem je vidět filtr a jde zrušit', async () => {
    const user = userEvent.setup();
    renderTable({
      filters: { tag_id: 't-1' },
      names: { lists: {}, tags: { 't-1': 'Brno' }, segments: {} },
    });

    const summary = screen.getByTestId('contacts-filter-summary');
    expect(summary).toHaveTextContent('Filtr: štítek Brno');

    await user.click(within(summary).getByRole('button', { name: 'Zrušit všechny filtry' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts');
  });

  it('bez filtru se pruh s filtrem neukazuje', () => {
    renderTable();
    expect(screen.queryByTestId('contacts-filter-summary')).toBeNull();
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
