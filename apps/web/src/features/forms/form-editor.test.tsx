import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEditor } from './form-editor';
import type { FormView } from './types';
import { renderWithProviders } from './test-utils';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const updateForm = vi.fn();
const deleteForm = vi.fn();
const createTemplate = vi.fn();
const createPage = vi.fn();
vi.mock('./actions', () => ({
  updateFormAction: (input: unknown) => updateForm(input),
  deleteFormAction: (input: unknown) => deleteForm(input),
  createDeliveryTemplateAction: (input: unknown) => createTemplate(input),
  createFormPageAction: (input: unknown) => createPage(input),
}));

/** Knihovna veřejných stránek projektu. Sdílená, odkaz na ni je u formuláře vlastní. */
const PAGES = [
  { id: 'page-1', name: 'Děkujeme' },
  { id: 'page-2', name: 'Vítejte' },
];

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

const FORM: FormView = {
  id: 'form-1',
  name: 'Newsletter',
  slug: 'AAAAAAAAAAAAAAAAAAAAAAAA',
  hosted_url: 'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
  fields: [
    { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
  ],
  list_ids: ['list-1'],
  double_opt_in: true,
  consent_text: null,
  consent_required: true,
  redirect_url: null,
  thanks_template_id: null,
  confirmed_template_id: null,
  already_subscribed_template_id: null,
  success_message: {},
  active: true,
  delivery_template_id: null,
  submission_count: 12,
  accepted_30d: 4,
  dropped_30d: {},
  created_at: '2026-07-31T10:15:30.000Z',
};

function renderEditor(overrides: Partial<FormView> = {}, canEdit = true) {
  return renderWithProviders(
    <FormEditor
      form={{ ...FORM, ...overrides }}
      lists={[
        { id: 'list-1', name: 'Newsletter' },
        { id: 'list-2', name: 'VIP' },
      ]}
      templates={[{ id: 'tpl-1', name: 'E-book' }]}
      pages={PAGES}
      contactFields={[
        {
          id: 'cf-1',
          key: 'company',
          label: { cs: 'Firma', en: 'Company' },
          type: 'text',
          options: {},
          required: false,
          archived_at: null,
        },
      ]}
      workspaceId="ws-1"
      workspaceSlug="muj-projekt"
      basePath="/w/muj-projekt/forms"
      canEdit={canEdit}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateForm.mockResolvedValue({ status: 'success', id: 'form-1' });
  deleteForm.mockResolvedValue({ status: 'success', id: 'form-1' });
  createTemplate.mockResolvedValue({ status: 'success', id: 'tpl-9' });
  createPage.mockResolvedValue({ status: 'success', id: 'page-9' });
});

/** Jeden řádek karty „Stránky pro návštěvníka". */
function pageRow(step: 'thanks' | 'confirmed' | 'already'): HTMLElement {
  return screen.getByTestId(`form-page-${step}-row`);
}

/**
 * Krok „co člověku přijde po vyplnění". Je to důvod, proč si většina lidí
 * formulář na web dává: nech mi adresu a já ti pošlu e-book.
 */
describe('FormEditor a e-mail po vyplnění', () => {
  it('formulář se zapnutým potvrzováním řekne, že e-mail odejde až po kliknutí', () => {
    renderEditor();
    expect(screen.getByTestId('form-email-timing')).toHaveTextContent(
      'Odejde až ve chvíli, kdy člověk klikne na potvrzovací odkaz.',
    );
  });

  it('s vypnutým potvrzováním řekne, že e-mail odejde hned', () => {
    renderEditor({ double_opt_in: false });
    expect(screen.getByTestId('form-email-timing')).toHaveTextContent(
      'Odejde hned po odeslání formuláře',
    );
  });

  it('výběr e-mailu se uloží na formulář', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('combobox', { name: 'Který e-mail se pošle' }));
    await user.click(screen.getByRole('option', { name: 'E-book' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { delivery_template_id: 'tpl-1' },
      });
    });
  });

  it('odebrání e-mailu pošle null, ne prázdný řetězec', async () => {
    const user = userEvent.setup();
    renderEditor({ delivery_template_id: 'tpl-1' });
    await user.click(screen.getByRole('combobox', { name: 'Který e-mail se pošle' }));
    await user.click(screen.getByRole('option', { name: 'Neposílat nic' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { delivery_template_id: null },
      });
    });
  });

  it('nastavený e-mail nabídne odkaz do editoru', () => {
    renderEditor({ delivery_template_id: 'tpl-1' });
    expect(screen.getByTestId('edit-delivery-template')).toHaveAttribute(
      'href',
      '/w/muj-projekt/templates/tpl-1',
    );
  });

  it('bez nastaveného e-mailu se odkaz do editoru nenabízí', () => {
    renderEditor();
    expect(screen.queryByTestId('edit-delivery-template')).toBeNull();
  });

  it('založení e-mailu ho rovnou naváže a otevře editor', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('create-delivery-template'));
    await waitFor(() => {
      expect(createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', formId: 'form-1' }),
      );
    });
    // Dalším krokem je psaní e-mailu, ne návrat na nastavení formuláře.
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/templates/tpl-9');
  });
});

describe('FormEditor a potvrzování e-mailem', () => {
  it('vypnutí potvrzování otevře dialog s doslovným zněním následku', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    expect(
      screen.getByRole('heading', { name: 'Vypnout potvrzení přihlášení e-mailem?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bez potvrzovacího e-mailu může kdokoliv přihlásit cizí adresu. Zvyšuje to riziko stížností na spam a v některých případech to znamená, že souhlas nedokážete doložit. Opravdu vypnout?',
      ),
    ).toBeInTheDocument();
  });

  it('dokud dialog nepotvrdí, zůstane potvrzování zapnuté a nic se neuloží', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    await user.click(screen.getByRole('button', { name: 'Nechat zapnuté' }));
    expect(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' })).toBeChecked();
    expect(updateForm).not.toHaveBeenCalled();
  });

  it('po potvrzení dialogu se vypne a uloží', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    await user.click(screen.getByRole('button', { name: 'Vypnout potvrzení' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { double_opt_in: false },
      });
    });
  });

  it('zapnutí zpátky žádný dialog nemá, protože je to bezpečnější směr', async () => {
    const user = userEvent.setup();
    renderEditor({ double_opt_in: false });
    await user.click(screen.getByRole('switch', { name: 'Potvrzení přihlášení e-mailem' }));
    expect(
      screen.queryByRole('heading', { name: 'Vypnout potvrzení přihlášení e-mailem?' }),
    ).toBeNull();
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { double_opt_in: true },
      });
    });
  });
});

describe('FormEditor a ostatní nastavení', () => {
  it('pozastavení je přepínač, ne mazání', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Formulář sbírá přihlášení' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { active: false },
      });
    });
    expect(deleteForm).not.toHaveBeenCalled();
  });

  it('přejmenování se uloží až při opuštění pole, ne po každém písmenu', async () => {
    const user = userEvent.setup();
    renderEditor();
    const input = screen.getByTestId('form-name');
    await user.clear(input);
    await user.type(input, 'Patička webu');
    expect(updateForm).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { name: 'Patička webu' },
      });
    });
  });

  it('odkaz na veřejnou stránku míří na adresu z API, ne na složenou z identifikátoru', () => {
    renderEditor();
    expect(screen.getByTestId('open-public-form')).toHaveAttribute(
      'href',
      'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('mazání nabídne mírnější cestu a teprve pak smaže', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('delete-form'));
    // Většina lidí, kteří sáhnou po smazání, chce formulář jen zastavit.
    expect(
      screen.getByText(
        'Když chcete formulář jen dočasně zastavit, vypněte přepínač Formulář sbírá přihlášení.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Smazat formulář', hidden: false }));
    await waitFor(() => {
      expect(deleteForm).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'form-1' });
    });
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/forms');
  });

  it('bez práva zapisovat se mazání nenabízí', () => {
    renderEditor({}, false);
    expect(screen.queryByTestId('delete-form')).toBeNull();
  });

  it('selhání uložení řekne důvod ze serveru', async () => {
    const user = userEvent.setup();
    updateForm.mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Seznam neexistuje.',
      fieldErrors: {},
    });
    renderEditor();
    await user.click(screen.getByRole('switch', { name: 'Formulář sbírá přihlášení' }));
    expect(await screen.findByTestId('form-editor-error')).toHaveTextContent('Seznam neexistuje.');
  });
});

/**
 * SOUHLAS U ZAŠKRTÁVACÍHO POLÍČKA.
 *
 * Text souhlasu v editoru byl od začátku, ale volba „musí se zaškrtnout" ne, takže
 * políčko bylo vždycky povinné a nešlo to změnit. Nepovinný souhlas přitom potřebuje
 * každý, kdo do formuláře dává potvrzení obchodních podmínek vedle samotného
 * přihlášení do seznamu. Nahlásil zadavatel 7. 8. 2026.
 */
describe('FormEditor a povinnost souhlasu', () => {
  it('bez textu souhlasu se přepínač povinnosti vůbec nenabízí', () => {
    renderEditor({ consent_text: null });
    expect(screen.queryByRole('switch', { name: 'Souhlas je povinný.' })).toBeNull();
  });

  it('s textem souhlasu se přepínač nabídne a nese současný stav', () => {
    renderEditor({ consent_text: 'Souhlasím se zpracováním údajů.', consent_required: true });
    expect(screen.getByRole('switch', { name: 'Souhlas je povinný.' })).toBeChecked();
  });

  it('vypnutí povinnosti se uloží na formulář', async () => {
    const user = userEvent.setup();
    renderEditor({ consent_text: 'Souhlasím se zpracováním údajů.', consent_required: true });

    await user.click(screen.getByRole('switch', { name: 'Souhlas je povinný.' }));
    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { consent_required: false },
      });
    });
  });

  /**
   * Nápověda musí říct, JAK se odkaz zapisuje. Bez toho člověk vloží `<a href>`,
   * uvidí ho na stránce jako holé znaky a usoudí, že produkt odkazy neumí.
   */
  it('nápověda ukazuje zápis odkazu na obchodní podmínky', () => {
    renderEditor();
    expect(
      screen.getByText(/\[text odkazu\]\(https:\/\/vasweb\.cz\/podminky\)/),
    ).toBeInTheDocument();
  });
});

/**
 * KARTA „STRÁNKY PRO NÁVŠTĚVNÍKA". Plán
 * `docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md`, 2.1.
 *
 * Trojice voleb je JEDNA volba, ne tři nezávislá pole. Testy níž měří přesně
 * to: co se uloží, se musí vždycky postarat i o tu druhou možnost.
 */
describe('FormEditor a stránky pro návštěvníka', () => {
  it('nabízí u každého kroku výchozí text i vlastní stránku', () => {
    renderEditor();
    for (const step of ['thanks', 'confirmed', 'already'] as const) {
      const scope = within(pageRow(step));
      expect(scope.getByRole('radio', { name: /Výchozí text/ })).toBeInTheDocument();
      expect(scope.getByRole('radio', { name: /Vlastní stránka/ })).toBeInTheDocument();
    }
  });

  /**
   * NEDOSTUPNÁ VOLBA SE NENABÍZÍ VŮBEC, ani zašedle.
   *
   * Formulář má vlastní `redirect_url` právě jednu, pro děkovací stránku; kam
   * poslat člověka po potvrzení a když už přihlášený je, bydlí na seznamu.
   * Původně tu proto zůstávala vypnutá volba s vysvětlením. Zadavatel to
   * 7. 8. 2026 odmítl: „proč je tu možnost, když nejde vybrat, je to matoucí".
   * Vypnutý ovládací prvek je slib, který obrazovka nesplní, a člověk na něj
   * kliká dřív, než si přečte vysvětlení pod ním.
   */
  it('přesměrování se nabízí JEN u kroku, který ho umí', () => {
    renderEditor();
    expect(
      within(pageRow('thanks')).getByRole('radio', { name: /Přesměrovat na web/ }),
    ).toBeInTheDocument();
    for (const step of ['confirmed', 'already'] as const) {
      expect(
        within(pageRow(step)).queryByRole('radio', { name: /Přesměrovat na web/ }),
      ).toBeNull();
    }
  });

  it('přepnutí na vlastní stránku uloží ID a zároveň vynuluje přesměrování', async () => {
    const user = userEvent.setup();
    renderEditor({ redirect_url: 'https://example.cz/dekujeme' });

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Vlastní stránka/ }));
    await user.click(within(pageRow('thanks')).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Děkujeme' }));

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { thanks_template_id: 'page-1', redirect_url: null },
      });
    });
  });

  it('přepnutí na výchozí text uloží null v obou polích', async () => {
    const user = userEvent.setup();
    renderEditor({ thanks_template_id: 'page-1' });

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Výchozí text/ }));

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { thanks_template_id: null, redirect_url: null },
      });
    });
  });

  it('přepnutí na přesměrování uloží adresu a vynuluje odkaz na stránku', async () => {
    const user = userEvent.setup();
    renderEditor({ thanks_template_id: 'page-1' });

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Přesměrovat na web/ }));
    await user.type(screen.getByTestId('form-page-thanks-redirect'), 'https://example.cz/diky');
    await user.tab();

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { thanks_template_id: null, redirect_url: 'https://example.cz/diky' },
      });
    });
  });

  /**
   * TVRDÉ PRAVIDLO: vlastní stránka a přesměrování se NESMÍ dát nastavit naráz.
   * Kdyby to šlo, veřejná trasa pošle 303 na cizí web a navržená stránka se
   * nikdy nevykreslí; autor by přitom viděl obojí nastavené.
   */
  it('vlastní stránka a přesměrování nejdou nastavit zároveň', async () => {
    const user = userEvent.setup();
    renderEditor({ thanks_template_id: 'page-1' });

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Přesměrovat na web/ }));
    await user.type(screen.getByTestId('form-page-thanks-redirect'), 'https://example.cz/diky');
    await user.tab();

    await waitFor(() => expect(updateForm).toHaveBeenCalled());

    /*
     * Nestačí, že se nová volba uložila. Zápis MUSÍ výslovně srovnat i tu
     * druhou možnost, jinak v datech zůstane nastavená stránka vedle
     * přesměrování a rozhodne veřejná trasa, ne uživatel. Skládají se proto
     * všechna těla dohromady, tedy tak, jak se skládají v databázi.
     */
    const state: Record<string, unknown> = {
      thanks_template_id: 'page-1',
      redirect_url: null,
    };
    for (const call of updateForm.mock.calls) {
      Object.assign(state, (call[0] as { body: Record<string, unknown> }).body);
    }
    expect(state['redirect_url']).toBe('https://example.cz/diky');
    expect(state['thanks_template_id'], JSON.stringify(state)).toBeNull();
  });

  it('adresu bez https ani neuloží a řekne proč', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Přesměrovat na web/ }));
    await user.type(screen.getByTestId('form-page-thanks-redirect'), 'example.cz/diky');
    await user.tab();

    expect(updateForm).not.toHaveBeenCalled();
    expect(await screen.findByText(/celá, včetně https/)).toBeInTheDocument();
  });

  /**
   * Nabídka smí obsahovat JEN šablony druhu `page`. E-mail vykreslený jako
   * veřejná stránka by pustil na naši doménu blok syrového HTML.
   */
  it('výběr nabízí stránky, ne e-maily formuláře', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Vlastní stránka/ }));
    await user.click(within(pageRow('thanks')).getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Děkujeme' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vítejte' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'E-book' })).not.toBeInTheDocument();
  });

  /**
   * Informace se odebráním volby NEZTRATILA, přesunula se do nápovědy kroku.
   * Kdo přesměrování hledá, musí se dozvědět, kde je, jinak usoudí, že to
   * produkt neumí.
   */
  it('u potvrzení a u už přihlášeného řekne, kde se přesměrování nastavuje', () => {
    renderEditor();
    for (const step of ['confirmed', 'already'] as const) {
      expect(
        within(pageRow(step)).getByText(/Přesměrování se u tohohle kroku nastavuje na seznamu/),
      ).toBeInTheDocument();
    }
  });

  /**
   * SDÍLENÍ STRÁNEK MEZI FORMULÁŘI, požadavek zadavatele z oddílu 0.3 plánu.
   * Šablona je sdílená, odkaz na ni je u každého formuláře zvlášť.
   */
  it('dva formuláře můžou ukazovat na tutéž stránku', () => {
    const first = renderEditor({ id: 'form-1', thanks_template_id: 'page-1' });
    expect(within(pageRow('thanks')).getByRole('combobox')).toHaveTextContent('Děkujeme');
    first.unmount();

    renderEditor({ id: 'form-2', thanks_template_id: 'page-1' });
    expect(within(pageRow('thanks')).getByRole('combobox')).toHaveTextContent('Děkujeme');
  });

  it('přehození stránky u jednoho formuláře se druhého nedotkne', async () => {
    const user = userEvent.setup();
    const first = renderEditor({ id: 'form-1', thanks_template_id: 'page-1' });

    await user.click(within(pageRow('thanks')).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Vítejte' }));

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { thanks_template_id: 'page-2', redirect_url: null },
      });
    });
    first.unmount();
    updateForm.mockClear();

    // Druhý formulář si drží svoje. Přehození u prvního na něj nesmí sáhnout.
    renderEditor({ id: 'form-2', thanks_template_id: 'page-1' });
    expect(within(pageRow('thanks')).getByRole('combobox')).toHaveTextContent('Děkujeme');
    expect(updateForm).not.toHaveBeenCalled();
  });

  /**
   * „Vytvořit stránku" nesmí nechat nikoho začínat na prázdné ploše ani ho
   * připravit o dnešní znění. Text se proto bere z týchž klíčů, které dnes
   * vykresluje veřejná stránka.
   */
  it('nová stránka je předvyplněná dnešním textem a rovnou se otevře editor', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Vlastní stránka/ }));
    await user.click(within(pageRow('thanks')).getByRole('button', { name: /Vytvořit stránku/ }));

    await waitFor(() => expect(createPage).toHaveBeenCalled());
    const input = createPage.mock.calls[0]![0] as {
      field: string;
      clearRedirect: boolean;
      document: {
        blocks: { children: { props: { content: { children: { v: string }[] }[] } }[] }[];
      };
    };
    expect(input.field).toBe('thanks_template_id');
    expect(input.clearRedirect).toBe(true);
    const section = input.document.blocks[0]!;
    expect(section.children[0]!.props.content[0]!.children[0]!.v).toBe(
      'Poslali jsme vám e-mail s odkazem',
    );
    expect(section.children[1]!.props.content[0]!.children[0]!.v).toMatch(/kliknutím na odkaz/);
    // Adresa editoru nese POVRCH. Bez něj editor spadne na nejužší povrch
    // a hlásil by údaje kontaktu jako chybu tam, kde být smějí.
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/w/muj-projekt/templates/page-9?surface=form_thanks');
    });
  });

  it('vlastní text po odeslání se do nové stránky přenese místo naší věty', async () => {
    const user = userEvent.setup();
    renderEditor({ success_message: { cs: 'Díky, ozveme se do druhého dne.' } });

    await user.click(within(pageRow('thanks')).getByRole('radio', { name: /Vlastní stránka/ }));
    await user.click(within(pageRow('thanks')).getByRole('button', { name: /Vytvořit stránku/ }));

    await waitFor(() => expect(createPage).toHaveBeenCalled());
    const input = createPage.mock.calls[0]![0] as {
      document: {
        blocks: { children: { props: { content: { children: { v: string }[] }[] } }[] }[];
      };
    };
    expect(input.document.blocks[0]!.children[1]!.props.content[0]!.children[0]!.v).toBe(
      'Díky, ozveme se do druhého dne.',
    );
  });
});
