import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactForm, type ContactFormValues } from './contact-form';
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

function renderForm(overrides: Partial<ContactFormValues> = {}, mode: 'create' | 'edit' = 'edit') {
  submitted = null;
  return renderWithProviders(
    <ContactForm
      mode={mode}
      action={async (_previous, formData) => {
        submitted = formData;
        return { status: 'idle' };
      }}
      workspaceId="w-1"
      workspaceSlug="eshop"
      basePath="/w/eshop/contacts"
      values={{ ...values, ...overrides }}
    />,
  );
}

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

  it('u založení říká, že kontakt vzniká jako nepotvrzený', () => {
    renderForm({ id: null, email: '' }, 'create');
    expect(screen.getByText(/přidáme jako nepotvrzený/)).toBeInTheDocument();
  });
});
