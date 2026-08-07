import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactForm, type ContactFormValues } from './contact-form';
import { failed, type ActionState } from '@/lib/feedback/action-result';
import { renderWithProviders } from './test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const previewGreetingAction = vi.fn();

vi.mock('./edit-actions', () => ({
  previewGreetingAction: (input: unknown) => previewGreetingAction(input),
}));

/**
 * Radix `Checkbox` uvnitř `<form>` vykreslí skryté pole a měří ho přes `ResizeObserver`,
 * který jsdom nemá. Prázdná náhrada stačí: měření jen dorovnává velikost, na chování
 * formuláře nemá vliv.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const values: ContactFormValues = {
  id: 'c-1',
  email: 'jana@firma.cz',
  first_name: 'Jana',
  last_name: 'Nováková',
  title_prefix: '',
  title_suffix: '',
  gender: 'female',
  greeting: 'Jano',
  greeting_locked: false,
  fields: [{ key: 'city', label: 'Město', type: 'text', value: 'Brno' }],
  tags: [{ name: 'Brno', selected: true }],
  lists: [{ id: 'l-1', name: 'Zákazníci', selected: true, double_opt_in: true }],
};

/** Zachytí FormData, se kterou se formulář odeslal, aby šlo tvrdit o obsahu, ne o klikání. */
let submitted: FormData | null = null;

/**
 * Odpověď akce, kterou formulář dostane po odeslání. Ve výchozím stavu `idle`;
 * testy na chyby si sem podstrčí `error`, protože jinak než přes návratovou hodnotu
 * akce se `fieldErrors` do formuláře nedostane.
 */
let nextState: ActionState = { status: 'idle' };

/** Chyba validace u jednoho pole, ve tvaru, jaký vyrábí `failed()` z odpovědi serveru. */
function validationFailure(path: string, message: string): ActionState {
  return failed('inlineBlock', {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance: '/api/v1/contacts',
    code: 'validation_failed',
    request_id: '',
    errors: [{ path, code: 'invalid_value', message }],
  });
}

function renderForm(overrides: Partial<ContactFormValues> = {}, mode: 'create' | 'edit' = 'edit') {
  submitted = null;
  nextState = { status: 'idle' };
  return renderWithProviders(
    <ContactForm
      mode={mode}
      action={async (_previous, formData) => {
        submitted = formData;
        return nextState;
      }}
      workspaceId="w-1"
      workspaceSlug="eshop"
      basePath="/w/eshop/contacts"
      values={{ ...values, ...overrides }}
    />,
  );
}

/** Prázdný kontakt, tedy to, co formulář dostane na obrazovce založení. */
const EMPTY: Partial<ContactFormValues> = {
  id: null,
  email: '',
  first_name: '',
  last_name: '',
  title_prefix: '',
  title_suffix: '',
  gender: 'unknown',
  greeting: null,
  fields: [],
  tags: [],
  lists: [],
};

beforeEach(() => {
  previewGreetingAction.mockReset();
  previewGreetingAction.mockResolvedValue({
    greeting: 'Jano',
    vocative_confidence: 'high',
    gender: 'female',
  });
});

describe('ContactForm', () => {
  it('u úpravy nedovolí přepsat adresu v hlavním formuláři a nabídne vlastní cestu', () => {
    renderForm();
    expect(screen.queryByRole('textbox', { name: 'E-mail' })).toBeNull();
    // Adresa je na obrazovce dvakrát: v meta řádku pod nadpisem a jako hodnota
    // v kartě „Kdo to je". Obojí má návrh.
    expect(screen.getAllByText('jana@firma.cz').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Změnit adresu' })).toHaveAttribute(
      'href',
      '/w/eshop/contacts/c-1/email',
    );
  });

  it('u založení je adresa pole a je vidět, co se stane s existující adresou', () => {
    renderForm({ id: null, email: '' }, 'create');
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByText(/doplníme údaje k existujícímu kontaktu/)).toBeInTheDocument();
  });

  /**
   * Jádro téhle obrazovky. Produkt stojí na pátém pádu, takže se náhled musí přepočítat
   * po změně jména, a musí ho počítat SERVER: skloňování stojí na slovníku a na přepisech
   * projektu, které v prohlížeči nejsou.
   */
  it('po změně jména si vyžádá nový náhled oslovení a ukáže ho', async () => {
    const user = userEvent.setup();
    renderForm();

    previewGreetingAction.mockResolvedValue({
      greeting: 'Ondřeji',
      vocative_confidence: 'high',
      gender: 'male',
    });

    const firstName = screen.getByLabelText('Křestní jméno');
    await user.clear(firstName);
    await user.type(firstName, 'Ondřej');

    await waitFor(
      () => {
        expect(previewGreetingAction).toHaveBeenCalledWith(
          expect.objectContaining({ first_name: 'Ondřej', workspaceId: 'w-1' }),
        );
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText('V e-mailu bude: Ondřeji')).toBeInTheDocument();
  });

  it('u nejistého skloňování to řekne slovem, ne jen tichým uložením', async () => {
    previewGreetingAction.mockResolvedValue({
      greeting: 'Dobrý den',
      vocative_confidence: 'low',
      gender: 'unknown',
    });
    renderForm();

    expect(
      await screen.findByText(/Tímhle jménem si nejsme jistí/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('zamčené oslovení vysvětlí, za jakých okolností se přepočítá', () => {
    renderForm({ greeting_locked: true });
    expect(screen.getByText(/Oslovení potvrdil člověk/)).toBeInTheDocument();
  });

  /**
   * Typ vlastního pole jde na server ve skrytém poli. Bez něj by se číslo uložilo jako
   * text a segment s podmínkou nad číslem by kontakt přestal najít, aniž by cokoliv spadlo.
   */
  it('posílá typ vlastního pole vedle jeho hodnoty', async () => {
    const user = userEvent.setup();
    renderForm({ fields: [{ key: 'points', label: 'Body', type: 'number', value: '10' }] });

    // Tlačítko je na obrazovce dvakrát, v hlavičce i pod formulářem, tak jak to
    // má návrh. Klikáme na to v hlavičce.
    await user.click(screen.getAllByRole('button', { name: 'Uložit změny' })[0]!);

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('attr:points')).toBe('10');
    expect(submitted!.get('attrtype:points')).toBe('number');
  });

  /**
   * Pole typu ano/ne se do teď zadávalo do řádku na text a uložilo se `true` jen tehdy,
   * když do něj uživatel napsal doslova „true", „on" nebo „1". Česky napsané „ano"
   * se uložilo jako NE, a to tiše.
   */
  it('u pole typu ano/ne nabízí výběr, ne psaní', async () => {
    const user = userEvent.setup();
    renderForm({ fields: [{ key: 'vip', label: 'VIP', type: 'boolean', value: '' }] });

    const select = screen.getByRole('combobox', { name: 'VIP' });
    // Tři volby, ne dvě: nevyplněno není totéž co „ne".
    expect(within(select).getByRole('option', { name: 'Nevyplněno' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Ano' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Ne' })).toBeInTheDocument();

    await user.selectOptions(select, 'true');
    await user.click(screen.getAllByRole('button', { name: 'Uložit změny' })[0]!);

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('attr:vip')).toBe('true');
    expect(submitted!.get('attrtype:vip')).toBe('boolean');
  });

  /**
   * Bez `list_before` by akce nepoznala rozdíl mezi „uživatel seznam odškrtl" a „nikdy
   * v něm nebyl", takže by kontakt odhlašovala ze seznamů, do kterých nikdy nepatřil.
   */
  it('nese stav seznamů z doby vykreslení, aby šlo poznat, co uživatel odškrtl', async () => {
    const user = userEvent.setup();
    renderForm({
      lists: [
        { id: 'l-1', name: 'Zákazníci', selected: true, double_opt_in: true },
        { id: 'l-2', name: 'Novinky', selected: false, double_opt_in: false },
      ],
    });

    // Tlačítko je na obrazovce dvakrát, v hlavičce i pod formulářem, tak jak to
    // má návrh. Klikáme na to v hlavičce.
    await user.click(screen.getAllByRole('button', { name: 'Uložit změny' })[0]!);

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.getAll('list_before')).toEqual(['l-1']);
    expect(submitted!.getAll('list')).toEqual(['l-1']);
  });

  /**
   * OPRAVA PROTI DŘÍVĚJŠÍMU ZNĚNÍ: věta slibovala potvrzovací e-mail u KAŽDÉHO
   * zaškrtnutého seznamu. Na seznamu s jedním krokem se ale kontakt přihlásí
   * rovnou a žádný potvrzovací e-mail neodejde, takže test hlídal lež.
   *
   * ZPŘÍSNĚNO 7. 8. 2026. Druhé znění vázalo potvrzení na dvojí potvrzení, jenže
   * ani to neplatí vždycky: kontakt s doloženým souhlasem se přihlásí rovnou
   * i tam. Trvalá věta proto o žádném konkrétním e-mailu nemluví a odkazuje na
   * hlášky pod seznamy, které se ukazují podle skutečného stavu.
   */
  it('trvalá věta u seznamů neslibuje konkrétní e-mail', () => {
    renderForm();
    expect(screen.getByText(/upozorníme na to pod seznamy/)).toBeVisible();
    expect(screen.queryByText(/Zaškrtnutím pošleme kontaktu potvrzovací e-mail/)).toBeNull();
    expect(screen.queryByText(/U seznamu s dvojím potvrzením se přihlásí až potom/)).toBeNull();
  });

  /**
   * ZADÁNÍ ZADAVATELE: „Když přidávám ručně kontakt, tak nemusí být ověřený. Je na mě
   * jako správci, jestli mám nebo nemám e-maily, které přidávám, ověřené."
   *
   * Výchozí hodnota je proto přihlášený, ne nepotvrzený. Ruční zadání dělá správce,
   * který adresu odněkud má.
   */
  it('u založení nabízí volbu stavu a ve výchozím stavu zakládá přihlášeného', async () => {
    const user = userEvent.setup();
    renderForm(EMPTY, 'create');

    const subscribed = screen.getByRole('radio', { name: /Přihlášeného k odběru/ });
    expect(subscribed).toBeChecked();
    // U volby musí být věta o tom, co to znamená pro odesílání.
    expect(screen.getByText(/rovnou v rozesílkách/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Založit kontakt' })[0]!);

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('subscription')).toBe('confirmed');
  });

  it('u založení umí správce zvolit nepotvrzený kontakt', async () => {
    const user = userEvent.setup();
    renderForm(EMPTY, 'create');

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));
    // Věta u volby musí říct, co se doopravdy stane. Od 5. 8. 2026 se na seznamu
    // s dvojím potvrzením potvrzovací e-mail SKUTEČNĚ pošle, takže se to slibuje
    // tady, ne až v historii kontaktu.
    expect(screen.getByText(/pošleme potvrzovací e-mail/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Založit kontakt' })[0]!);

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('subscription')).toBe('pending');
  });

  /** Volba mění i to, co se stane se zaškrtnutými seznamy, a musí to být vidět předem. */
  it('věta u seznamů se řídí zvolenou variantou', async () => {
    const user = userEvent.setup();
    renderForm(
      { ...EMPTY, lists: [{ id: 'l-1', name: 'Novinky', selected: false, double_opt_in: true }] },
      'create',
    );

    expect(screen.getByText(/rovnou přihlásíme/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));
    expect(screen.getByText(/zapíšeme jako nepotvrzeného/)).toBeInTheDocument();
  });

  /**
   * Jádro druhé poloviny zadání: „musím vyplnit milion údajů, než kontakt přidám".
   * Povinná je jediná věc, adresa, a to musí být vidět na první pohled.
   */
  it('u založení je zbytek údajů schovaný, ale odešle se i zavřený', async () => {
    const user = userEvent.setup();
    renderForm(
      { ...EMPTY, fields: [{ key: 'city', label: 'Město', type: 'text', value: '' }] },
      'create',
    );

    const toggle = screen.getByRole('button', { name: 'Další údaje' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // E-mail a jméno zůstávají nahoře, mimo schovanou část.
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Křestní jméno')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.type(screen.getByLabelText('Titul před jménem'), 'Ing.');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Zavřená část je pořád v DOM, takže se hodnota neztratí.
    await user.click(screen.getAllByRole('button', { name: 'Založit kontakt' })[0]!);
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('title_prefix')).toBe('Ing.');
  });

  /**
   * Bez tohohle by uživatel dostal hlášku „opravte formulář" a chybu by neviděl,
   * protože by byla ve schované části.
   */
  it('schovaná část se sama otevře, když je v ní chyba', async () => {
    const user = userEvent.setup();
    renderForm(
      { ...EMPTY, fields: [{ key: 'city', label: 'Město', type: 'text', value: '' }] },
      'create',
    );

    const toggle = screen.getByRole('button', { name: 'Další údaje' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    nextState = validationFailure('attributes.city', 'Město neznáme.');
    await user.click(screen.getAllByRole('button', { name: 'Založit kontakt' })[0]!);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText('Město neznáme.')).toBeInTheDocument();
  });

  it('chybu ve schované části nejde schovat zpátky', async () => {
    const user = userEvent.setup();
    renderForm(EMPTY, 'create');

    nextState = validationFailure('title_prefix', 'Titul je moc dlouhý.');
    await user.click(screen.getAllByRole('button', { name: 'Založit kontakt' })[0]!);

    const toggle = screen.getByRole('button', { name: 'Další údaje' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  /** Vyplněné údaje se neschovávají: uživatel by netušil, že tam něco je. */
  it('u založení s předvyplněnými dalšími údaji je část otevřená rovnou', () => {
    renderForm({ ...EMPTY, title_prefix: 'Ing.' }, 'create');
    expect(screen.getByRole('button', { name: 'Další údaje' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  /** U úpravy se nic neschovává, chodí se tam hlavně kvůli kontrole oslovení. */
  it('u úpravy zůstávají všechny údaje vidět bez rozbalování', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Další údaje' })).toBeNull();
    expect(screen.getByLabelText('Titul před jménem')).toBeInTheDocument();
    expect(screen.getByTestId('greeting-preview')).toBeInTheDocument();
  });
});

/**
 * PŘEDVYPLNĚNÝ SEZNAM. Výchozí seznam projektu je při zakládání zaškrtnutý za
 * uživatele (rozhodnutí zadavatele z 5. 8. 2026). Dva lidé si toho nezávisle na
 * sobě nevšimli a jedním uložením vyrobili odchozí potvrzovací e-mail. Prefill
 * zůstává, ale formulář se k němu přizná a odchozí zprávu ohlásí dřív, než odejde.
 */
describe('ContactForm a předvyplněný seznam', () => {
  const withDefaultList = (double: boolean) => ({
    ...EMPTY,
    lists: [
      { id: 'l-1', name: 'Odběratelé', selected: true, double_opt_in: double, is_default: true },
      { id: 'l-2', name: 'VIP', selected: false, double_opt_in: true },
    ],
  });

  it('u předvyplněného seznamu řekne, že ho zaškrtl formulář, ne uživatel', () => {
    renderForm(withDefaultList(true), 'create');
    // Štítek stojí u zaškrtávátka výchozího seznamu a právě jednou: u seznamu,
    // který výchozí není, nemá co dělat.
    const tags = screen.getAllByText(/výchozí seznam, zaškrtli jsme ho za vás/);
    expect(tags).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: /Odběratelé/ }).closest('label')).toContainElement(
      tags[0]!,
    );
  });

  it('u úpravy se štítek o předvyplnění neukazuje, tam nic předvyplněné není', () => {
    renderForm(withDefaultList(true), 'edit');
    expect(screen.queryByText(/výchozí seznam/)).toBeNull();
  });

  /**
   * Ve výchozím stavu („přihlášený") neodejde nic: `contacts-api.ts` zapisuje
   * takové přihlášení přímo, mimo `subscribeToList`. Slibovat e-mail, který
   * neodejde, by bylo stejně špatné jako mlčet o tom, který odejde.
   */
  it('u přihlášeného kontaktu žádnou zprávu neslibuje', () => {
    renderForm(withDefaultList(true), 'create');
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  it('u nepotvrzeného kontaktu ohlásí odchozí e-mail i s názvem seznamu', async () => {
    const user = userEvent.setup();
    renderForm(withDefaultList(true), 'create');

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));

    const warning = screen.getByTestId('confirmation-email-warning');
    expect(warning).toHaveTextContent(/odejde na adresu kontaktu potvrzovací e-mail/);
    expect(warning).toHaveTextContent('Odběratelé');
    // Jmenuje jen ty seznamy, kvůli kterým zpráva opravdu odejde.
    expect(warning).not.toHaveTextContent('VIP');
  });

  it('po odškrtnutí seznamu hláška o odchozím e-mailu zmizí', async () => {
    const user = userEvent.setup();
    renderForm(withDefaultList(true), 'create');

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));
    expect(screen.getByTestId('confirmation-email-warning')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Odběratelé/ }));
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  /** Seznam s jedním krokem se zapisuje přímo, takže z něj neodejde nic. */
  it('u seznamu bez dvojího potvrzení žádnou zprávu neslibuje ani u nepotvrzeného', async () => {
    const user = userEvent.setup();
    renderForm(withDefaultList(false), 'create');

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));

    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });
});

/**
 * ODCHOZÍ E-MAIL U ÚPRAVY. Formulář úpravy sliboval u každého zaškrtnutého
 * seznamu potvrzovací e-mail. Na seznamu s jedním krokem se ale kontakt
 * přihlásí rovnou (`state-machine.ts`: `optIn === 'single' && from === 'none'`
 * končí ve stavu `confirmed`) a místo potvrzovacího odejde UVÍTACÍ e-mail,
 * a to jedině tehdy, když ho seznam má zapnutý. Slíbený potvrzovací e-mail
 * nikdy nedorazil.
 */
describe('ContactForm u úpravy hlásí ten e-mail, který opravdu odejde', () => {
  const withLists = (lists: ContactFormValues['lists']) => ({ ...EMPTY, id: 'c-1', lists });

  it('u seznamu s jedním krokem a zapnutým uvítacím e-mailem slíbí uvítací, ne potvrzovací', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: false, double_opt_in: false, send_welcome: true },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    const warning = screen.getByTestId('welcome-email-warning');
    expect(warning).toHaveTextContent(/odejde mu uvítací e-mail/);
    expect(warning).toHaveTextContent('Novinky');
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  it('u seznamu s jedním krokem bez uvítacího e-mailu neslíbí nic', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: false, double_opt_in: false, send_welcome: false },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    expect(screen.queryByTestId('welcome-email-warning')).toBeNull();
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  it('u seznamu s dvojím potvrzením slíbí potvrzovací e-mail', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'VIP', selected: false, double_opt_in: true, send_welcome: true },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /VIP/ }));

    expect(screen.getByTestId('confirmation-email-warning')).toHaveTextContent(
      /odejde na adresu kontaktu potvrzovací e-mail/,
    );
    expect(screen.queryByTestId('welcome-email-warning')).toBeNull();
  });

  /** Návrat po odhlášení jde přes potvrzení i na seznamu s jedním krokem. */
  it('u odhlášeného kontaktu slíbí potvrzovací e-mail i na seznamu s jedním krokem', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        {
          id: 'l-1',
          name: 'Novinky',
          selected: false,
          double_opt_in: false,
          send_welcome: true,
          previously_unsubscribed: true,
        },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    expect(screen.getByTestId('confirmation-email-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-email-warning')).toBeNull();
  });

  /** Seznam, ve kterém kontakt už je, se uložením nemění a nic z něj neodejde. */
  it('u seznamu, ve kterém kontakt už je, neslibuje žádný e-mail', () => {
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: true, double_opt_in: false, send_welcome: true },
        { id: 'l-2', name: 'VIP', selected: true, double_opt_in: true, send_welcome: false },
      ]),
      'edit',
    );

    expect(screen.queryByTestId('welcome-email-warning')).toBeNull();
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  /**
   * DOLOŽENÝ SOUHLAS PŘESKAKUJE DVOJÍ POTVRZENÍ.
   *
   * `state-machine.ts` má nad větví pro dvojí potvrzení výjimku: s doloženým
   * souhlasem (`existingConsent`) končí kontakt rovnou ve stavu `confirmed`
   * s efektem `send_welcome`. A není to okrajový případ, spíš naopak: import,
   * veřejný formulář i zakládání přes API zapisují souhlas s rozsahem CELÉHO
   * PROJEKTU (`scopeListId: null`), takže dosáhne i na seznam, ve kterém
   * kontakt nikdy nebyl.
   *
   * Do 7. 8. 2026 tady formulář sliboval potvrzovací e-mail a příjemci přišel
   * uvítací. Rozhoduje o tom `pickEffectiveConsent` na stránce, tedy táž funkce,
   * kterou se ptá server.
   */
  it('u seznamu s dvojím potvrzením a doloženým souhlasem slíbí uvítací, ne potvrzovací', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        {
          id: 'l-1',
          name: 'VIP',
          selected: false,
          double_opt_in: true,
          send_welcome: true,
          has_effective_consent: true,
        },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /VIP/ }));

    expect(screen.getByTestId('welcome-email-warning')).toHaveTextContent('VIP');
    expect(screen.queryByTestId('confirmation-email-warning')).toBeNull();
  });

  /**
   * Odhlášení přebíjí i doložený souhlas: `from === 'unsubscribed'` se vrací
   * přes `pending`. Kdyby se pořadí podmínek ve formuláři obrátilo, slíbil by
   * uvítací e-mail tam, kde odejde potvrzovací.
   */
  it('u odhlášeného kontaktu slíbí potvrzovací i s doloženým souhlasem', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        {
          id: 'l-1',
          name: 'VIP',
          selected: false,
          double_opt_in: true,
          send_welcome: true,
          has_effective_consent: true,
          previously_unsubscribed: true,
        },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /VIP/ }));

    expect(screen.getByTestId('confirmation-email-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-email-warning')).toBeNull();
  });
});

/**
 * ODŠKRTNUTÍ SEZNAMU TAKY POSÍLÁ E-MAIL.
 *
 * Odškrtnutý seznam projde přes `DELETE /lists/{id}/subscribe`, tedy přes
 * `unsubscribe()`, a to pošle rozloučení, když ho seznam má zapnuté. Formulář
 * o tom mlčel, takže odchozí zprávu vyrobilo kliknutí, po kterém uživatel čekal
 * jen tichou úpravu záznamu.
 */
describe('ContactForm hlásí i rozloučení po odškrtnutí seznamu', () => {
  const withLists = (lists: ContactFormValues['lists']) => ({ ...EMPTY, id: 'c-1', lists });

  it('odškrtnutí seznamu se zapnutým rozloučením ohlásí odchozí e-mail i s názvem', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: true, double_opt_in: false, send_goodbye: true },
      ]),
      'edit',
    );
    expect(screen.queryByTestId('goodbye-email-warning')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    const warning = screen.getByTestId('goodbye-email-warning');
    expect(warning).toHaveTextContent(/odejde mu rozloučení/);
    expect(warning).toHaveTextContent('Novinky');
  });

  it('u seznamu s vypnutým rozloučením neslibuje nic', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: true, double_opt_in: false, send_goodbye: false },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    expect(screen.queryByTestId('goodbye-email-warning')).toBeNull();
  });

  /**
   * Zaškrtnout a zase odškrtnout seznam, ve kterém kontakt nebyl, neodhlašuje
   * nic. Bez podmínky na `selected` by hláška slíbila e-mail, který neodejde.
   */
  it('u seznamu, ve kterém kontakt nebyl, rozloučení neslibuje', async () => {
    const user = userEvent.setup();
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: false, double_opt_in: false, send_goodbye: true },
      ]),
      'edit',
    );

    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));
    await user.click(screen.getByRole('checkbox', { name: /Novinky/ }));

    expect(screen.queryByTestId('goodbye-email-warning')).toBeNull();
  });

  /** Založení nikoho odhlašovat nemůže, takže se hláška nesmí objevit ani omylem. */
  it('u založení se rozloučení neslibuje nikdy', () => {
    renderForm(
      withLists([
        { id: 'l-1', name: 'Novinky', selected: true, double_opt_in: false, send_goodbye: true },
      ]),
      'create',
    );

    expect(screen.queryByTestId('goodbye-email-warning')).toBeNull();
  });
});
