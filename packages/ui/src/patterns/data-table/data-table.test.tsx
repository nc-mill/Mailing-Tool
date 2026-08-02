import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

type Contact = { id: string; email: string; name: string };

const rows: Contact[] = Array.from({ length: 5 }, (_, index) => ({
  id: `c${index}`,
  email: `kontakt${index}@firma.cz`,
  name: `Jméno ${index}`,
}));

const columns: DataTableColumn<Contact>[] = [
  { id: 'email', header: 'E-mail', cell: (row) => row.email, sortable: true },
  { id: 'name', header: 'Jméno', cell: (row) => row.name },
];

const labels = {
  selectRow: 'Označit řádek',
  selectAllOnPage: 'Označit všechny řádky na stránce',
  previous: 'Předchozí',
  next: 'Další',
  showing: (shown: number, total: number, estimated: boolean) =>
    `Zobrazeno ${shown} z ${estimated ? '~' : ''}${total}`,
  selectedOnPage: (count: number) => `Vybráno ${count} kontaktů na této stránce`,
  selectAllMatching: (total: number) => `Vybrat všech ${total} odpovídajících filtru`,
  selectedAllMatching: (total: number) => `Vybráno všech ${total} kontaktů odpovídajících filtru.`,
  clearSelection: 'Zrušit výběr',
  cursorInvalid: 'Seznam se mezitím změnil, jste zpátky na začátku.',
  sortNotAvailable: 'Podle tohohle sloupce řadit nejde.',
  sortedAscending: 'seřazeno vzestupně',
  sortedDescending: 'seřazeno sestupně',
  columnSettings: 'Nastavit sloupce',
  columnVisible: (column: string) => `Zobrazit sloupec ${column}`,
  columnWidth: (column: string) => `Šířka sloupce ${column}`,
};

function base(overrides: Partial<React.ComponentProps<typeof DataTable<Contact>>> = {}) {
  return {
    tableId: 'contacts',
    caption: 'Kontakty',
    columns,
    rows,
    getRowId: (row: Contact) => row.id,
    labels,
    count: { value: 12_480, precision: 'estimated' as const },
    pagination: { hasMore: true, onPrevious: vi.fn(), onNext: vi.fn(), canGoBack: false },
    order: { value: 'email.asc', onChange: vi.fn() },
    ...overrides,
  };
}

describe('DataTable', () => {
  // Nastavení sloupců se ukládá do localStorage, takže by prosakovalo
  // mezi testy a jeden test by nastavoval výchozí stav druhému.
  beforeEach(() => window.localStorage.clear());

  it('má roli grid a správný aria-rowcount včetně hlavičky', () => {
    render(<DataTable {...base()} />);
    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    expect(grid).toHaveAttribute('aria-rowcount', '6');
  });

  it('nikde nezobrazuje čísla stránek, jen Předchozí a Další', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByRole('button', { name: 'Další' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '2' })).toBeNull();
  });

  it('celkový počet ukazuje s vlnovkou, dokud není přesný', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByText('Zobrazeno 5 z ~12480')).toBeVisible();
  });

  it('přesný počet ukazuje bez vlnovky', () => {
    render(<DataTable {...base({ count: { value: 5, precision: 'exact' } })} />);
    expect(screen.getByText('Zobrazeno 5 z 5')).toBeVisible();
  });

  it('šipkami a klávesou j se dá projít řádky', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    const firstRow = screen.getAllByRole('row')[1]!;
    firstRow.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('row')[2]).toHaveFocus();

    await user.keyboard('j');
    expect(screen.getAllByRole('row')[3]).toHaveFocus();

    await user.keyboard('k');
    expect(screen.getAllByRole('row')[2]).toHaveFocus();
  });

  it('mezerník i x označí řádek z klávesnice', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    screen.getAllByRole('row')[1]!.focus();

    await user.keyboard('x');
    expect(within(screen.getAllByRole('row')[1]!).getByRole('checkbox')).toBeChecked();

    await user.keyboard('x');
    expect(within(screen.getAllByRole('row')[1]!).getByRole('checkbox')).not.toBeChecked();
  });

  it('po výběru na stránce nabídne výběr všeho podle filtru', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Označit všechny řádky na stránce' }));

    expect(screen.getByText('Vybráno 5 kontaktů na této stránce')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Vybrat všech 12480 odpovídajících filtru' }),
    ).toBeVisible();
  });

  it('neplatný kurzor vysvětlí a ukáže první stránku, ne prázdno ani chybu', () => {
    render(<DataTable {...base({ cursorInvalid: true })} />);
    expect(screen.getByText('Seznam se mezitím změnil, jste zpátky na začátku.')).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('sloupec mimo povolené hodnoty order řazení vůbec nenabízí', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByRole('button', { name: /E-mail/ })).toBeVisible();
    // Sloupec Jméno není sortable, takže tam žádné tlačítko není.
    expect(screen.queryByRole('button', { name: /^Jméno/ })).toBeNull();
  });

  it('hlavička je sticky, aby nezakryla fokusovaný řádek', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByTestId('data-table-head').className).toContain('sticky');
  });

  it('Shift a klik označí rozsah řádků i v prohlížeči, ne jen v hooku', async () => {
    // Rozsahový výběr byl otestovaný jen na logice. Že se `shiftKey`
    // ze skutečného kliknutí do té logiky vůbec dostane, nehlídalo nic.
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Označit řádek' });

    await user.click(boxes[0]!);
    // `user.click` druhý parametr nepřijímá, modifikátor se drží klávesnicí.
    await user.keyboard('{Shift>}');
    await user.click(boxes[3]!);
    await user.keyboard('{/Shift}');

    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).toBeChecked();
    expect(boxes[3]).toBeChecked();
    expect(boxes[4]).not.toBeChecked();
  });

  it('nabízí nastavení sloupců: viditelnost i šířku', async () => {
    // Hook `useColumnPreferences` existoval, měl testy, a tabulka ho
    // vůbec neimportovala. Tvrdý požadavek K1 na nastavitelné a ukládané
    // sloupce tím nebyl splněný.
    const user = userEvent.setup();
    render(<DataTable {...base()} />);

    await user.click(screen.getByRole('button', { name: 'Nastavit sloupce' }));
    expect(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' }));
    expect(screen.queryByRole('columnheader', { name: 'Jméno' })).toBeNull();
  });

  it('nastavení sloupců přežije nové připojení tabulky', async () => {
    const user = userEvent.setup();
    const first = render(<DataTable {...base()} />);
    await user.click(screen.getByRole('button', { name: 'Nastavit sloupce' }));
    await user.click(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' }));
    first.unmount();

    render(<DataTable {...base()} />);
    expect(screen.queryByRole('columnheader', { name: 'Jméno' })).toBeNull();
  });

  it('výběr jde řídit zvenčí, aby si ho obrazovka mohla držet', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<DataTable {...base({ selection: { selectedIds: [], onSelectionChange } })} />);
    await user.click(screen.getAllByRole('checkbox', { name: 'Označit řádek' })[0]!);
    expect(onSelectionChange).toHaveBeenCalledWith(['c0']);
  });

  it('prázdný seznam ukáže prázdný stav, ne prázdnou mřížku', () => {
    render(<DataTable {...base({ rows: [], emptyState: <p>Zatím tu nic není.</p> })} />);
    expect(screen.getByText('Zatím tu nic není.')).toBeVisible();
  });

  it('od sta řádků virtualizuje, ale aria-rowcount zůstane z dat', () => {
    // Mez ze specifikace 14.2. `aria-rowcount` se počítá z dat, ne
    // z vykreslených uzlů, takže čtečka hlásí správný počet i tehdy,
    // když je v DOM jen zlomek řádků.
    const many = Array.from({ length: 150 }, (_, index) => ({
      id: `c${index}`,
      email: `kontakt${index}@firma.cz`,
      name: `Jméno ${index}`,
    }));
    render(<DataTable {...base({ rows: many })} />);

    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    expect(grid).toHaveAttribute('aria-rowcount', '151');
    // Hlavička plus podmnožina řádků, rozhodně ne všech 150.
    expect(screen.getAllByRole('row').length).toBeLessThan(151);
  });

  it('pod stem řádků se virtualizace nezapíná', () => {
    render(<DataTable {...base()} />);
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });
});

/**
 * Tahle skupina vznikla kvůli reálné mezeře, ne pro pokrytí.
 *
 * Tabulka reagovala na `Enter`, ale na kliknutí myší neměla handler vůbec.
 * Klávesová cesta byla hotová a odladěná, takže nikoho nenapadlo zkusit myš,
 * a protože tuhle tabulku používají všechny seznamy v aplikaci, nešel myší
 * otevřít jediný z nich.
 */
describe('DataTable: otevření řádku myší', () => {
  beforeEach(() => window.localStorage.clear());

  it('kliknutí na řádek ho otevře', async () => {
    const onRowActivate = vi.fn();
    render(<DataTable {...base({ onRowActivate })} />);

    await userEvent.click(screen.getByText('kontakt2@firma.cz'));

    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate.mock.calls[0]?.[0]).toMatchObject({ id: 'c2' });
  });

  it('kliknutí na zaškrtávací políčko řádek NEotevře', async () => {
    const onRowActivate = vi.fn();
    render(<DataTable {...base({ onRowActivate })} />);

    const row = screen.getAllByRole('row')[3]!;
    await userEvent.click(within(row).getByRole('checkbox'));

    // Kdyby políčko řádek otevíralo, nešlo by označit víc položek: první
    // zaškrtnutí by odnavigovalo pryč.
    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it('bez onRowActivate se klikáním nic nestane', async () => {
    render(<DataTable {...base()} />);

    await userEvent.click(screen.getByText('kontakt1@firma.cz'));

    expect(screen.getByText('kontakt1@firma.cz')).toBeInTheDocument();
  });

  it('klávesnice a myš otevírají tentýž řádek', async () => {
    const onRowActivate = vi.fn();
    render(<DataTable {...base({ onRowActivate })} />);

    await userEvent.click(screen.getByText('kontakt2@firma.cz'));
    const klikem = onRowActivate.mock.calls[0]?.[0];

    onRowActivate.mockClear();
    const row = screen.getAllByRole('row')[3]!;
    row.focus();
    await userEvent.keyboard('{Enter}');

    expect(onRowActivate.mock.calls[0]?.[0]).toEqual(klikem);
  });
});
