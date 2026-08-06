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

/**
 * Serverová akce potvrzení se musí podvrhnout, i když se v testech nevolá.
 * `ConfirmContactButton` ji importuje, s ní se natáhne HTTP klient a v něm
 * `import 'server-only'`, které v testovém prostředí shodí CELÝ soubor ještě
 * před prvním testem („This module cannot be imported from a Client Component
 * module"). Padá tedy import, ne tvrzení, a chybová hláška na skutečnou
 * příčinu vůbec neukazuje. Stejný mock má z téhož důvodu `contacts-table.test.tsx`.
 */
const confirmContactsAction = vi.fn().mockResolvedValue({
  status: 'success',
  outcomes: [
    {
      id: 'c-1',
      fromStatus: 'unsubscribed',
      changed: true,
      listsConfirmed: 1,
      suppressionBlocking: null,
    },
  ],
});

vi.mock('./confirm-actions', () => ({
  confirmContactsAction: (input: unknown) => confirmContactsAction(input),
}));

const deleteContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const unsubscribeContactAction = vi.fn().mockResolvedValue({ status: 'success' });
const createContactExportAction = vi
  .fn()
  .mockResolvedValue({ status: 'success', id: 'e-1', downloadUrl: '/api/v1/x?token=t' });

vi.mock('./actions', () => ({
  deleteContactAction: (input: unknown) => deleteContactAction(input),
  unsubscribeContactAction: (input: unknown) => unsubscribeContactAction(input),
  createContactExportAction: (input: unknown) => createContactExportAction(input),
  // `contact-export.tsx` si sahá i pro stav exportu, aby po dokončení nabídlo
  // stažení. Bez téhle položky spadne celý soubor na chybějícím exportu v mocku.
  exportStatusAction: vi.fn().mockResolvedValue({ status: 'success', data: null }),
}));

const restrictProcessingAction = vi.fn().mockResolvedValue({ status: 'success' });
const liftProcessingRestrictionAction = vi.fn().mockResolvedValue({ status: 'success' });

// Stejný důvod jako u ostatních mocků v tomhle souboru: serverová akce s sebou
// natáhne `@/lib/api-client/mutate` a v něm `import 'server-only'`, které shodí
// celý soubor ještě před prvním testem.
vi.mock('./restriction-actions', () => ({
  restrictProcessingAction: (input: unknown) => restrictProcessingAction(input),
  liftProcessingRestrictionAction: (input: unknown) => liftProcessingRestrictionAction(input),
}));

const resendConfirmationAction = vi.fn().mockResolvedValue({ status: 'success' });
const cancelSnoozeAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./edit-actions', () => ({
  resendConfirmationAction: (input: unknown) => resendConfirmationAction(input),
  cancelSnoozeAction: (input: unknown) => cancelSnoozeAction(input),
}));

// Serverové akce oslovení se musí odstínit taky, jinak se přes ně načte
// `@/lib/api-client/mutate` s importem `server-only`, který v testu vyhodí
// „This module cannot be imported from a Client Component module" a shodí
// celý soubor ještě před prvním testem.
const setGreetingAction = vi.fn().mockResolvedValue({ status: 'success' });
const clearGreetingAction = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./greeting-actions', () => ({
  setGreetingAction: (input: unknown) => setGreetingAction(input),
  clearGreetingAction: (input: unknown) => clearGreetingAction(input),
}));

const base: ContactDetailData = {
  id: 'c-1',
  email: 'jana@firma.cz',
  name: 'Jana Nováková',
  greeting: 'Jano',
  greeting_locked: true,
  greeting_status: {
    greeting: 'Jano',
    first_name: 'Jana',
    first_name_vocative: 'Jano',
    vocative_confidence: 'high',
    vocative_locked: true,
    locale: 'cs',
  },
  gender: 'female',
  status: 'active',
  processing_restricted: false,
  snooze_until: null,
  anonymized_at: null,
  status_changed_at: '2026-07-03T10:00:00.000Z',
  restriction: null,
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
  confirmContactsAction.mockClear();
  cancelSnoozeAction.mockClear();
  deleteContactAction.mockClear();
  unsubscribeContactAction.mockClear();
  createContactExportAction.mockClear();
  restrictProcessingAction.mockClear();
  liftProcessingRestrictionAction.mockClear();
});

function renderDetail(overrides: Partial<ContactDetailData> = {}, canManage = true) {
  return renderWithProviders(
    <ContactDetail
      basePath="/w/eshop/contacts"
      workspacePath="/w/eshop"
      workspaceId="w-1"
      contact={{ ...base, ...overrides }}
      workspaceLocale="cs"
      canManageRestriction={canManage}
    />,
  );
}

describe('ContactDetail', () => {
  it('u omezeného zpracování ukáže vysvětlující blok včetně věty o segmentech', () => {
    renderDetail({
      processing_restricted: true,
      restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: null },
    });
    const block = screen.getByTestId('contact-restricted');
    expect(block).toHaveTextContent('Tenhle kontakt má omezené zpracování');
    expect(block).toHaveTextContent('vypadl ze všech segmentů');
  });

  /**
   * Blok o omezeném zpracování odkazoval na `settings/privacy`, což je obrazovka,
   * která v aplikaci není a nechystá se: souhlasy a GDPR jsou odložené. Odkaz proto
   * vracel 404. Po něm tu byla věta „požádejte správce systému", protože zrušit
   * omezení nešlo nikde v produktu. Teď je na tom místě tlačítko, které míří na
   * `DELETE /contacts/{id}/processing-restriction`.
   */
  it('u omezeného zpracování neslibuje neexistující obrazovku a nabízí zrušení', () => {
    renderDetail({
      processing_restricted: true,
      restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: null },
    });
    const block = screen.getByTestId('contact-restricted');
    expect(screen.getByTestId('lift-restriction')).toHaveTextContent('Zrušit omezení');
    expect(block).not.toHaveTextContent('požádejte správce systému');
    expect(screen.queryByRole('link', { name: 'Zobrazit žádost' })).toBeNull();
    expect(
      block.querySelector('a[href*="/settings/privacy"]'),
      'odkaz na settings/privacy vede na 404, ta obrazovka neexistuje',
    ).toBeNull();
  });

  it('bez oprávnění ukáže místo tlačítka větu, koho požádat', () => {
    renderDetail(
      {
        processing_restricted: true,
        restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: null },
      },
      false,
    );
    expect(screen.queryByTestId('lift-restriction')).toBeNull();
    expect(screen.getByTestId('contact-restricted')).toHaveTextContent(
      'Zrušit omezení smí správce projektu nebo vlastník',
    );
  });

  /**
   * Datum se bere z auditního záznamu o zapnutí omezení, ne z `updated_at`. Dřív
   * stránka posílala `restriction_requested_at: null` a věta ukazovala datum poslední
   * jakékoli změny kontaktu, takže se po opravě překlepu ve jméně „datum žádosti"
   * posunulo. Když záznam není, věta datum neuvádí a nevymýšlí si ho.
   */
  it('bez záznamu v auditu neukáže žádné datum omezení', () => {
    renderDetail({ processing_restricted: true, restriction: null });
    const block = screen.getByTestId('contact-restricted');
    expect(block).toHaveTextContent('má omezené zpracování údajů podle článku 18');
    expect(block.textContent).not.toContain('3. 7. 2026');
  });

  it('poznámku z auditu ukáže, aby bylo vidět, čeho se žádost týkala', () => {
    renderDetail({
      processing_restricted: true,
      restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: 'Žádost e-mailem 18. 7.' },
    });
    expect(screen.getByTestId('restriction-note')).toHaveTextContent('Žádost e-mailem 18. 7.');
  });

  it('u neomezeného kontaktu nabízí zapnutí omezení', () => {
    renderDetail();
    // V hlavičce je to ikonový čtverec, takže význam nese přístupné jméno,
    // ne text uvnitř. Kontroluje se proto jméno, ne obsah prvku: kdyby zmizel
    // `aria-label`, ikona by zůstala nesrozumitelná a test by to zachytil.
    expect(screen.getByTestId('restrict-processing')).toHaveAccessibleName('Omezit zpracování');
  });

  it('u už omezeného kontaktu se zapnutí nenabízí podruhé', () => {
    // Opačná akce je ve žlutém bloku nahoře, takže dvě tlačítka k témuž tématu
    // nejsou na obrazovce zároveň.
    renderDetail({
      processing_restricted: true,
      restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: null },
    });
    expect(screen.queryByTestId('restrict-processing')).toBeNull();
  });

  it('bez oprávnění se tlačítko pro zapnutí omezení nenabízí', () => {
    renderDetail({}, false);
    expect(screen.queryByTestId('restrict-processing')).toBeNull();
  });

  it('u omezeného zpracování odkazuje do auditu na záznam o tomhle kontaktu', () => {
    renderDetail({
      processing_restricted: true,
      restriction: { restricted_at: '2026-07-18T08:00:00.000Z', note: null },
    });
    expect(screen.getByRole('link', { name: 'Zobrazit záznam v auditu' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/audit?target_id=c-1',
    );
  });

  it('bez omezeného zpracování žádný takový blok není', () => {
    renderDetail();
    expect(screen.queryByTestId('contact-restricted')).toBeNull();
  });

  it('u aktivního kontaktu bez příznaků žádný žlutý blok nahoře není', () => {
    // Blok se stavem se ukazuje jen tam, kde je co vysvětlit. U aktivního
    // kontaktu by z něj byl prázdný pruh na první obrazovce.
    renderDetail();
    expect(screen.queryByTestId('contact-status-notice')).toBeNull();
  });

  it('u nepotvrzeného kontaktu vysvětlí stav a hned u něj nabídne ruční potvrzení', () => {
    renderDetail({ status: 'unconfirmed' });
    const notice = screen.getByTestId('contact-status-notice');
    expect(notice).toHaveTextContent('nepotvrdil odkaz v e-mailu');
    // Vysvětlení, kdy se to smí použít, stojí v bloku vedle tlačítka, ne pod ním.
    expect(notice).toHaveTextContent('Potvrdíme je i v jejich seznamech');
    expect(
      screen.getByRole('button', { name: 'Označit kontakt jana@firma.cz jako potvrzený' }),
    ).toBeInTheDocument();
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
    // Visací zámek nahradil odznak se slovem a celou větou. Ikona sama říkala jen
    // „někdo to potvrdil"; neuměla rozlišit odhad od tvaru ze slovníku ani ohlásit,
    // že jazyk kontaktu 5. pád vůbec nemá.
    expect(screen.getByText('Potvrzeno ručně')).toBeInTheDocument();
    expect(screen.getByText(/Tvar potvrdil člověk/)).toBeInTheDocument();
  });

  it('u odhadnutého oslovení nabídne cestu do fronty Kontrola oslovení', () => {
    renderDetail({
      greeting_status: {
        greeting: 'Dobrý den, Nikolo',
        first_name: 'Nikola',
        first_name_vocative: 'Nikolo',
        vocative_confidence: 'low',
        vocative_locked: false,
        locale: 'cs',
      },
    });
    expect(screen.getByText('Odhad')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zkontrolovat nejistá oslovení' })).toHaveAttribute(
      'href',
      '/w/eshop/contacts/vocative-review',
    );
  });

  /** Přesně ten stav, který uživatel nahlásil: uložený tvar je 1. pád, a nebylo to vidět. */
  it('u kontaktu v jazyce bez 5. pádu to řekne rovnou', () => {
    renderDetail({
      greeting_status: {
        greeting: 'Hello Petr',
        first_name: 'Petr',
        first_name_vocative: 'Petr',
        vocative_confidence: 'high',
        vocative_locked: false,
        locale: 'en',
      },
    });
    expect(screen.getByText('Bez 5. pádu')).toBeInTheDocument();
    expect(screen.getByText(/ve kterém se 5. pád nepoužívá/)).toBeInTheDocument();
  });

  /**
   * DRUHÁ HLÁŠENÁ VADA: „když ho uložím a zamknu, tak se mi tam zobrazí Oslovujeme
   * 'Hello Petře'." Odznak v tu chvíli říká „Potvrzeno ručně" a rozdíl jazyků,
   * kvůli kterému je v české větě anglické „Hello", není odnikud vidět.
   */
  it('rozdíl mezi jazykem kontaktu a jazykem projektu vysvětlí i u zamknutého tvaru', () => {
    renderDetail({
      greeting: 'Hello Petře',
      greeting_locked: true,
      greeting_status: {
        greeting: 'Hello Petře',
        first_name: 'Petr',
        first_name_vocative: 'Petře',
        vocative_confidence: 'high',
        vocative_locked: true,
        locale: 'en',
      },
    });
    const mismatch = screen.getByTestId('greeting-locale-mismatch');
    expect(mismatch).toHaveTextContent(/angličtin/i);
    expect(mismatch).toHaveTextContent(/češtin/i);
    expect(screen.getByRole('link', { name: 'Sjednotit jazyk kontaktů' })).toHaveAttribute(
      'href',
      '/w/eshop/settings/general',
    );
  });

  it('u kontaktu se stejným jazykem jako projekt se o jazyku nic nepíše', () => {
    renderDetail();
    expect(screen.queryByTestId('greeting-locale-mismatch')).not.toBeInTheDocument();
  });

  it('nabídne ruční přepis tvaru a uloží ho zamknutý', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Upravit oslovení' }));
    const field = screen.getByLabelText('Jméno v 5. pádu');
    await user.clear(field);
    await user.type(field, 'Janičko');
    await user.click(screen.getByRole('button', { name: 'Uložit a zamknout' }));
    expect(setGreetingAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1', firstNameVocative: 'Janičko' }),
    );
  });

  it('smazaný kontakt je jen pro čtení a nemá mazací tlačítko', () => {
    renderDetail({ status: 'deleted' });
    expect(screen.getByText('Kontakt je smazaný, takže se dá jen prohlížet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat' })).toBeNull();
  });

  /**
   * Naměřená vada z třídy „napsané, otestované, nezapojené": tohle místo dřív
   * vykreslovalo natvrdo zástupný prázdný stav a data osy nikdy nenačetlo,
   * přestože doména, endpoint i samostatná stránka `/contacts/{id}/timeline`
   * fungovaly. Uživatel viděl „zatím se nic nestalo" u kontaktu, který otevřel
   * kampaně. Starý test to nechytil, protože tvrdil o zástupném textu.
   *
   * Kdyby tenhle test spadl: neupravuj ho zpátky na kontrolu prázdné věty.
   * Znamená to, že detail zase přestal osu číst.
   */
  it('časovou osu doopravdy načítá, místo aby kreslila prázdný stav', () => {
    renderDetail();
    const timeline = screen.getByTestId('contact-timeline');

    // Komponenta osy si nadpis, filtry i vlastní prázdný stav řeší sama, takže
    // se tu kontroluje JEN to, že je namontovaná a že si sáhla pro data.
    expect(timeline.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(timeline).not.toHaveTextContent('Zatím se nic nestalo');
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
    // Kontakt se do publika vyjmenuje adresou: id do podmínek publika nepatří.
    expect(createContactExportAction).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w-1' }),
    );
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

  /**
   * Naměřená vada: „Přihlásit zpět" volalo `POST /lists/{id}/subscribe`, tedy cestu
   * pro přihlášení PŘÍJEMCEM. Stavový automat vrací odhlášeného vždycky přes
   * `pending` s potvrzovacím odkazem, takže rozhraní slíbilo e-mail, ten nedorazil
   * a kontakt zůstal „Odhlášený". Správce vlastní instalace přitom musí umět vrátit
   * člověka, který o návrat požádal telefonem.
   *
   * Kdyby tenhle test spadl: neupravuj ho tak, aby zase posílal potvrzovací e-mail.
   */
  it('přihlásit zpět nejdřív varuje a teprve po potvrzení vrátí kontakt ručně', async () => {
    const user = userEvent.setup();
    renderDetail({
      status: 'unsubscribed',
      lists: [{ id: 'l-1', name: 'Zákazníci', status: 'unsubscribed' }],
    });

    await user.click(screen.getByRole('button', { name: 'Přihlásit zpět' }));

    // Samotné kliknutí nesmí nic změnit: přepisuje se rozhodnutí příjemce.
    expect(confirmContactsAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('z odběru sám odhlásil');
    expect(dialog).toHaveTextContent('Žádný potvrzovací e-mail se neposílá.');

    await user.click(screen.getAllByRole('button', { name: 'Přihlásit zpět' }).at(-1)!);

    // Vrací se cestou pro výslovné rozhodnutí správce, ne přihlášením do seznamu.
    expect(confirmContactsAction).toHaveBeenCalledWith({ workspaceId: 'w-1', ids: ['c-1'] });
  });

  it('u odhlášeného kontaktu je tlačítko jedno, ne jedno na každý seznam', () => {
    renderDetail({
      status: 'unsubscribed',
      lists: [
        { id: 'l-1', name: 'Zákazníci', status: 'unsubscribed' },
        { id: 'l-2', name: 'Novinky', status: 'unsubscribed' },
      ],
    });

    // Vracení pracuje s kontaktem jako celkem, takže dvě tlačítka by předstírala
    // výběr, který server nenabízí.
    expect(screen.getAllByRole('button', { name: 'Přihlásit zpět' })).toHaveLength(1);
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
