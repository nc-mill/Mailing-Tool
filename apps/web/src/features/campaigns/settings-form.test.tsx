import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, withProviders } from './test-utils';
import { failed, succeeded, IDLE, type ActionState } from '@/lib/feedback/action-result';
import type { Problem } from '@/lib/api-client/problem';
import {
  CampaignSettingsForm,
  type CampaignSettings,
  type CampaignSettingsOptions,
} from './settings-form';
import type { SenderIdentityOption } from './sender-identity-picker';

/**
 * Obrazovka nastavení existuje jen kvůli jedné věci: co kontrolní seznam před
 * odesláním vyžaduje, to musí jít TADY vyplnit. Testy proto míří na tu shodu,
 * ne na vzhled: předmět, publikum, šablona a odesílací účet.
 */

/**
 * Radix `Checkbox` uvnitř `<form>` vykreslí skryté pole a měří ho přes
 * `ResizeObserver`, který jsdom nemá. Prázdná náhrada stačí: měření jen
 * dorovnává velikost, na chování formuláře nemá vliv.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

/**
 * Radix `Select` se otevírá přes Pointer Events a při otevření odroluje na
 * vybranou položku. jsdom nezná ani jedno, takže bez těchhle náhrad spadne
 * kliknutí na spouštěč chybou `target.hasPointerCapture is not a function`
 * a nabídka se nikdy neotevře. Náhrady nic nesimulují, jen ta volání spolknou.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const unschedule = vi.fn().mockResolvedValue({ status: 'success' });
const deleteCampaign = vi.fn().mockResolvedValue({ status: 'success' });
/*
 * Mock musí nést VŠECHNY exporty, které si strom pod formulářem vytáhne.
 * Formulář volá odplánování a sekce mazání jednu akci; bez nich vitest hlásí
 * chybějící export už při importu, ne až při kliknutí.
 */
const rename = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  unscheduleCampaignAction: (input: unknown) => unschedule(input),
  deleteCampaignAction: (input: unknown) => deleteCampaign(input),
  // Přejmenování z hlavičky kroku 2. Nejde přes formulář ani přes jeho akci,
  // takže bez téhle náhrady by test sáhl na `revalidatePath` z Nextu.
  renameCampaignAction: (input: unknown) => rename(input),
}));

/*
 * Výběr uloženého odesílatele zapisuje ROVNOU, ne až uložením formuláře, takže
 * jeho akce musí být zastoupená stejně jako ty výš. Bez toho by test sáhl na
 * `revalidatePath` z Nextu, který mimo požadavek neexistuje.
 */
const applySender = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('@/features/senders/actions', () => ({
  applySenderToCampaignAction: (input: unknown) => applySender(input),
}));

// `useRouter` z `@mlain/i18n/navigation` potřebuje kontext směrovače, který
// jsdom nemá. `Link` zůstává obyčejným odkazem, aby šlo tvrdit na `href`.
const refresh = vi.fn();
const push = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

beforeEach(() => {
  /*
   * Adresa se mezi testy uklízí. Přepínač kroků do ní krok dopisuje a jsdom
   * si okno drží pro celý soubor, takže by krok z předchozího testu určoval,
   * čím další test začne.
   */
  window.history.replaceState(null, '', '/');
  unschedule.mockClear();
  unschedule.mockResolvedValue({ status: 'success' });
  push.mockClear();
  deleteCampaign.mockClear();
  deleteCampaign.mockResolvedValue({ status: 'success' });
  applySender.mockClear();
  applySender.mockResolvedValue({ status: 'success' });
  rename.mockClear();
  rename.mockResolvedValue({ status: 'success' });
  refresh.mockClear();
});

const CAMPAIGN: CampaignSettings = {
  id: 'camp-1',
  name: 'Letní výprodej',
  status: 'draft',
  subject: '',
  preheader: '',
  from_name: '',
  from_email: '',
  reply_to: null,
  template_id: null,
  provider_id: null,
  sender_domain_id: null,
  sender_identity_id: null,
  unsubscribe_list_id: null,
  track_opens: true,
  track_clicks: true,
  has_design: false,
  has_content: false,
  include_lists: [],
  include_segments: [],
  exclude_lists: [],
  exclude_segments: [],
};

const DEFAULT_IDENTITY: SenderIdentityOption = {
  id: 'sid-1',
  name: 'Newsletter Kolo shop',
  from_name: 'Kolo shop',
  from_email: 'newsletter@kolo-shop.cz',
  reply_to: 'odpovedi@kolo-shop.cz',
  provider_id: 'prov-1',
  sender_domain_id: 'dom-1',
  domain_verified: true,
};

const SECOND_IDENTITY: SenderIdentityOption = {
  id: 'sid-2',
  name: 'Fakturace',
  from_name: 'Kolo shop fakturace',
  from_email: 'faktury@kolo-shop.cz',
  reply_to: null,
  provider_id: 'prov-1',
  sender_domain_id: 'dom-1',
  domain_verified: true,
};

const OPTIONS: CampaignSettingsOptions = {
  // Dva seznamy schválně: rozsah odhlášení se u jednoho seznamu chová jinak
  // než u víc, takže s jediným seznamem by se ten rozdíl nedal otestovat.
  lists: [
    { id: 'list-1', name: 'Newsletter' },
    { id: 'list-2', name: 'VIP' },
  ],
  segments: [{ id: 'seg-1', name: 'Aktivní zákazníci' }],
  templates: [{ id: 'tpl-1', name: 'Výprodejová šablona' }],
  providers: [{ id: 'prov-1', name: 'Amazon SES' }],
  domains: [{ id: 'dom-1', name: 'kolo-shop.cz' }],
  senderIdentities: [DEFAULT_IDENTITY, SECOND_IDENTITY],
};

function renderForm(
  overrides: Partial<CampaignSettings> = {},
  action: (previous: ActionState, formData: FormData) => Promise<ActionState> = async () => IDLE,
  canEdit = true,
  options: CampaignSettingsOptions = OPTIONS,
) {
  return renderWithProviders(
    <CampaignSettingsForm
      action={action}
      workspaceId="ws-1"
      campaign={{ ...CAMPAIGN, ...overrides }}
      options={options}
      canEdit={canEdit}
      basePath="/w/kolo-shop"
    />,
  );
}

/** Přepnutí kroku, přesně jak ho udělá uživatel: kliknutím v přepínači. */
async function goToStep(step: 'content' | 'basics' | 'settings') {
  await userEvent.click(screen.getByTestId(`campaign-step-${step}`));
}

describe('nastavení kampaně', () => {
  it('nabízí pole pro všechno, co obrazovka odeslání vyžaduje', async () => {
    renderForm({ template_id: 'work-1' });

    // Krok předmětu, na kterém se formulář otevírá: krok obsahu je editor
    // na vlastní adrese a v tomhle formuláři žádný panel nemá.
    expect(screen.getByLabelText('Předmět')).toBeInTheDocument();

    // Krok nastavení.
    await goToStep('settings');
    expect(screen.getByLabelText('Odesílací účet')).toBeInTheDocument();
    // Publikum nese skupina zaškrtávátek, protože seznamů i segmentů může být víc.
    expect(screen.getByRole('checkbox', { name: 'Newsletter' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Aktivní zákazníci' })).toBeInTheDocument();
  });

  it('odešle vyplněné hodnoty serverové akci, ne jen na obrazovku', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({}, action);

    await userEvent.type(screen.getByLabelText('Předmět'), 'Letní výprodej začíná');
    await goToStep('settings');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Newsletter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get('subject')).toBe('Letní výprodej začíná');
    expect(formData.getAll('include_list')).toEqual(['list-1']);
    expect(formData.get('campaign_id')).toBe('camp-1');
    expect(formData.get('workspace_id')).toBe('ws-1');
  });

  it('předvyplní publikum, které kampaň už má', async () => {
    renderForm({ include_lists: ['list-1'] });
    await goToStep('settings');
    expect(screen.getByRole('checkbox', { name: 'Newsletter' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aktivní zákazníci' })).not.toBeChecked();
  });

  it('ukáže chybu validace u pole, kterého se týká', async () => {
    const problem: Problem = {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/campaigns/camp-1',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'subject', code: 'required', message: 'Zadejte předmět.' }],
    };
    renderForm({}, async () => failed('inline', problem));

    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(screen.getByText('Zadejte předmět.')).toBeInTheDocument());
    expect(screen.getByLabelText('Předmět')).toHaveAttribute('aria-invalid', 'true');
  });

  it('vede na kontrolní seznam odeslání, aby obrazovka nebyla slepá', () => {
    renderForm();
    expect(screen.getByTestId('to-send')).toHaveAttribute(
      'href',
      '/w/kolo-shop/campaigns/camp-1/send',
    );
  });

  /**
   * Regrese na tichou ztrátu dat, naměřenou v prohlížeči.
   *
   * `SelectField` si hodnotu drží ve vlastním stavu a bere ji z `defaultValue`
   * jen při vzniku. Když se komponenta po akci vytvoří znovu dřív, než dorazí
   * čerstvý payload, ustaví se na starou hodnotu a s novou se už nesrovná:
   * vybraný odesílací účet skočí na „Nevybráno" a DALŠÍ uložení pošle zástupnou
   * hodnotu, takže `provider_id` v databázi zmizí.
   *
   * Test na to jde přes to, co vadu léčí: rozbalovací seznam musí mít identitu
   * odvozenou z uložené hodnoty, aby ho nová hodnota donutila vzniknout znovu.
   *
   * Dřív tenhle test hlídal `template_id`. Ten se z formuláře odstěhoval, ale
   * vada je vlastností `SelectField`, ne toho jednoho pole, takže hlídat se
   * musí dál; jen na poli, které tu zůstalo.
   */
  it('po změně uložené hodnoty se rozbalovací seznam srovná s daty ze serveru', async () => {
    const { rerender } = renderForm();
    await goToStep('settings');
    expect(document.querySelector('input[name=provider_id]')).toHaveValue('__none__');

    rerender(
      withProviders(
        <CampaignSettingsForm
          action={async () => succeeded({ channel: 'inline', messageKey: 'settings.saved' })}
          workspaceId="ws-1"
          campaign={{ ...CAMPAIGN, provider_id: 'prov-1' }}
          options={OPTIONS}
          canEdit
          basePath="/w/kolo-shop"
        />,
      ),
    );

    expect(
      document.querySelector('input[name=provider_id]'),
      'seznam zůstal na staré hodnotě, takže další uložení odesílací účet smaže',
    ).toHaveValue('prov-1');
  });

  it('rozjetou kampaň ukazuje jako text, ne jako zašedlý formulář', () => {
    renderForm({ status: 'sending', subject: 'Letní výprodej začíná' }, undefined, false);

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uložit kampaň' })).not.toBeInTheDocument();
    expect(screen.getByText('Letní výprodej začíná')).toBeInTheDocument();
    // Rozjetou kampaň zpátky k úpravám nedostaneš, tlačítko by lhalo.
    expect(screen.queryByTestId('unschedule')).not.toBeInTheDocument();
  });

  it('naplánované kampani nabídne zrušení plánu, jinak je zámek slepá ulička', async () => {
    renderForm({ status: 'scheduled' }, undefined, false);

    const button = screen.getByTestId('unschedule');
    expect(button).toHaveTextContent('Zrušit plán a upravit');

    await userEvent.click(button);

    await waitFor(() => expect(unschedule).toHaveBeenCalledTimes(1));
    expect(unschedule).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' });
  });

  it('neúspěch zrušení plánu nespolkne', async () => {
    unschedule.mockResolvedValueOnce({ status: 'error', code: 'invalid_state_transition' });
    renderForm({ status: 'scheduled' }, undefined, false);

    await userEvent.click(screen.getByTestId('unschedule'));

    await waitFor(() => expect(screen.getByTestId('unschedule-failed')).toBeInTheDocument());
  });

  /**
   * Výčet stavů je OTEVŘENÝ (část 4a, 4.1.1). Neznámý stav se musí ukázat
   * neutrálně, nikdy kvůli němu obrazovka nespadne ani nezahodí odpověď.
   */
  it('neznámý stav neshodí obrazovku, jen ji zamkne', () => {
    renderForm({ status: 'nejaky_novy_stav', subject: 'Letní výprodej začíná' }, undefined, false);

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(screen.getByText('Letní výprodej začíná')).toBeInTheDocument();
    expect(screen.queryByTestId('unschedule')).not.toBeInTheDocument();
  });
});

/**
 * Kroky kampaně. Vada, kterou to léčí, zněla doslova: „Tvořím kampaň. Odejdu
 * z ní, že ji dodělám, ale už nemám jak se vrátit na krok 1, abych upravil text
 * newsletteru. Prostě mě to hodí vždy na krok 2/2."
 *
 * Kroky proto NEJSOU jednorázový průvodce. Otevřená kampaň začíná obsahem,
 * mezi kroky se chodí oběma směry a nic se přitom neztratí.
 */
describe('kroky kampaně', () => {
  /**
   * Krok 1 je EDITOR na vlastní adrese, ne panel tohohle formuláře. Tenhle
   * formulář proto nese kroky 2 a 3 a otevírá se předmětem; na krok 1 se
   * z něj odchází směrovačem.
   */
  it('otevírá formulář krokem předmětu, protože krok obsahu je editor', () => {
    renderForm({ template_id: 'work-1' });

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 2 z 3');
    expect(screen.getByTestId('campaign-step-basics')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('Předmět')).toBeVisible();
  });

  it('z kroku obsahu dělá cestu do editoru, ne panel formuláře', async () => {
    renderForm({ template_id: 'work-1' });

    await goToStep('content');

    expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-1/content');
  });

  /**
   * Editor je jiná adresa, takže odchod formulář odmontuje i s tím, co do něj
   * uživatel napsal. Ptát se ale musí jen tehdy, když je o co přijít: dialog
   * u čistého formuláře je klikání navíc, na které si člověk zvykne odpovídat
   * bez čtení.
   */
  it('s rozepsanými hodnotami se na odchod do editoru nejdřív zeptá', async () => {
    renderForm({ template_id: 'work-1' });

    await userEvent.type(screen.getByLabelText('Předmět'), 'Letní výprodej začíná');
    await goToStep('content');

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Odejít do editoru bez uložení?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Odejít bez uložení' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-1/content'));
  });

  it('respektuje krok z adresy, aby odkaz na nastavení skončil v nastavení', () => {
    renderWithProviders(
      <CampaignSettingsForm
        action={async () => IDLE}
        workspaceId="ws-1"
        campaign={CAMPAIGN}
        options={OPTIONS}
        canEdit
        basePath="/w/kolo-shop"
        initialStep="settings"
      />,
    );

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 3 z 3');
    expect(screen.getByLabelText('Odesílací účet')).toBeInTheDocument();
  });

  it('pustí mezi kroky oběma směry, kolikrát je potřeba', async () => {
    renderForm();

    await goToStep('settings');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 3 z 3');
    expect(screen.getByTestId('campaign-step-settings')).toHaveAttribute('aria-current', 'step');
    // Krok předmětu není vidět, ale ZŮSTÁVÁ v dokumentu: jinak by se s ním
    // ztratilo, co do něj uživatel napsal a neuložil.
    expect(screen.getByLabelText('Předmět')).not.toBeVisible();

    await goToStep('basics');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 2 z 3');
    expect(screen.getByLabelText('Předmět')).toBeVisible();
  });

  /**
   * Přepínač kroků je rozcestník, ne návod, kudy se pokračuje. Bez tlačítka
   * „Pokračovat" končí každý krok slepě u „Uložit" a uživatel musí uhodnout,
   * že se má vrátit nahoru na záložku dalšího kroku.
   */
  it('nabízí cestu vpřed jedním kliknutím a v posledním kroku už ne', async () => {
    renderForm();

    expect(screen.getByTestId('step-next')).toHaveTextContent('Pokračovat: Nastavení a odeslání');
    await userEvent.click(screen.getByTestId('step-next'));

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 3 z 3');
    expect(screen.queryByTestId('step-next')).not.toBeInTheDocument();
  });

  /**
   * Tlačítko „Pokračovat" jen přepíná krok. Kdyby formulář odeslalo, uložilo by
   * kampaň při každém průchodu průvodcem a rozepsaná kampaň bez publika by
   * skončila u chybové hlášky, přestože uživatel jen listuje kroky.
   */
  it('cesta vpřed formulář neodesílá', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({}, action);

    await userEvent.click(screen.getByTestId('step-next'));

    expect(action).not.toHaveBeenCalled();
  });

  /**
   * Regrese na ztrátu rozdělané práce. Kroky jsou dva panely JEDNOHO formuláře,
   * takže skrytý krok zůstává v dokumentu i s tím, co do něj uživatel napsal.
   * Kdyby se kroky přepínaly přechodem na jinou adresu, tenhle text by zmizel.
   */
  it('přepnutí kroku nezahodí neuložené hodnoty', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({}, action);

    await userEvent.type(screen.getByLabelText('Předmět'), 'Letní výprodej začíná');
    await goToStep('settings');
    await userEvent.type(screen.getByLabelText('Jméno odesílatele'), 'Kolo shop');
    await goToStep('basics');

    expect(screen.getByLabelText('Předmět')).toHaveValue('Letní výprodej začíná');

    // A obojí se opravdu odešle, ne jen zůstane na obrazovce.
    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get('subject')).toBe('Letní výprodej začíná');
    expect(formData.get('from_name')).toBe('Kolo shop');
  });

  /**
   * Uložení posílá oba kroky najednou, takže chyba může přistát v tom, který
   * zrovna není vidět. Formulář beze změny a bez hlášky by vypadal, že se
   * uložilo.
   */
  it('chybu z druhého kroku ukáže tím, že na ten krok přepne', async () => {
    const problem: Problem = {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/campaigns/camp-1',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'audience', code: 'required', message: 'Vyberte alespoň jeden seznam.' }],
    };
    renderForm({}, async () => failed('inline', problem));

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 2 z 3');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 3 z 3'));
    expect(screen.getByText('Vyberte alespoň jeden seznam.')).toBeInTheDocument();
  });

  /** Chyba předmětu patří do kroku předmětu, ne do kroku obsahu ani nastavení. */
  it('chybu předmětu ukáže přepnutím na krok předmětu', async () => {
    const problem: Problem = {
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: '',
      instance: '/api/v1/campaigns/camp-1',
      code: 'validation_failed',
      request_id: '',
      errors: [{ path: 'subject', code: 'required', message: 'Zadejte předmět.' }],
    };
    renderForm({}, async () => failed('inline', problem));

    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Krok 2 z 3'));
    expect(screen.getByLabelText('Předmět')).toBeVisible();
  });

  it('rozjeté kampani kroky nenabízí, tam se nic nezakládá', () => {
    renderForm({ status: 'sent' }, undefined, false);

    expect(screen.queryByTestId('campaign-step-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-step-basics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-step-settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Krok 1 z 3')).not.toBeInTheDocument();
  });
});

/**
 * Stav obsahu na obrazovce kroků 2 a 3.
 *
 * Obsah se tvoří v kroku 1, tedy v editoru, jenže kdo je v kroku 2 nebo 3, do
 * editoru se nedívá. Vada z instalace: kampaň, jejíž dokument neobsahoval nic
 * než patičku, prošla celým zakládáním bez poznámky a odešla na tři adresy.
 * Tři stavy, tři různé rady.
 */
describe('stav obsahu kampaně', () => {
  it('u kampaně bez obsahu řekne, že obsah ještě nevznikl', () => {
    renderForm({ template_id: null });

    expect(screen.getByTestId('content-missing')).toHaveTextContent('nemá obsah');
  });

  it('u dokumentu, ve kterém není nic než patička, varuje', () => {
    renderForm({ template_id: 'work-1', has_design: true, has_content: false });

    const warning = screen.getByTestId('content-empty');
    expect(warning).toHaveTextContent('Tenhle e-mail je zatím prázdný');
    expect(warning).toHaveAttribute('data-tone', 'warning');
  });

  it('u dokumentu s obsahem žádné varování není', () => {
    renderForm({ template_id: 'work-1', has_design: true, has_content: true });

    expect(screen.queryByTestId('content-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-not-applied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-missing')).not.toBeInTheDocument();
  });

  it('rozdělaný obsah, který v kampani ještě není, se hlásí jinak než prázdný', () => {
    renderForm({ template_id: 'work-1', has_design: false, has_content: false });

    expect(screen.getByTestId('content-not-applied')).toBeInTheDocument();
    expect(screen.queryByTestId('content-empty')).not.toBeInTheDocument();
  });
});

describe('mazání kampaně z detailu', () => {
  it('rozepsané kampani nabídne tlačítko a potvrzení opravdu volá akci', async () => {
    renderForm({ status: 'draft' });

    // Mazání patří do kroku nastavení, ne vedle rozepsaného e-mailu.
    await goToStep('settings');
    await userEvent.click(screen.getByTestId('delete-campaign'));
    await userEvent.click(screen.getByTestId('delete-campaign-submit'));

    await waitFor(() =>
      expect(deleteCampaign).toHaveBeenCalledWith({ workspaceId: 'ws-1', campaignId: 'camp-1' }),
    );
  });

  it('u odeslané kampaně místo tlačítka vysvětlí, proč to nejde', () => {
    renderForm({ status: 'sent' }, undefined, false);

    expect(screen.queryByTestId('delete-campaign')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-campaign-blocked')).toHaveTextContent(
      'Drží historii a statistiky',
    );
  });

  it('u naplánované kampaně poradí zrušit plán, ne obecné „nejde to"', () => {
    renderForm({ status: 'scheduled' }, undefined, false);

    expect(screen.getByTestId('delete-campaign-blocked')).toHaveTextContent('Zrušte plán');
  });
});

/**
 * Výběr uloženého odesílatele v kroku „Nastavení a odeslání".
 *
 * Vada, kterou to léčí, zněla doslova: „krok 3 v kampani, není možné zvolit
 * předdefinovaného odesílatele". Komponenta na to v repozitáři byla, jen ji
 * nikdo nezapojil do formuláře, takže se uživatel díval na tři prázdná pole
 * a jméno s adresou opisoval u každé kampaně znovu.
 */
describe('uložený odesílatel v nastavení kampaně', () => {
  it('u kampaně z výchozí předvolby je seznam vybraný a pole vyplněná', async () => {
    renderForm({
      sender_identity_id: DEFAULT_IDENTITY.id,
      from_name: DEFAULT_IDENTITY.from_name,
      from_email: DEFAULT_IDENTITY.from_email,
      reply_to: DEFAULT_IDENTITY.reply_to,
      provider_id: DEFAULT_IDENTITY.provider_id,
      sender_domain_id: DEFAULT_IDENTITY.sender_domain_id,
    });
    await goToStep('settings');

    expect(screen.getByRole('combobox', { name: 'Uložený odesílatel' })).toHaveTextContent(
      'Newsletter Kolo shop',
    );
    expect(screen.getByLabelText('Jméno odesílatele')).toHaveValue('Kolo shop');
    expect(screen.getByLabelText('E-mail odesílatele')).toHaveValue('newsletter@kolo-shop.cz');
    expect(screen.getByLabelText('Adresa pro odpovědi')).toHaveValue('odpovedi@kolo-shop.cz');
  });

  it('výběr jiné předvolby uloží kampani všech pět hodnot', async () => {
    renderForm({ sender_identity_id: DEFAULT_IDENTITY.id });
    await goToStep('settings');

    await userEvent.click(screen.getByRole('combobox', { name: 'Uložený odesílatel' }));
    // Uvnitř `<form>` vykreslí Radix ke svému seznamu ještě skryté nativní
    // `<select>`, takže text „Fakturace" je v dokumentu dvakrát. Role míří
    // na tu položku, na kterou uživatel opravdu klikne.
    await userEvent.click(screen.getByRole('option', { name: 'Fakturace' }));

    await waitFor(() => expect(applySender).toHaveBeenCalledTimes(1));
    expect(applySender.mock.calls[0]![0]).toEqual({
      workspaceId: 'ws-1',
      campaignId: 'camp-1',
      identity: {
        id: 'sid-2',
        from_name: 'Kolo shop fakturace',
        from_email: 'faktury@kolo-shop.cz',
        reply_to: null,
        provider_id: 'prov-1',
        sender_domain_id: 'dom-1',
      },
    });
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * REGRESE NA LŽOUCÍ OBRAZOVKU. Pole odesílatele jsou neřízená, takže je
   * `router.refresh()` po výběru předvolby sám nepřemountuje: v poli by zůstalo
   * viset to, co do něj uživatel napsal, přestože v databázi už je hodnota
   * z předvolby. Uživatel by pak uložil něco jiného, než co má před očima.
   */
  it('po výběru předvolby se pole srovnají s uloženými hodnotami, i když do nich uživatel psal', async () => {
    const { rerender } = renderForm({ sender_identity_id: null });
    await goToStep('settings');
    await userEvent.type(screen.getByLabelText('Jméno odesílatele'), 'Ručně napsané');

    rerender(
      withProviders(
        <CampaignSettingsForm
          action={async () => IDLE}
          workspaceId="ws-1"
          campaign={{
            ...CAMPAIGN,
            sender_identity_id: DEFAULT_IDENTITY.id,
            from_name: DEFAULT_IDENTITY.from_name,
            from_email: DEFAULT_IDENTITY.from_email,
            reply_to: DEFAULT_IDENTITY.reply_to,
          }}
          options={OPTIONS}
          canEdit
          basePath="/w/kolo-shop"
          initialStep="settings"
        />,
      ),
    );

    expect(
      screen.getByLabelText('Jméno odesílatele'),
      'pole zůstalo na ručně napsané hodnotě, takže obrazovka ukazuje něco jiného, než co je uložené',
    ).toHaveValue('Kolo shop');
    expect(screen.getByLabelText('E-mail odesílatele')).toHaveValue('newsletter@kolo-shop.cz');
  });

  /** Odkaz na předvolbu i otisky jedou s formulářem, jinak si je akce nemá kde vzít. */
  it('posílá serverové akci odkaz na předvolbu i otisky všech předvoleb', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({ sender_identity_id: DEFAULT_IDENTITY.id }, action);

    await goToStep('settings');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Newsletter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get('sender_identity_id')).toBe('sid-1');
    expect(JSON.parse(String(formData.get('sender_identity_options')))).toHaveLength(2);
  });

  /**
   * Prázdný rozbalovací seznam bez vysvětlení je horší než žádný. Projekt bez
   * jediné předvolby proto dostane větu s cestou tam, kde předvolby vznikají.
   */
  it('bez jediné předvolby ukáže, co má uživatel udělat, a kam jít', async () => {
    renderForm({}, undefined, true, { ...OPTIONS, senderIdentities: [] });
    await goToStep('settings');

    expect(screen.queryByRole('combobox', { name: 'Uložený odesílatel' })).not.toBeInTheDocument();
    const empty = screen.getByTestId('sender-picker-empty');
    expect(empty).toHaveTextContent('Zatím nemáte uloženého žádného odesílatele');
    expect(screen.getByRole('link', { name: 'Přidat odesílatele' })).toHaveAttribute(
      'href',
      '/w/kolo-shop/settings/senders',
    );
  });

  it('u zamčené kampaně se odesílatel nevybírá, ta se needituje', () => {
    renderForm({ status: 'scheduled', sender_identity_id: DEFAULT_IDENTITY.id }, undefined, false);

    expect(screen.queryByRole('combobox', { name: 'Uložený odesílatel' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('sender-picker')).not.toBeInTheDocument();
  });
});

/**
 * Rozsah odhlášení v kroku „Nastavení a odeslání".
 *
 * Vada, kterou to léčí, zněla doslova: „Nechápu funkci toho, pro co je Seznam
 * pro odhlášení. Je to trochu matoucí položka." Ptala se na něco, co z publika
 * jednoznačně plyne, a špatná odpověď rozbíjela odhlašovací odkaz: odhlášení ze
 * seznamu je v jádru `UPDATE ... WHERE list_id = ?`, takže komu ten seznam
 * nesedí, tomu kliknutí nezmění ani řádek.
 */
describe('rozsah odhlášení', () => {
  /** Hodnota, kterou formulář o rozsahu opravdu odešle. */
  function submittedScope(): string | null {
    const field = document.querySelector<HTMLInputElement>('[name=unsubscribe_list_id]');
    return field === null ? null : field.value;
  }

  it('u kampaně na jediný seznam se neptá, ale řekne, co odkaz udělá', async () => {
    renderForm({ include_lists: ['list-1'] });
    await goToStep('settings');

    expect(
      screen.queryByRole('combobox', { name: 'Seznam pro odhlášení' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('unsubscribe-derived')).toHaveTextContent(
      'zmizí ze seznamu Newsletter',
    );
    // A ta věta není jen text: přesně tahle hodnota jde do databáze.
    expect(submittedScope()).toBe('list-1');
  });

  it('u kampaně na víc seznamů odhlašuje ze všeho a napíše proč', async () => {
    renderForm({ include_lists: ['list-1', 'list-2'] });
    await goToStep('settings');

    const field = screen.getByTestId('unsubscribe-derived');
    expect(field).toHaveTextContent('přestane od vás dostávat všechno');
    expect(field).toHaveTextContent('jedním odkazem se ze tří najednou odhlásit nedá');
    expect(submittedScope()).toBe('__none__');
  });

  it('se segmentem v publiku volbu nabídne, tam odvodit není z čeho', async () => {
    renderForm({ include_segments: ['seg-1'] });
    await goToStep('settings');

    expect(screen.getByRole('combobox', { name: 'Seznam pro odhlášení' })).toHaveTextContent(
      'Ze všech rozesílek',
    );
    expect(screen.getByTestId('unsubscribe-choice')).toHaveTextContent(
      'klikne na odhlášení a nestane se nic',
    );
  });

  /** Smíšené publikum je volba, ne odvození: lidé ze segmentu na tom seznamu být nemusí. */
  it('u seznamu i segmentu naráz nabídne volbu, ne odvozený seznam', async () => {
    renderForm({ include_lists: ['list-1'], include_segments: ['seg-1'] });
    await goToStep('settings');

    expect(screen.getByTestId('unsubscribe-choice')).toBeInTheDocument();
    expect(screen.queryByTestId('unsubscribe-derived')).not.toBeInTheDocument();
  });

  /**
   * REGRESE NA POLE, KTERÉ NESLEDUJE PUBLIKUM. Zaškrtávátka publika jsou
   * neřízená, takže bez ozvěny do stavu by se rozsah přepočítal až po uložení
   * a uživatel by mezitím četl větu, která pro jeho publikum neplatí.
   */
  it('reaguje na změnu publika hned, ne až po uložení', async () => {
    renderForm({ include_lists: ['list-1'] });
    await goToStep('settings');
    expect(submittedScope()).toBe('list-1');

    // Druhý seznam v publiku: jedním odkazem se ze dvou odhlásit nedá.
    await userEvent.click(
      within(screen.getByTestId('audience-include')).getByRole('checkbox', { name: 'VIP' }),
    );
    expect(screen.getByTestId('unsubscribe-derived')).toHaveTextContent(
      'přestane od vás dostávat všechno',
    );
    expect(submittedScope()).toBe('__none__');

    // A segment z něj udělá volbu.
    await userEvent.click(
      within(screen.getByTestId('audience-include')).getByRole('checkbox', {
        name: 'Aktivní zákazníci',
      }),
    );
    expect(screen.getByTestId('unsubscribe-choice')).toBeInTheDocument();
  });

  /**
   * Tichá změna uložené hodnoty se nedělá. Kdo si kdysi vybral konkrétní seznam
   * a od té doby přidal do publika další, se to musí dozvědět dřív než
   * z chování odkazu v odeslaném e-mailu.
   */
  it('upozorní, že uložený seznam přestal platit', async () => {
    renderForm({ include_lists: ['list-1', 'list-2'], unsubscribe_list_id: 'list-1' });
    await goToStep('settings');

    expect(screen.getByTestId('unsubscribe-changed')).toHaveTextContent(
      'odhlášení ze seznamu Newsletter',
    );
  });

  it('u kampaně, které se rozsah nemění, žádné upozornění není', async () => {
    renderForm({ include_lists: ['list-1'], unsubscribe_list_id: 'list-1' });
    await goToStep('settings');

    expect(screen.queryByTestId('unsubscribe-changed')).not.toBeInTheDocument();
  });

  /** Odvozená hodnota musí dojet až do serverové akce, ne jen na obrazovku. */
  it('posílá odvozený rozsah serverové akci', async () => {
    const action = vi.fn(async (_previous: ActionState, _formData: FormData) => IDLE);
    renderForm({ include_lists: ['list-1'] }, action);

    await goToStep('settings');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit kampaň' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]![1].get('unsubscribe_list_id')).toBe('list-1');
  });
});

/**
 * JMÉNO KAMPANĚ V KROKU 2. Dřív to bylo pole uvnitř formuláře a ukládalo se
 * hromadnou akcí, takže u čerstvé kampaně nešlo uložit vůbec: validace spadla
 * na prázdném předmětu a prázdném publiku, tedy na věcech, se kterými
 * přejmenování nesouvisí. Teď je jméno v hlavičce a má vlastní akci.
 */
describe('přejmenování kampaně v kroku 2', () => {
  it('formulář jméno nenese, hlavička ho nabízí k úpravě', async () => {
    renderForm();
    await goToStep('basics');

    expect(document.querySelector('input[name=name]')).toBeNull();
    expect(screen.getByTestId('campaign-name-input')).toHaveValue('Letní výprodej');
  });

  it('uloží jméno i u kampaně bez předmětu a bez publika', async () => {
    const save = vi.fn(async () => IDLE);
    renderForm({ subject: '', include_lists: [], include_segments: [] }, save);

    const field = screen.getByTestId('campaign-name-input');
    await userEvent.clear(field);
    await userEvent.type(field, 'Podzimní novinky');
    await userEvent.tab();

    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        campaignId: 'camp-1',
        name: 'Podzimní novinky',
      }),
    );
    // Hromadné uložení se přitom vůbec nespustilo, takže ho nemá co shodit.
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByTestId('campaign-name-error')).toBeNull();
  });

  /**
   * ZAMČENÁ KAMPAŇ SE PŘEJMENOVAT SMÍ, A KROK 2 TO MUSÍ NABÍDNOUT.
   *
   * Rozhoduje `canRenameCampaign`, ne `canEdit`. Naplánovaná kampaň má obsah
   * zamčený (`canEdit` je `false`), ale `PATCH /campaigns/{id}` u ní `name`
   * pouští, a krok 1 pole nabízí. Kdyby ho krok 2 nenabídl, lišily by se dvě
   * obrazovky téže kampaně v tom, co se na nich dá udělat.
   */
  it('naplánovaná kampaň má pole pro jméno, i když je obsah zamčený', async () => {
    renderForm({ status: 'scheduled' }, undefined, false);

    const field = screen.getByTestId('campaign-name-input');
    expect(field).toHaveValue('Letní výprodej');
    expect(field).not.toBeDisabled();
    // Holý text místo pole by znamenal, že se přejmenovat nedá.
    expect(screen.queryByTestId('campaign-name-readonly')).toBeNull();
  });

  /**
   * A DRUHÁ STRANA: u stavu, kde přejmenovat NEJDE, se pole nesmí nabídnout.
   * Pole, které při odchodu z něj vyhodí `campaign_locked`, je horší než
   * nadpis, o kterém je na první pohled vidět, že se upravit nedá.
   */
  it('u odesílající se kampaně je jméno holý text, ne pole', () => {
    renderForm({ status: 'sending' }, undefined, false);

    expect(screen.getByTestId('campaign-name-readonly')).toHaveTextContent('Letní výprodej');
    expect(screen.queryByTestId('campaign-name-input')).toBeNull();
  });

  it('nové jméno se hned propíše do drobečků', async () => {
    renderForm();

    const field = screen.getByTestId('campaign-name-input');
    await userEvent.clear(field);
    await userEvent.type(field, 'Podzimní novinky');
    await userEvent.tab();

    await waitFor(() => expect(rename).toHaveBeenCalled());
    expect(screen.getByRole('navigation', { name: 'Drobečková navigace' })).toHaveTextContent(
      'Podzimní novinky',
    );
  });
});
