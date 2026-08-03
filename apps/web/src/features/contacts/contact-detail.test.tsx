import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactDetail, type ContactDetailData } from './contact-detail';
import { renderWithProviders } from './test-utils';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
}));

const deleteContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const unsubscribeContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const exportContactAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  deleteContactAction: (input: unknown) => deleteContactAction(input),
  unsubscribeContactAction: (input: unknown) => unsubscribeContactAction(input),
  exportContactAction: (input: unknown) => exportContactAction(input),
}));

const resendConfirmationAction = vi.fn().mockResolvedValue({ status: 'success' });
const resubscribeAction = vi.fn().mockResolvedValue({ status: 'success' });
const cancelSnoozeAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./edit-actions', () => ({
  resendConfirmationAction: (input: unknown) => resendConfirmationAction(input),
  resubscribeAction: (input: unknown) => resubscribeAction(input),
  cancelSnoozeAction: (input: unknown) => cancelSnoozeAction(input),
}));

const base: ContactDetailData = {
  id: 'c-1',
  email: 'jana@firma.cz',
  name: 'Jana Nováková',
  greeting: 'Jano',
  greeting_locked: true,
  gender: 'female',
  status: 'active',
  processing_restricted: false,
  snooze_until: null,
  anonymized_at: null,
  status_changed_at: '2026-07-03T10:00:00.000Z',
  restriction_requested_at: null,
  lists: [{ id: 'l-1', name: 'Zákazníci', status: 'confirmed' }],
  tags: [{ id: 't-1', name: 'Brno' }],
  attributes: [{ key: 'city', label: 'Město', value: 'Brno' }],
  source: 'Import',
  subscribed_at: '2026-06-12T14:20:00.000Z',
  consent_summary: 'formulář na webu, 12. 6. 2026 14:20',
};

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  resendConfirmationAction.mockClear();
  resubscribeAction.mockClear();
  cancelSnoozeAction.mockClear();
  deleteContactAction.mockClear();
  unsubscribeContactAction.mockClear();
  exportContactAction.mockClear();
});

function renderDetail(overrides: Partial<ContactDetailData> = {}) {
  return renderWithProviders(
    <ContactDetail
      basePath="/w/eshop/contacts"
      workspacePath="/w/eshop"
      workspaceId="w-1"
      contact={{ ...base, ...overrides }}
    />,
  );
}

describe('ContactDetail', () => {
  it('u omezeného zpracování ukáže vysvětlující blok včetně věty o segmentech', () => {
    renderDetail({
      processing_restricted: true,
      restriction_requested_at: '2026-07-18T08:00:00.000Z',
    });
    const block = screen.getByTestId('contact-restricted');
    expect(block).toHaveTextContent('Tenhle kontakt má omezené zpracování');
    expect(block).toHaveTextContent('vypadl ze všech segmentů');
    expect(screen.getByRole('link', { name: 'Zobrazit žádost' })).toBeInTheDocument();
  });

  it('bez omezeného zpracování žádný takový blok není', () => {
    renderDetail();
    expect(screen.queryByTestId('contact-restricted')).toBeNull();
  });

  it('nenabízí tlačítko, které nemá co zavolat', () => {
    renderDetail();
    // Odesílání jednorázové zprávy jednomu kontaktu v produktu neexistuje. Dokud
    // nevznikne, nesmí se ta akce vykreslit: mrtvé tlačítko tvrdí, že e-mail odešel.
    expect(screen.queryByRole('button', { name: 'Poslat jednorázový e-mail' })).toBeNull();
  });

  it('odkaz na změnu oslovení míří na editaci, ne na neexistující obrazovku', () => {
    renderDetail();
    expect(screen.getByRole('link', { name: 'Změnit' })).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1/edit',
    );
  });

  it('stav nese slovo, ne jen barvu', () => {
    renderDetail({ status: 'bounced' });
    expect(screen.getByText('Nedoručitelný')).toBeInTheDocument();
    expect(screen.getByText(/Adresa neexistuje/)).toBeInTheDocument();
  });

  it('u zamčeného oslovení vysvětlí zámek slovem, ne jen ikonou', () => {
    renderDetail();
    expect(screen.getByText('Jano')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Oslovení potvrdil člověk, nástroj ho nepřepíše.'),
    ).toBeInTheDocument();
  });

  it('smazaný kontakt je jen pro čtení a nemá mazací tlačítko', () => {
    renderDetail({ status: 'deleted' });
    expect(screen.getByText('Kontakt je smazaný, takže se dá jen prohlížet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat' })).toBeNull();
  });

  it('má místo pro časovou osu s prázdným stavem, který jmenuje kontakt', () => {
    renderDetail();
    const timeline = screen.getByTestId('contact-timeline');
    expect(timeline).toHaveTextContent('Zatím se nic nestalo');
    expect(timeline).toHaveTextContent('Jana Nováková');
  });

  it('dialog smazání má doslovné znění ze 8.8 části 6 a nabídne stažení dat', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    expect(screen.getByText('Smazat kontakt Jana Nováková?')).toBeInTheDocument();
    expect(
      screen.getByText(/V reportech odeslaných kampaní zůstanou jen souhrnná čísla/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Adresa zůstane na blokovaných adresách/)).toBeInTheDocument();
    expect(screen.getByText('Tuhle akci nejde vzít zpět.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stáhnout data kontaktu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nemazat' })).toBeInTheDocument();
  });

  it('u anonymizovaného kontaktu nezobrazuje osobní údaje', () => {
    renderDetail({ status: 'deleted', anonymized_at: '2026-07-20T09:00:00.000Z' });
    expect(screen.queryByText('Město')).toBeNull();
    expect(screen.getByText(/Zůstal jen záznam/)).toBeInTheDocument();
  });

  it('odkazuje na historii souhlasů, ne na neexistující obrazovku', () => {
    renderDetail();
    expect(screen.getByRole('link', { name: 'Historie souhlasů' })).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1/consents',
    );
  });
});

/**
 * Regrese na nález I92. Tři akce detailu volaly API bez `workspaceId`, takže
 * požadavku chyběla hlavička `X-Workspace-Id`, běžel mimo kontext projektu a RLS
 * nevrátila ani řádek: uživatel dostal 404 na kontakt, který měl na obrazovce.
 *
 * Testuje se to na detailu, ne jen v `actions.test.ts`, protože chyba měla dvě
 * poloviny: akce parametr neznala a obrazovka ho nepředávala. Sama o sobě by
 * každá z nich prošla.
 */
describe('ContactDetail předává projekt do serverových akcí', () => {
  it('smazání pošle workspaceId', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Smazat' }));
    await user.click(screen.getByRole('button', { name: 'Smazat kontakt' }));
    expect(deleteContactAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'c-1' });
  });

  it('odhlášení pošle workspaceId a seznamy, ze kterých se odhlašuje', async () => {
    // Odhlášení je v API operace nad SEZNAMEM (`DELETE /lists/{id}/subscribe`).
    // Endpoint `POST /contacts/{id}/unsubscribe`, na který akce dřív mířila,
    // v API vůbec není, takže tlačítko padalo na 404 i s hlavičkou projektu.
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Odhlásit' }));
    expect(unsubscribeContactAction).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      email: 'jana@firma.cz',
      listIds: ['l-1'],
    });
  });

  it('kontakt bez živého přihlášení odhlašovací tlačítko vůbec nenabídne', () => {
    renderDetail({ lists: [{ id: 'l-1', name: 'Zákazníci', status: 'unsubscribed' }] });
    expect(screen.queryByRole('button', { name: 'Odhlásit' })).toBeNull();
  });

  it('export pošle workspaceId', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Exportovat' }));
    expect(exportContactAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'c-1' });
  });
});

/**
 * Tři tlačítka, která se do téhle chvíle vykreslila, dala zmáčknout a NEUDĚLALA NIC,
 * protože neměla `onClick`. Testy proto netvrdí jen to, že tlačítko existuje: kontrolují,
 * že po kliknutí odešla akce se správnými parametry. Kdyby se `onClick` zase ztratil,
 * tlačítko by se dál vykreslilo a tenhle soubor by spadl.
 */
describe('akce detailu kontaktu opravdu volají server', () => {
  it('poslat potvrzení znovu míří na seznam s čekajícím přihlášením', async () => {
    const user = userEvent.setup();
    renderDetail({
      status: 'unconfirmed',
      lists: [
        { id: 'l-1', name: 'Zákazníci', status: 'confirmed' },
        { id: 'l-2', name: 'Novinky', status: 'pending' },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Poslat potvrzovací e-mail znovu' }));
    expect(resendConfirmationAction).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      listId: 'l-2',
      contactId: 'c-1',
    });
  });

  it('bez čekajícího přihlášení se poslat potvrzení znovu vůbec nenabídne', () => {
    renderDetail({
      status: 'unconfirmed',
      lists: [{ id: 'l-1', name: 'Zákazníci', status: 'confirmed' }],
    });
    expect(screen.queryByRole('button', { name: /potvrzovací e-mail/ })).toBeNull();
  });

  it('u víc čekajících přihlášení je tlačítko na každý seznam a nese jeho jméno', () => {
    renderDetail({
      status: 'unconfirmed',
      lists: [
        { id: 'l-1', name: 'Zákazníci', status: 'pending' },
        { id: 'l-2', name: 'Novinky', status: 'pending' },
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Poslat potvrzení znovu: Zákazníci' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Poslat potvrzení znovu: Novinky' }),
    ).toBeInTheDocument();
  });

  it('přihlásit zpět posílá adresu kontaktu do odhlášeného seznamu', async () => {
    const user = userEvent.setup();
    renderDetail({
      status: 'unsubscribed',
      lists: [{ id: 'l-1', name: 'Zákazníci', status: 'unsubscribed' }],
    });

    await user.click(screen.getByRole('button', { name: 'Přihlásit zpět' }));
    expect(resubscribeAction).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      listId: 'l-1',
      email: 'jana@firma.cz',
    });
  });

  it('zrušit pauzu volá akci s identifikátorem kontaktu', async () => {
    const user = userEvent.setup();
    renderDetail({ snooze_until: '2026-09-30T00:00:00.000Z' });

    await user.click(screen.getByRole('button', { name: 'Zrušit pauzu' }));
    expect(cancelSnoozeAction).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'c-1' });
  });

  it('zamítnutí limitem se ohlásí jako chyba, ne jako odeslaný e-mail', async () => {
    const user = userEvent.setup();
    resendConfirmationAction.mockResolvedValueOnce({
      status: 'error',
      code: 'resend_throttled',
    });
    renderDetail({
      status: 'unconfirmed',
      lists: [{ id: 'l-2', name: 'Novinky', status: 'pending' }],
    });

    await user.click(screen.getByRole('button', { name: 'Poslat potvrzovací e-mail znovu' }));
    expect(await screen.findByText(/resend_throttled/)).toBeInTheDocument();
  });

  it('otevře editaci kontaktu', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Upravit kontakt' }));
    expect(push).toHaveBeenCalledWith('/w/eshop/contacts/c-1/edit');
  });
});
