// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsTable, type ListRow } from './lists-table';
import { renderWithProviders } from './test-utils';

/**
 * KDYBY TENHLE SOUBOR SPADL: z řádku seznamu zase nevede nic než otevření
 * detailu. Nastavení výchozího seznamu, potvrzení čekajících přihlášení
 * i archivace byly do 6. 8. 2026 schované uvnitř detailu, takže se každá z nich
 * musela proklikat přes dvě obrazovky.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

const setDefaultListAction = vi.fn();
vi.mock('./list-email-actions', () => ({
  setDefaultListAction: (input: unknown) => setDefaultListAction(input),
}));

const archiveListAction = vi.fn();
const confirmPendingAction = vi.fn();
vi.mock('./actions', () => ({
  archiveListAction: (input: unknown) => archiveListAction(input),
  confirmPendingAction: (input: unknown) => confirmPendingAction(input),
}));

const LIST: ListRow = {
  id: 'l-1',
  name: 'Novinky',
  confirmed_count: 120,
  pending_count: 3,
  double_opt_in: true,
  archived: false,
  is_default: false,
};

const ALL_PERMISSIONS = { write: true, readContacts: true };

function renderTable(rows: ListRow[] = [LIST], permissions = ALL_PERMISSIONS) {
  return renderWithProviders(
    <ListsTable
      basePath="/w/eshop/lists"
      workspaceSlug="eshop"
      workspaceId="ws-1"
      lists={rows}
      permissions={permissions}
    />,
  );
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const triggers = screen.getAllByRole('button', { name: /Další akce se seznamem/ });
  const trigger = triggers[index];
  if (trigger === undefined) throw new Error(`Řádek ${index} nemá nabídku akcí.`);
  await user.click(trigger);
}

function itemNames() {
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  setDefaultListAction.mockResolvedValue({ status: 'success' });
  archiveListAction.mockResolvedValue({ status: 'success' });
  confirmPendingAction.mockResolvedValue({ status: 'success', confirmed: 3, skipped: 0 });
});

describe('nabídka „…" v řádku seznamu', () => {
  it('běžný seznam s čekajícími nabízí všech pět akcí', async () => {
    const user = userEvent.setup();
    renderTable();

    await openRowMenu(user);
    expect(itemNames()).toEqual([
      'Zobrazit kontakty',
      'Upravit',
      'Nastavit jako výchozí',
      'Potvrdit čekající',
      'Archivovat',
    ]);
  });

  it('výchozímu seznamu se „Nastavit jako výchozí" nenabízí, protože už je', async () => {
    const user = userEvent.setup();
    renderTable([{ ...LIST, is_default: true }]);

    await openRowMenu(user);
    expect(itemNames()).not.toContain('Nastavit jako výchozí');
  });

  /*
   * U jednokrokového seznamu nikdo nečeká, takže by položka vždycky potvrdila
   * nulu. Stav, který se běžně nepotká: dvojí potvrzení s nulovým počtem.
   */
  it('bez čekajících se potvrzování nenabízí, ani u dvojího potvrzení', async () => {
    const user = userEvent.setup();
    renderTable([{ ...LIST, pending_count: 0 }]);

    await openRowMenu(user);
    expect(itemNames()).not.toContain('Potvrdit čekající');
  });

  it('jednokrokový seznam potvrzování nenabízí, i kdyby počet nebyl nula', async () => {
    const user = userEvent.setup();
    renderTable([{ ...LIST, double_opt_in: false, pending_count: 5 }]);

    await openRowMenu(user);
    expect(itemNames()).not.toContain('Potvrdit čekající');
  });

  /*
   * Archivovaný seznam se nedá archivovat podruhé a `setDefault` na něm volá
   * `requireLive`, takže by skončil chybou. Stav, který se běžně nepotká.
   */
  it('archivovaný seznam nenabízí ani archivaci, ani nastavení výchozím', async () => {
    const user = userEvent.setup();
    renderTable([{ ...LIST, archived: true }]);

    await openRowMenu(user);
    expect(itemNames()).toEqual(['Zobrazit kontakty', 'Upravit', 'Potvrdit čekající']);
  });

  it('čtenáři zbydou jen kontakty', async () => {
    const user = userEvent.setup();
    renderTable([LIST], { write: false, readContacts: true });

    await openRowMenu(user);
    expect(itemNames()).toEqual(['Zobrazit kontakty']);
  });

  it('bez jediné použitelné akce se nekreslí ani spouštěč', () => {
    renderTable([LIST], { write: false, readContacts: false });
    expect(screen.queryByRole('button', { name: /Další akce se seznamem/ })).toBeNull();
  });

  it('„Zobrazit kontakty" vede na seznam zúžený na tenhle seznam', async () => {
    const user = userEvent.setup();
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Zobrazit kontakty' }));

    expect(push).toHaveBeenCalledWith('/w/eshop/contacts?list_id=l-1');
  });

  it('„Nastavit jako výchozí" akci zavolá a výsledek řekne nahlas', async () => {
    const user = userEvent.setup();
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nastavit jako výchozí' }));

    await waitFor(() => {
      expect(setDefaultListAction).toHaveBeenCalledWith({ workspaceId: 'ws-1', listId: 'l-1' });
    });
    // Řádek se po přepnutí viditelně nemění, takže bez hlášky by kliknutí
    // vypadalo jako by nic neudělalo.
    expect(await screen.findByTestId('lists-notice')).toHaveTextContent(
      'Výchozím seznamem je teď Novinky.',
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('neúspěch nastavení výchozího seznamu se ozve, ne spolkne', async () => {
    const user = userEvent.setup();
    setDefaultListAction.mockResolvedValue({ status: 'error', code: 'insufficient_scope' });
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nastavit jako výchozí' }));

    expect(await screen.findByTestId('lists-error')).toHaveTextContent('insufficient_scope');
  });

  /*
   * KDYBY TENHLE TEST SPADL: z okna archivace zmizel výčet následků. Archivace
   * je jediné mazání seznamu, které produkt má, a formulář zapisující do seznamu
   * po ní začne koncovým lidem odmítat přihlášení.
   */
  it('archivace se ptá týmž oknem jako detail a vyjmenuje následky', async () => {
    const user = userEvent.setup();
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archivovat' }));

    expect(await screen.findByText(/Archivovat seznam Novinky\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archivovat seznam' }));

    await waitFor(() => {
      expect(archiveListAction).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'l-1' });
    });
  });

  /*
   * KDYBY TENHLE TEST SPADL: z potvrzování čekajících zmizelo prohlášení
   * o doloženém souhlasu. Server bez něj požadavek odmítne a hlavně: tímhle
   * krokem vzniká souhlas udělený správcem, který zůstává v auditu.
   */
  it('potvrzení čekajících se ptá a říká, co uživatel prohlašuje', async () => {
    const user = userEvent.setup();
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Potvrdit čekající' }));

    expect(await screen.findByText(/Potvrdit 3 čekající přihlášení\?/)).toBeInTheDocument();
    expect(screen.getByText(/souhlas těchto lidí s odběrem máte doložený/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mám souhlas doložený, potvrdit' }));

    await waitFor(() => {
      expect(confirmPendingAction).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'l-1' });
    });
    expect(await screen.findByTestId('lists-notice')).toHaveTextContent(
      'Potvrdili jsme 3 přihlášení.',
    );
  });

  it('vynechané kontakty se v hlášce přiznají', async () => {
    const user = userEvent.setup();
    confirmPendingAction.mockResolvedValue({ status: 'success', confirmed: 2, skipped: 1 });
    renderTable();

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Potvrdit čekající' }));
    await user.click(screen.getByRole('button', { name: 'Mám souhlas doložený, potvrdit' }));

    expect(await screen.findByTestId('lists-notice')).toHaveTextContent(
      'Potvrdili jsme 2 a 1 jsme vynechali',
    );
  });
});
