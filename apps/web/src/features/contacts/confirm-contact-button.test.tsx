import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmContactButton } from './confirm-contact-button';
import { renderWithProviders } from './test-utils';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
}));

const confirmContactsAction = vi.fn();
vi.mock('./confirm-actions', () => ({
  confirmContactsAction: (...args: unknown[]) => confirmContactsAction(...args),
}));

const WORKSPACE = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

function outcome(suppressionBlocking: string | null = null) {
  return {
    id: 'c-1',
    fromStatus: 'unconfirmed',
    changed: true,
    listsConfirmed: 1,
    suppressionBlocking,
  };
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  confirmContactsAction.mockReset().mockResolvedValue({
    status: 'success',
    outcomes: [outcome()],
  });
});

describe('ruční potvrzení jednoho kontaktu', () => {
  it.each(['unconfirmed', 'bounced'])(
    'u stavu %s je to jedno kliknutí bez okna navíc',
    async (status) => {
      renderWithProviders(
        <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status={status} />,
      );

      await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

      await waitFor(() =>
        expect(confirmContactsAction).toHaveBeenCalledWith({
          workspaceId: WORKSPACE,
          ids: ['c-1'],
        }),
      );
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    },
  );

  it('u stěžujícího si se akce NABÍDNE, jen se napřed zeptá jedním oknem', async () => {
    // Zákaz zmizel. Zadavatel je správce vlastní instalace a chce povýšit kdykoli;
    // stížnost na spam je ale rozhodnutí příjemce, takže se přepisuje vědomě.
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="complained" />,
    );

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(confirmContactsAction).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getAllByRole('button', { name: /označit jako potvrzený/i }).at(-1)!,
    );

    await waitFor(() =>
      expect(confirmContactsAction).toHaveBeenCalledWith({
        workspaceId: WORKSPACE,
        ids: ['c-1'],
      }),
    );
  });

  it('okno u stěžujícího si přizná, že adresa zůstane blokovaná', async () => {
    // Bez téhle věty by dialog slíbil rozesílku, která nikdy neproběhne: stížnost
    // na spam se ze seznamu blokovaných adres sundat nedá vůbec.
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="complained" />,
    );

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

    expect(await screen.findByText(/označil náš e-mail jako spam/i)).toBeInTheDocument();
    expect(screen.getByText(/zůstane mezi blokovanými/i)).toBeInTheDocument();
  });

  it('okno jde zavřít, aniž by se cokoliv stalo', async () => {
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="complained" />,
    );

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^zrušit$/i }));

    expect(confirmContactsAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['active', 'deleted', 'unsubscribed'])('u stavu %s se nenabídne', (status) => {
    // `active` už potvrzený je, `deleted` není nepotvrzený kontakt, ale smazaný:
    // cesta zpátky je obnova a server by na něj odpověděl 404.
    //
    // `unsubscribed` je nález zadavatele: KDO SE ODHLÁSIL, BYL NUTNĚ POTVRZENÝ, jinak by
    // mu nemohlo nic dojít a neměl by se jak odhlásit. Tlačítko u něj netvrdilo nic
    // nového a slovem „potvrzený" zakrývalo, že přepisuje rozhodnutí příjemce. Patří
    // k němu „přihlásit zpět" (`resubscribe`), a to je jiná, poctivě pojmenovaná akce.
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status={status} />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('nikde neříká, že to nejde', async () => {
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="complained" />,
    );
    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/povýšit nejde/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/jde to jen u kontaktu/i)).not.toBeInTheDocument();
  });

  it('zůstávající blokaci ohlásí, místo aby ji vydával za hotovo', async () => {
    confirmContactsAction.mockResolvedValue({
      status: 'success',
      outcomes: [outcome('hard_bounce')],
    });
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="bounced" />,
    );

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

    expect(await screen.findByText(/adresa zůstává blokovaná/i)).toBeInTheDocument();
    expect(screen.getByText(/adresa neexistuje/i)).toBeInTheDocument();
    // Stav se přesto změnil, takže obrazovka musí ukázat aktuální data.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('chybu ze serveru ukáže, místo aby ji spolkla', async () => {
    confirmContactsAction.mockResolvedValue({ status: 'error', code: 'forbidden' });
    renderWithProviders(
      <ConfirmContactButton workspaceId={WORKSPACE} contactId="c-1" status="unconfirmed" />,
    );

    await userEvent.click(screen.getByRole('button', { name: /označit jako potvrzený/i }));

    expect(await screen.findByText(/nepodařilo změnit/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('v řádku seznamu nese popisek s adresou, aby šla tlačítka rozlišit', () => {
    // Ve sloupci je deset stejně pojmenovaných tlačítek. Bez adresy by odečítač
    // obrazovky přečetl desetkrát totéž.
    renderWithProviders(
      <ConfirmContactButton
        workspaceId={WORKSPACE}
        contactId="c-1"
        status="unconfirmed"
        email="jan@x.cz"
        variant="row"
      />,
    );

    expect(
      screen.getByRole('button', { name: /označit kontakt jan@x\.cz jako potvrzený/i }),
    ).toBeInTheDocument();
    // Vysvětlující věta patří na detail, ne do řádku tabulky.
    expect(screen.queryByText(/zapíšeme souhlas s vaším prohlášením/i)).not.toBeInTheDocument();
  });
});
