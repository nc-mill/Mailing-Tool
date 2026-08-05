import { screen, waitFor } from '@testing-library/react';
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
  lists: [{ id: 'l-1', name: 'Zákazníci', selected: true }],
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
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Uložit změny' }));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('attr:points')).toBe('10');
    expect(submitted!.get('attrtype:points')).toBe('number');
  });

  /**
   * Bez `list_before` by akce nepoznala rozdíl mezi „uživatel seznam odškrtl" a „nikdy
   * v něm nebyl", takže by kontakt odhlašovala ze seznamů, do kterých nikdy nepatřil.
   */
  it('nese stav seznamů z doby vykreslení, aby šlo poznat, co uživatel odškrtl', async () => {
    const user = userEvent.setup();
    renderForm({
      lists: [
        { id: 'l-1', name: 'Zákazníci', selected: true },
        { id: 'l-2', name: 'Novinky', selected: false },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Uložit změny' }));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.getAll('list_before')).toEqual(['l-1']);
    expect(submitted!.getAll('list')).toEqual(['l-1']);
  });

  it('u úpravy říká, že zaškrtnutí seznamu pošle kontaktu potvrzovací e-mail', () => {
    renderForm();
    expect(screen.getByText(/pošleme kontaktu potvrzovací e-mail/)).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Založit kontakt' }));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('subscription')).toBe('confirmed');
  });

  it('u založení umí správce zvolit nepotvrzený kontakt', async () => {
    const user = userEvent.setup();
    renderForm(EMPTY, 'create');

    await user.click(screen.getByRole('radio', { name: /Nepotvrzeného/ }));
    expect(screen.getByText(/do rozesílek se nedostane/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Založit kontakt' }));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.get('subscription')).toBe('pending');
  });

  /** Volba mění i to, co se stane se zaškrtnutými seznamy, a musí to být vidět předem. */
  it('věta u seznamů se řídí zvolenou variantou', async () => {
    const user = userEvent.setup();
    renderForm({ ...EMPTY, lists: [{ id: 'l-1', name: 'Novinky', selected: false }] }, 'create');

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
    await user.click(screen.getByRole('button', { name: 'Založit kontakt' }));
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
    await user.click(screen.getByRole('button', { name: 'Založit kontakt' }));

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText('Město neznáme.')).toBeInTheDocument();
  });

  it('chybu ve schované části nejde schovat zpátky', async () => {
    const user = userEvent.setup();
    renderForm(EMPTY, 'create');

    nextState = validationFailure('title_prefix', 'Titul je moc dlouhý.');
    await user.click(screen.getByRole('button', { name: 'Založit kontakt' }));

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
