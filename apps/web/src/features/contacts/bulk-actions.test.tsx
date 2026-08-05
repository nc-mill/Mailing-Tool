import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsBulkActions } from './bulk-actions';
import type { Selection } from './contacts-table';
import { renderWithProviders } from './test-utils';

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

const createContactExportAction = vi
  .fn()
  .mockResolvedValue({ status: 'success', id: 'e-1', downloadUrl: '/api/v1/x?token=t' });

vi.mock('./actions', () => ({
  bulkDeleteContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  bulkTagContactsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  createContactExportAction: (...args: unknown[]) => createContactExportAction(...args),
  exportStatusAction: vi.fn().mockResolvedValue({ status: 'success', state: 'completed' }),
}));

const confirmContactsAction = vi.fn();
vi.mock('./confirm-actions', () => ({
  confirmContactsAction: (...args: unknown[]) => confirmContactsAction(...args),
}));

const addContactsToListAction = vi.fn();
const removeContactsFromListAction = vi.fn();
vi.mock('./list-actions', () => ({
  addContactsToListAction: (...args: unknown[]) => addContactsToListAction(...args),
  removeContactsFromListAction: (...args: unknown[]) => removeContactsFromListAction(...args),
}));

const WORKSPACE = '019fbf52-d8b9-7b0d-b67e-528e8026a383';
const LISTS = [
  { id: 'l-1', name: 'Newsletter' },
  { id: 'l-2', name: 'Zákazníci' },
];

/** Výsledek povýšení jednoho kontaktu. Blokace adresy se předává zvlášť. */
function outcome(id: string, suppressionBlocking: string | null = null) {
  return { id, fromStatus: 'unconfirmed', changed: true, listsConfirmed: 1, suppressionBlocking };
}

const selection: Selection = {
  mode: 'ids',
  ids: new Set(['c-1', 'c-2']),
  count: 2,
};

function render(current: Selection = selection) {
  return renderWithProviders(
    <ContactsBulkActions
      workspaceId={WORKSPACE}
      selection={current}
      filters={{}}
      names={{ lists: {}, tags: {}, segments: {} }}
      lists={LISTS}
      // Adresy vybraných řádků. Bez nich se export výběru vědomě neprovede, protože
      // publikum umí vyjmenovat kontakty jen e-mailem; podrobně u `emailsToAudience`.
      selectedEmails={['a@firma.cz', 'b@firma.cz']}
    />,
  );
}

/**
 * jsdom nezná Pointer Capture ani `scrollIntoView`, na kterých Radix Select stojí.
 * Bez těchhle náhrad se rozbalovátko v testu neotevře a chyba vypadá jako vada
 * komponenty, přestože v prohlížeči funguje.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

async function chooseList(name: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: /přidat do seznamu/i }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  refresh.mockClear();
  confirmContactsAction.mockReset().mockResolvedValue({
    status: 'success',
    outcomes: [outcome('c-1'), outcome('c-2')],
  });
  addContactsToListAction.mockReset().mockResolvedValue({
    status: 'success',
    summary: { confirmed: 2, pending: 0, already: 0, blocked: 0 },
  });
  removeContactsFromListAction.mockReset().mockResolvedValue({
    status: 'success',
    summary: { unsubscribed: 2, unchanged: 0 },
  });
});

describe('hromadné potvrzení kontaktů', () => {
  it('pošle označené kontakty a ohlásí, kolik jich je potvrzených', async () => {
    render();

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzené/i }));

    await waitFor(() =>
      expect(confirmContactsAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        ids: ['c-1', 'c-2'],
      }),
    );
    expect(await screen.findByText(/2 kontakty jsou teď potvrzené/i)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('řekne pravdu o kontaktech, kterým zůstala blokovaná adresa', async () => {
    // „2 kontakty jsou teď potvrzené" by u kontaktu s živou blokací lhalo: stav se
    // změnil, ale odesílací cesta ho stejně přeskočí, protože suppression je vrstva
    // nad stavem.
    confirmContactsAction.mockResolvedValue({
      status: 'success',
      outcomes: [outcome('c-1'), outcome('c-2', 'complaint')],
    });
    render();

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzené/i }));

    expect(
      await screen.findByText(/potvrzeno 2, ale u 1 zůstává adresa blokovaná/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('chybu ukáže a seznam neobnovuje, aby nevypadal jako změněný', async () => {
    confirmContactsAction.mockResolvedValue({ status: 'error', code: 'forbidden' });
    render();

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzené/i }));

    expect(await screen.findByText(/nepodařilo změnit/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * Vada, kvůli které tenhle blok vznikl: nad tabulkou byla nabídka seznamů, uživatel
 * v ní vybral „Newsletter" a v liště nebylo NIC, čím by se výběr do seznamu přidal.
 * Zbylá dvě tlačítka uměla potvrdit stav a smazat.
 */
describe('hromadné přidání do seznamu', () => {
  it('tlačítko v liště je a říká, kolika kontaktů se to týká', async () => {
    render();

    expect(
      await screen.findByRole('button', { name: /přidat 2 kontakty do seznamu/i }),
    ).toBeInTheDocument();
  });

  it('bez vybraného seznamu je tlačítko vypnuté, aby akce nemířila nikam', () => {
    render();

    expect(screen.getByRole('button', { name: /přidat 2 kontakty do seznamu/i })).toBeDisabled();
  });

  it('pošle vybraný seznam i označené kontakty a ohlásí výsledek', async () => {
    addContactsToListAction.mockResolvedValue({
      status: 'success',
      summary: { confirmed: 1, pending: 0, already: 1, blocked: 0 },
    });
    render();

    await chooseList(/newsletter/i);
    await userEvent.click(screen.getByRole('button', { name: /přidat 2 kontakty do seznamu/i }));

    await waitFor(() =>
      expect(addContactsToListAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        listId: 'l-1',
        ids: ['c-1', 'c-2'],
      }),
    );
    expect(
      await screen.findByText(/seznam newsletter: nově přidáno 1, už tam bylo 1/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('řekne nahlas, že část kontaktů čeká na potvrzení, místo aby je počítala mezi příjemce', async () => {
    // Odhlášený kontakt se podle stavového automatu vrací VŽDY přes pending
    // s potvrzovacím odkazem. „Přidáno" bez téhle věty by slibovalo příjemce,
    // kteří v nejbližší rozesílce nebudou.
    addContactsToListAction.mockResolvedValue({
      status: 'success',
      summary: { confirmed: 0, pending: 2, already: 0, blocked: 0 },
    });
    render();

    await chooseList(/newsletter/i);
    await userEvent.click(screen.getByRole('button', { name: /přidat 2 kontakty do seznamu/i }));

    expect(await screen.findByText(/poslali e-mail s potvrzením přihlášení/i)).toBeInTheDocument();
  });

  it('přeskočené kontakty s blokovanou adresou nezamlčí', async () => {
    addContactsToListAction.mockResolvedValue({
      status: 'success',
      summary: { confirmed: 1, pending: 0, already: 0, blocked: 1 },
    });
    render();

    await chooseList(/newsletter/i);
    await userEvent.click(screen.getByRole('button', { name: /přidat 2 kontakty do seznamu/i }));

    expect(
      await screen.findByText(/1 kontakt jsme přidat nemohli, protože má blokovanou adresu/i),
    ).toBeInTheDocument();
  });

  it('chybu ukáže a seznam neobnovuje, aby nevypadal jako změněný', async () => {
    addContactsToListAction.mockResolvedValue({ status: 'error', code: 'forbidden' });
    render();

    await chooseList(/newsletter/i);
    await userEvent.click(screen.getByRole('button', { name: /přidat 2 kontakty do seznamu/i }));

    expect(await screen.findByText(/do seznamu nepodařilo přidat/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * Odebrání ze seznamu stojí u téže nabídky jako přidání a potvrzuje se dialogem.
 * Nabídka „Vrátit zpět" by lhala: návrat do seznamu jde přes pending a poslal by
 * lidem potvrzovací e-mail, takže se ptáme PŘED akcí.
 */
describe('hromadné odebrání ze seznamu', () => {
  async function openRemoveDialog() {
    await chooseList(/newsletter/i);
    await userEvent.click(screen.getByRole('button', { name: /odebrat 2 kontakty ze seznamu/i }));
  }

  it('tlačítko je vedle přidání a bez vybraného seznamu je vypnuté', () => {
    render();

    expect(screen.getByRole('button', { name: /odebrat 2 kontakty ze seznamu/i })).toBeDisabled();
  });

  it('nejdřív se zeptá dialogem a bez potvrzení nic neodešle', async () => {
    render();

    await openRemoveDialog();

    expect(
      await screen.findByText(/odebrat 2 kontakty ze seznamu newsletter\?/i),
    ).toBeInTheDocument();
    expect(removeContactsFromListAction).not.toHaveBeenCalled();
  });

  it('po potvrzení pošle vybraný seznam i označené kontakty a ohlásí výsledek', async () => {
    render();

    await openRemoveDialog();
    await userEvent.click(
      await screen.findByRole('button', { name: /odebrat 2 kontakty ze seznamu$/i }),
    );

    await waitFor(() =>
      expect(removeContactsFromListAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        listId: 'l-1',
        ids: ['c-1', 'c-2'],
      }),
    );
    expect(
      await screen.findByText(/seznam newsletter: odhlášeno 2, beze změny 0/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('nezamlčí kontakty, u kterých nebylo co měnit', async () => {
    // „Odebráno 2" u výběru, kde jeden člověk v seznamu vůbec nebyl, je lež.
    removeContactsFromListAction.mockResolvedValue({
      status: 'success',
      summary: { unsubscribed: 1, unchanged: 1 },
    });
    render();

    await openRemoveDialog();
    await userEvent.click(
      await screen.findByRole('button', { name: /odebrat 2 kontakty ze seznamu$/i }),
    );

    expect(
      await screen.findByText(/1 kontakt v seznamu nebyl, nebo v něm odhlášený už byl/i),
    ).toBeInTheDocument();
  });

  it('chybu ukáže a seznam neobnovuje, aby nevypadal jako změněný', async () => {
    removeContactsFromListAction.mockResolvedValue({ status: 'error', code: 'forbidden' });
    render();

    await openRemoveDialog();
    await userEvent.click(
      await screen.findByRole('button', { name: /odebrat 2 kontakty ze seznamu$/i }),
    );

    expect(await screen.findByText(/ze seznamu nepodařilo odebrat/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  /*
   * Export uvnitř dialogu mazání je POJISTKA PŘED NEVRATNOU AKCÍ, a do 5. 8. 2026
   * nefungoval: `exportContactsAction` posílala tvar, který schéma odmítá (422),
   * takže dialog tvrdil „Soubor je stažený" a zálohu uživatel neměl.
   */
  it('export v dialogu mazání opravdu stáhne soubor', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['e-mail\n'])) });
    vi.stubGlobal('fetch', fetchSpy);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    URL.revokeObjectURL = vi.fn();

    render();
    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    await user.click(
      await screen.findByRole('button', { name: /Stáhnout tyhle 2 kontakty jako CSV/ }),
    );

    await waitFor(() => expect(createContactExportAction).toHaveBeenCalled());
    // Publikum je výčet adres, ne `{ ids }`: podrobně u `emailsToAudience`.
    const [call] = createContactExportAction.mock.calls as [[{ audience: unknown }]];
    expect(JSON.stringify(call[0].audience)).toContain('"operator":"in"');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(await screen.findByTestId('bulk-delete-export-state')).toHaveTextContent(
      'Soubor je stažený',
    );
    vi.unstubAllGlobals();
  }, 15_000);
});
