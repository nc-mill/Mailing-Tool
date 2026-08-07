import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

/**
 * Karty pod 768 px.
 *
 * ROZVRŽENÍ SAMOTNÉ DĚLÁ CSS (varianty `max-md:`) a jsdom CSS nepočítá, takže
 * se tady hlídají dvě věci, které na CSS nestojí: rozdělení sloupců do rolí
 * (jaká třída na buňce sedí) a VYPNUTÍ VIRTUALIZACE, které je v JavaScriptu.
 * Že karta na 390 px opravdu nepřeteče, je změřené v prohlížeči a zapsané
 * v `HOTOVO.md`; z jsdom se to tvrdit nedá.
 */

type Contact = {
  id: string;
  email: string;
  name: string;
  status: string;
  lists: string;
  created: string;
};

function contact(index: number): Contact {
  return {
    id: `c${index}`,
    email: `kontakt${index}@firma.cz`,
    name: `Jméno ${index}`,
    status: 'Aktivní',
    lists: 'Newsletter',
    created: '6. 8. 2026',
  };
}

const few = Array.from({ length: 3 }, (_, index) => contact(index));
const many = Array.from({ length: 120 }, (_, index) => contact(index));

const columns: DataTableColumn<Contact>[] = [
  { id: 'email', header: 'E-mail', cell: (row) => row.email, sortable: true },
  { id: 'name', header: 'Jméno', cell: (row) => row.name },
  { id: 'status', header: 'Stav', cell: (row) => row.status },
  { id: 'lists', header: 'Seznamy', cell: (row) => row.lists },
  { id: 'created', header: 'Přidán', cell: (row) => row.created, width: 100 },
  { id: 'actions', header: '', cell: () => <button type="button">Nabídka řádku</button> },
];

const labels = {
  selectRow: 'Označit řádek',
  selectAllOnPage: 'Označit všechny řádky na stránce',
  previous: 'Předchozí',
  next: 'Další',
  showing: (shown: number, total: number) => `Zobrazeno ${shown} z ${total}`,
  selectedOnPage: (count: number) => `Vybráno ${count}`,
  selectAllMatching: (total: number) => `Vybrat všech ${total}`,
  selectedAllMatching: (total: number) => `Vybráno všech ${total}`,
  clearSelection: 'Zrušit výběr',
  cursorInvalid: 'Seznam se změnil.',
  sortNotAvailable: 'Řadit nejde.',
  sortedAscending: 'seřazeno vzestupně',
  sortedDescending: 'seřazeno sestupně',
  columnSettings: 'Nastavit sloupce',
  columnVisible: (column: string) => `Zobrazit sloupec ${column}`,
};

function table(rows: Contact[]) {
  return (
    <DataTable<Contact>
      tableId="contacts"
      caption="Kontakty"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      labels={labels}
      count={{ value: rows.length, precision: 'exact' }}
      pagination={{ hasMore: false, onPrevious: vi.fn(), onNext: vi.fn(), canGoBack: false }}
      order={{ value: 'email.asc', onChange: vi.fn() }}
      defaultVisibleColumns={6}
    />
  );
}

/** Úzké okno. Bez tohohle odpoví podlaha ze `vitest.setup.ts` „ne", tedy monitor. */
function stubWidth(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query === '(max-width: 767px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Buňka řádku podle pořadí sloupce. Zaškrtávátko je nultá, proto posun. */
function cell(row: HTMLElement, index: number): HTMLElement {
  return within(row).getAllByRole('gridcell')[index + 1]!;
}

describe('DataTable: karty pod 768 px', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('hlavní údaj, tři doplňkové a nabídka řádku; šestý sloupec na kartě není', () => {
    stubWidth(true);
    render(table(few));
    const row = screen.getAllByRole('row')[1]!;

    // IDENTIFIKÁTOR MÁ CELÝ PRVNÍ ŘÁDEK SÁM PRO SEBE (`basis-full`). Vedle něj
    // nesmí stát ani odznak stavu, ani nabídka: je to údaj, podle kterého
    // člověk řádek hledá, a všechno ostatní ho jen zužuje.
    expect(cell(row, 0).className).toContain('max-md:basis-full');
    expect(cell(row, 0).className).toContain('max-md:font-semibold');
    expect(cell(row, 0)).toHaveTextContent('kontakt0@firma.cz');

    // NIKDY SE NEUŘÍZNE TŘEMI TEČKAMI. Zkrácená adresa je k nepoznání od jiné
    // adresy téhož zákazníka. Zkrácení si nese sama buňka od obrazovky
    // (`truncate` na odkazu), takže se ruší i uvnitř, ne jen na obalu.
    expect(cell(row, 0).className).toContain('max-md:[overflow-wrap:anywhere]');
    expect(cell(row, 0).className).toContain('[&_*]:max-md:whitespace-normal');
    expect(cell(row, 0).className).toContain('[&_*]:max-md:overflow-visible');

    // KLIKACÍ PLOCHA HLAVNÍHO ÚDAJE JE 44 PX, i když je to jen odkaz.
    // Výška odkazu je jinak výška řádku textu, naměřeno 22 px na 390 px.
    expect(cell(row, 0).className).toContain('max-md:min-h-[var(--size-target-min)]');
    expect(cell(row, 0).className).toContain('[&>a]:max-md:min-h-[var(--size-target-min)]');

    // Tři doplňkové údaje. Každý má vlastní řádek (`basis-full`) a před
    // hodnotou název sloupce, jinak by nebylo poznat, co která hodnota je.
    for (const [index, header] of [
      [1, 'Jméno'],
      [2, 'Stav'],
      [3, 'Seznamy'],
    ] as const) {
      expect(cell(row, index).className).toContain('max-md:basis-full');
      expect(within(cell(row, index)).getByText(header)).toBeInTheDocument();
    }

    // Šestý údaj se na kartu nevejde a `display: none` ho vezme i z pořadí
    // fokusu, takže se do něj nedá tabulovat.
    expect(cell(row, 4).className).toContain('max-md:hidden');

    // NABÍDKA ŘÁDKU JE V PRAVÉM HORNÍM ROHU KARTY a je MIMO TOK, aby vedle
    // identifikátoru nestála. Je to jediná cesta k akcím řádku, takže musí být
    // vždycky na témž místě a nesmí ji odsunout obsah.
    expect(cell(row, 5).className).toContain('max-md:absolute');
    expect(cell(row, 5).className).toContain('max-md:right-[var(--spacing-inline)]');
    expect(within(cell(row, 5)).getByRole('button', { name: 'Nabídka řádku' })).toBeVisible();
    // Řádek jí drží místo vnitřním okrajem, jinak by pod ni dlouhá adresa
    // podtekla.
    expect(row.className).toContain(
      'max-md:pr-[calc(var(--size-target-min)+var(--spacing-inline))]',
    );
  });

  /**
   * Kontakt bez jména měl na kartě řádek „JMÉNO" a za ním nic, což vypadá jako
   * chybějící data, ne jako nevyplněný údaj.
   */
  it('prázdný doplňkový údaj se na kartě nekreslí ani s popiskem', () => {
    stubWidth(true);
    const bezJmena = [{ ...contact(0), name: '' }];
    render(table(bezJmena));
    const row = screen.getAllByRole('row')[1]!;

    // Buňka jména je pryč i s popiskem.
    expect(cell(row, 1).className).toContain('max-md:hidden');
    expect(within(cell(row, 1)).queryByText('Jméno')).toBeNull();
    // Ostatní doplňkové údaje zůstávají.
    expect(within(cell(row, 2)).getByText('Stav')).toBeInTheDocument();
  });

  it('název sloupce u hodnoty je na mřížce schovaný a nečte ho ani čtečka', () => {
    stubWidth(false);
    render(table(few));
    const row = screen.getAllByRole('row')[1]!;
    const header = within(cell(row, 1)).getByText('Jméno');

    // Na monitoru nese název hlavička, takže se u hodnoty jen schová. Není to
    // podmíněné vykreslení schválně: CSS platí i před hydratací, kdežto
    // JavaScript by na první vykreslení ukázal název na obou místech.
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('max-md:inline');
    // `aria-hidden` platí na obou šířkách: tentýž název nese `columnheader`,
    // který je i na kartách jen `sr-only`, takže by se přečetl dvakrát.
    expect(header).toHaveAttribute('aria-hidden');
  });

  it('hlavička sloupců je na kartách sr-only, ne pryč, aby ji čtečka měla dál', () => {
    stubWidth(true);
    render(table(few));
    const head = screen.getByTestId('data-table-head');
    const headers = within(head).getAllByRole('columnheader');

    // Neřaditelný sloupec: skrytý pro oko, dostupný pro čtečku.
    expect(headers[2]!.className).toContain('max-md:sr-only');
    // Řaditelný zůstává VIDĚT: tlačítko řazení je jediná cesta, jak tabulku
    // seřadit, a `sr-only` prvek se nedá stisknout prstem.
    expect(headers[1]!.className).toContain('max-md:flex-none');
    expect(within(head).getByRole('button', { name: /E-mail/ })).toBeVisible();
  });

  /**
   * Nejostřejší z celé karty. Virtualizovaný řádek má pevných 44 px a absolutní
   * pozici, kdežto karta měří přes sto pixelů: karty by se překryly a text by
   * ležel přes text. Přesně tohle bylo na obrazovce vidět.
   */
  it('na kartách se virtualizace nezapne ani nad stem řádků', () => {
    stubWidth(true);
    render(table(many));

    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    expect(within(grid).getAllByRole('row')).toHaveLength(many.length + 1);
    const row = screen.getAllByRole('row')[1]!;
    expect(row.style.position).toBe('');
    expect(row.style.height).toBe('');
  });

  it('na monitoru se nad stem řádků virtualizuje dál', () => {
    stubWidth(false);
    render(table(many));

    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    // Vykreslí se jen zlomek řádků. Kolik přesně, rozhoduje virtualizátor
    // podle výšky rámu, kterou jsdom nepočítá, takže se tvrdí jen „míň".
    expect(within(grid).getAllByRole('row').length).toBeLessThan(many.length);
    // Počet pro čtečku se bere z dat, ne z vykreslených uzlů.
    expect(grid).toHaveAttribute('aria-rowcount', String(many.length + 1));
  });

  it('pevná šířka sloupce na kartě neplatí, na mřížce ano', () => {
    stubWidth(false);
    const { unmount } = render(table(few));
    expect(cell(screen.getAllByRole('row')[1]!, 4).style.width).toBe('100px');
    unmount();

    stubWidth(true);
    window.localStorage.clear();
    render(table(few));
    // Vnitřní styl se na kartě nedá přebít třídou, proto se vynechává úplně.
    expect(cell(screen.getAllByRole('row')[1]!, 4).style.width).toBe('');
  });
});
