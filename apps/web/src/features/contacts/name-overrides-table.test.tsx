import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NameOverridesTable, type NameOverrideRow } from './name-overrides-table';
import { renderWithProviders } from './test-utils';

// Radix Select potřebuje v jsdom zachytávání ukazatele a `scrollIntoView`,
// jinak se nabídka nikdy neotevře. Táž čtveřice stojí u testů tabulky polí.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const upsert = vi.fn().mockResolvedValue({ status: 'success' });
const remove = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  upsertNameOverrideAction: (...args: unknown[]) => upsert(...args),
  deleteNameOverrideAction: (...args: unknown[]) => remove(...args),
}));

const overrides: NameOverrideRow[] = [
  {
    id: 'o-1',
    kind: 'first',
    nameKey: 'nikola',
    gender: 'female',
    vocative: 'Nikolo',
    note: null,
  },
  { id: 'o-2', kind: 'last', nameKey: 'novak', gender: 'male', vocative: null, note: 'z importu' },
];

function renderTable(rows: NameOverrideRow[] = overrides) {
  return renderWithProviders(<NameOverridesTable workspaceId="w-1" overrides={rows} />);
}

beforeEach(() => {
  upsert.mockClear();
  remove.mockClear();
});

describe('NameOverridesTable', () => {
  /**
   * Jádro celého nálezu: do slovníku šlo jen zapisovat. Kdyby se přestal
   * vypisovat, byl by překlep v pátém pádu zase neviditelný a trvalý.
   */
  it('vypíše, co ve slovníku je, včetně pátého pádu', () => {
    renderTable();
    expect(screen.getByText('nikola')).toBeInTheDocument();
    expect(screen.getByText('Nikolo')).toBeInTheDocument();
    expect(screen.getByText('novak')).toBeInTheDocument();
    expect(screen.getByText('z importu')).toBeInTheDocument();
  });

  it('u úpravy nepustí ke změně jména ani druhu, protože tvoří klíč', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByTestId('edit-name-override-nikola'));

    expect(screen.getByTestId('name-override-key')).toHaveTextContent('nikola');
    expect(screen.queryByTestId('name-override-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('name-override-kind')).not.toBeInTheDocument();
  });

  /**
   * Od opravy zápisu ze 7. 8. 2026 prázdné pole hodnotu VYMAŽE. Věta zůstává,
   * protože si uživatel musí být jistý, který ze dvou opačných významů platí:
   * do té doby ho obrazovka poctivě varovala, že se nesmaže nic.
   */
  it('u úpravy řekne, že prázdné pole hodnotu vymaže', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByTestId('edit-name-override-nikola'));
    expect(screen.getByTestId('name-override-clear-hint')).toHaveTextContent(/VYMAŽE/);
  });

  /**
   * Vymazání pátého pádu se musí na server dostat jako `null`, ne jako vynechané
   * pole: server ty dva významy od 7. 8. 2026 rozlišuje a vynechání by znamenalo
   * „nech, jak bylo", tedy tichý opak toho, co uživatel udělal.
   */
  it('vymazaný pátý pád pošle jako null, ne jako vynechané pole', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByTestId('edit-name-override-nikola'));

    await user.clear(screen.getByTestId('name-override-vocative'));
    await user.click(screen.getByTestId('name-override-submit'));

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ vocative: null }));
    const [call] = upsert.mock.calls as [[Record<string, unknown>]];
    expect('vocative' in call[0]).toBe(true);
  });

  it('uloží opravený pátý pád pod stejným klíčem', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByTestId('edit-name-override-nikola'));

    const vocative = screen.getByTestId('name-override-vocative');
    await user.clear(vocative);
    await user.type(vocative, 'Nikolo Anno');
    await user.click(screen.getByTestId('name-override-submit'));

    expect(upsert).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      kind: 'first',
      name: 'nikola',
      gender: 'female',
      vocative: 'Nikolo Anno',
      note: null,
    });
  });

  it('smazání se ptá a řekne obojí, co uživatel čeká špatně', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByTestId('delete-name-override-novak'));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/Kontakty, které přepis už ovlivnil, se nezmění/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/znovu objevit v kontrole oslovení/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Smazat přepis' }));
    expect(remove).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'o-2' });
  });

  it('prázdný slovník nabídne založení, ne slepou uličku', async () => {
    const user = userEvent.setup();
    renderTable([]);
    await user.click(screen.getByRole('button', { name: 'Přidat přepis' }));
    expect(screen.getByTestId('name-override-name')).toBeInTheDocument();
  });
});

/**
 * HROMADNÉ MAZÁNÍ Z PRUHU VÝBĚRU.
 *
 * KDYBY TENHLE BLOK SPADL: zaškrtávátka ve slovníku přepisů zase nikam nevedou.
 * `DataTable` je kreslí vždycky a vypnout se nedají. Zrovna tady je hromadné
 * mazání to nejužitečnější, co obrazovka může mít: do slovníku se zapisuje po
 * jednom z kontroly oslovení, takže se v něm překlepy hromadí.
 */
describe('hromadné mazání přepisů', () => {
  async function selectRow(user: ReturnType<typeof userEvent.setup>, index: number) {
    // Popisek řádkového zaškrtávátka je `nameOverrides.name`, tedy „Jméno";
    // hlavičkové má „Přepisy jmen", takže se nepletou.
    const boxes = screen.getAllByRole('checkbox', { name: 'Jméno' });
    const box = boxes[index];
    if (box === undefined) throw new Error(`Řádek ${index} nemá zaškrtávátko.`);
    await user.click(box);
  }

  it('výběr vede k akci, ne jen k počtu', async () => {
    const user = userEvent.setup();
    renderTable();

    await selectRow(user, 0);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('name-overrides-bulk-delete')).toHaveTextContent('Smazat 1 přepis');
  });

  it('potvrzení smaže všechny označené', async () => {
    const user = userEvent.setup();
    renderTable();

    await selectRow(user, 0);
    await selectRow(user, 1);
    expect(screen.getByTestId('name-overrides-bulk-delete')).toHaveTextContent('Smazat 2 přepisy');

    await user.click(screen.getByTestId('name-overrides-bulk-delete'));
    await user.click(screen.getByTestId('name-overrides-bulk-submit'));

    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'o-1' });
    expect(remove).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'o-2' });
  });

  it('nezdar výběr nezruší a pojmenuje se počtem', async () => {
    remove.mockResolvedValue({ status: 'error', code: 'conflict' });
    const user = userEvent.setup();
    renderTable();

    await selectRow(user, 0);
    await user.click(screen.getByTestId('name-overrides-bulk-delete'));
    await user.click(screen.getByTestId('name-overrides-bulk-submit'));

    const error = await screen.findByTestId('name-overrides-bulk-error');
    expect(error).toHaveTextContent('conflict');
    // Odklikaná práce se po chybě neztrácí.
    expect(screen.getByTestId('name-overrides-bulk-delete')).toBeInTheDocument();
  });
});
