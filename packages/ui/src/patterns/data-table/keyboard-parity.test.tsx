import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

/**
 * Tvrdý požadavek K1: ke každé myší cestě existuje rovnocenná klávesová.
 *
 * Testy níž to neověřují komentářem, ale skutečně: sweep tabulátorem
 * dokáže, že se na každý ovládací prvek dá dostat z klávesnice, a řada
 * dílčích testů dokazuje, že se každý prvek dá z klávesnice i spustit.
 */

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

function props(overrides: Partial<React.ComponentProps<typeof DataTable<Contact>>> = {}) {
  return {
    tableId: 'parity',
    caption: 'Kontakty',
    columns,
    rows,
    getRowId: (row: Contact) => row.id,
    labels,
    count: { value: 12_480, precision: 'estimated' as const },
    pagination: { hasMore: true, canGoBack: true, onPrevious: vi.fn(), onNext: vi.fn() },
    order: { value: 'email.asc', onChange: vi.fn() },
    ...overrides,
  };
}

/** Prvky, na které se musí dát dostat tabulátorem. Řádky mají roving tabindex. */
function tabbableTargets(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [role="row"][tabindex="0"]',
    ),
  );
}

/** Projde tabulátorem celý strom a vrátí prvky, na které se fokus nedostal. */
async function unreachableByTab(user: UserEvent, container: HTMLElement): Promise<HTMLElement[]> {
  const targets = tabbableTargets(container);
  const seen = new Set<Element>();
  for (let step = 0; step < targets.length + 4; step += 1) {
    await user.tab();
    if (document.activeElement !== null) seen.add(document.activeElement);
  }
  return targets.filter((element) => !seen.has(element));
}

describe('klávesová rovnocennost datové tabulky', () => {
  beforeEach(() => window.localStorage.clear());

  it('na každý ovládací prvek tabulky se dá dostat tabulátorem', async () => {
    const user = userEvent.setup();
    const { container } = render(<DataTable {...props()} />);

    // Mřížka musí mít vstupní bod do řádků, jinak by se na ně dalo
    // dostat jen myší.
    expect(container.querySelector('[role="row"][tabindex="0"]')).not.toBeNull();

    // Hlavičkové zaškrtávátko, řazení, pět řádkových zaškrtávátek,
    // tlačítko nastavení sloupců a obě stránkovací tlačítka.
    expect(tabbableTargets(container).length).toBeGreaterThanOrEqual(9);
    expect(await unreachableByTab(user, container)).toEqual([]);
  });

  it('na ovládací prvky otevřeného nastavení sloupců se taky dá dostat tabulátorem', async () => {
    const user = userEvent.setup();
    const { container } = render(<DataTable {...props()} />);

    const settings = screen.getByRole('button', { name: 'Nastavit sloupce' });
    settings.focus();
    await user.keyboard('{Enter}');

    // Dvě zaškrtávátka viditelnosti a dvě pole šířky navíc.
    expect(tabbableTargets(container).length).toBeGreaterThanOrEqual(13);
    expect(await unreachableByTab(user, container)).toEqual([]);
  });

  it('žádný prvek s rolí tlačítka nebo zaškrtávátka není mimo pořadí fokusu', () => {
    const { container } = render(<DataTable {...props()} />);

    const clickable = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"], [role="checkbox"], button'),
    );
    const outOfOrder = clickable.filter(
      (element) => element.tabIndex < 0 || element.getAttribute('aria-hidden') === 'true',
    );
    expect(outOfOrder).toEqual([]);
  });

  it('výběr řádku i rozsah jdou z klávesnice stejně jako myší', async () => {
    const user = userEvent.setup();
    render(<DataTable {...props()} />);

    const rowElements = () => screen.getAllByRole('row');
    rowElements()[1]!.focus();

    await user.keyboard('x');
    expect(rowElements()[1]).toHaveAttribute('aria-selected', 'true');

    // Rozsah: šipkami na čtvrtý řádek a Shift a mezerník.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Shift>} {/Shift}');

    expect(rowElements()[1]).toHaveAttribute('aria-selected', 'true');
    expect(rowElements()[2]).toHaveAttribute('aria-selected', 'true');
    expect(rowElements()[3]).toHaveAttribute('aria-selected', 'true');
    expect(rowElements()[4]).toHaveAttribute('aria-selected', 'false');
  });

  it('hlavičkový výběr, výběr podle filtru i zrušení jdou z klávesnice', async () => {
    const user = userEvent.setup();
    render(<DataTable {...props()} />);

    screen.getByRole('checkbox', { name: 'Označit všechny řádky na stránce' }).focus();
    await user.keyboard(' ');
    expect(screen.getByText('Vybráno 5 kontaktů na této stránce')).toBeVisible();

    screen.getByRole('button', { name: 'Vybrat všech 12480 odpovídajících filtru' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Vybráno všech 12480 kontaktů odpovídajících filtru.')).toBeVisible();

    screen.getByRole('button', { name: 'Zrušit výběr' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('řazení jde spustit z klávesnice', async () => {
    const user = userEvent.setup();
    const order = { value: 'email.asc', onChange: vi.fn() };
    render(<DataTable {...props({ order })} />);

    screen.getByRole('button', { name: /E-mail/ }).focus();
    await user.keyboard('{Enter}');
    expect(order.onChange).toHaveBeenCalledWith('email.desc');
  });

  it('viditelnost i šířka sloupce jdou nastavit z klávesnice', async () => {
    const user = userEvent.setup();
    render(<DataTable {...props()} />);

    screen.getByRole('button', { name: 'Nastavit sloupce' }).focus();
    await user.keyboard('{Enter}');

    const width = screen.getByLabelText('Šířka sloupce E-mail');
    width.focus();
    await user.keyboard('320');
    expect(width).toHaveValue(320);

    screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('columnheader', { name: 'Jméno' })).toBeNull();
  });

  it('stránkování jde ovládat z klávesnice', async () => {
    const user = userEvent.setup();
    const pagination = { hasMore: true, canGoBack: true, onPrevious: vi.fn(), onNext: vi.fn() };
    render(<DataTable {...props({ pagination })} />);

    screen.getByRole('button', { name: 'Další' }).focus();
    await user.keyboard('{Enter}');
    expect(pagination.onNext).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: 'Předchozí' }).focus();
    await user.keyboard('{Enter}');
    expect(pagination.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('otevření řádku jde z klávesnice, ne jen dvojklikem', async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    render(<DataTable {...props({ onRowActivate })} />);

    screen.getAllByRole('row')[2]!.focus();
    await user.keyboard('{Enter}');
    expect(onRowActivate).toHaveBeenCalledWith(rows[1]!);
  });
});
