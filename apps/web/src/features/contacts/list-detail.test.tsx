import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail, type ListDetailData } from './list-detail';
import { renderWithProviders } from './test-utils';

const setMode = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const setPublic = vi.fn().mockResolvedValue({ status: 'success' });

/**
 * Serverové akce e-mailů seznamu se podvrhují, jinak by se do modulového grafu
 * testu dostal `@mlain/core/contacts` a s ním `server-only`, který se z klientské
 * komponenty importovat nesmí. Chování akcí má vlastní testy na serveru.
 */
const createEmail = vi.fn().mockResolvedValue({ status: 'success', templateId: 't-1' });
const makeDefault = vi.fn().mockResolvedValue({ status: 'success' });
const toggleEmail = vi.fn().mockResolvedValue({ status: 'success' });
const savePageChoice = vi.fn().mockResolvedValue({ status: 'success' });
const createPage = vi.fn().mockResolvedValue({ status: 'success', templateId: 'page-9' });
const saveScope = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./list-email-actions', () => ({
  createListEmailTemplateAction: (...args: unknown[]) => createEmail(...args),
  detachListEmailTemplateAction: vi.fn().mockResolvedValue({ status: 'success' }),
  setListEmailEnabledAction: (...args: unknown[]) => toggleEmail(...args),
  saveListBasicsAction: vi.fn().mockResolvedValue({ status: 'success' }),
  saveListPageChoiceAction: (...args: unknown[]) => savePageChoice(...args),
  createListPageAction: (...args: unknown[]) => createPage(...args),
  saveListUnsubscribeScopeAction: (...args: unknown[]) => saveScope(...args),
  setDefaultListAction: (...args: unknown[]) => makeDefault(...args),
}));

/** Archivace se sleduje jmenovitě: testy níž hlídají, že se nespustí bez potvrzení. */
const archive = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  setConfirmationModeAction: (...args: unknown[]) => setMode(...args),
  archiveListAction: (...args: unknown[]) => archive(...args),
  setListPublicVisibilityAction: (...args: unknown[]) => setPublic(...args),
}));

const list: ListDetailData = {
  id: 'l-1',
  name: 'Newsletter',
  confirmed_count: 12480,
  pending_count: 312,
  double_opt_in: true,
  confirmation_mode: 'one_step',
  archived: false,
  // Výchozí stav je „nenabízet". Seznam je nositelem oprávnění k rozesílce, takže
  // zapnuté nabízení znamená, že se do něj smí přihlásit kdokoli s odhlašovacím odkazem.
  public_visible: false,
  public_name: '',
  public_description: '',
  description: '',
  confirmation_ttl_hours: 168,
  confirmation_max_resends: 3,
  confirm_redirect_url: '',
  unsubscribe_redirect_url: '',
  already_subscribed_redirect_url: '',
  confirmed_template_id: null,
  already_subscribed_template_id: null,
  unsubscribed_template_id: null,
  // Výchozí rozsah je „jen z tohohle seznamu". Ta druhá volba navíc blokuje
  // adresu pro celý projekt, takže se na ni přepíná vědomě.
  unsubscribe_scope: 'list',
  is_default: false,
  // Tři e-maily seznamu ve výchozím stavu: obecné znění, uvítání i rozloučení vypnuté.
  emails: [
    {
      kind: 'confirmation',
      templateId: null,
      templateName: null,
      enabled: true,
      hasConfirmLink: true,
    },
    { kind: 'welcome', templateId: null, templateName: null, enabled: false, hasConfirmLink: true },
    { kind: 'goodbye', templateId: null, templateName: null, enabled: false, hasConfirmLink: true },
  ],
};

/** Knihovna veřejných stránek projektu. Sdílená, odkaz na ni je u seznamu vlastní. */
const PAGES = [
  { id: 'page-1', name: 'Hotovo' },
  { id: 'page-2', name: 'Sbohem' },
];

/*
 * Radix Select se v jsdom neobejde bez těchhle metod. Chybí tam, takže by
 * rozbalení nabídky spadlo dřív, než se test dostane k tomu, co měří.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/** Jeden řádek karty „Stránky pro návštěvníka". */
function row(surface: 'confirmed' | 'already-subscribed' | 'unsubscribed'): HTMLElement {
  return screen.getByTestId(`list-page-${surface}-row`);
}

function renderDetail(overrides: Partial<ListDetailData> = {}) {
  return renderWithProviders(
    <ListDetail
      basePath="/w/eshop/lists"
      templatesPath="/w/eshop/templates"
      workspaceId="w-1"
      language="cs"
      list={{ ...list, ...overrides }}
      pages={PAGES}
    />,
  );
}

beforeEach(() => {
  setMode.mockClear();
  savePageChoice.mockClear();
  createPage.mockClear();
  saveScope.mockClear();
});

describe('ListDetail', () => {
  it('ukáže počet potvrzených i čekajících, protože obojí nese rozhodnutí', () => {
    const counts = () => screen.getByTestId('list-counts').textContent!;
    renderDetail();
    expect(counts()).toMatch(/12\s480 potvrzených kontaktů/);
    expect(counts()).toMatch(/312 čeká na potvrzení/);
  });

  it('u obou režimů potvrzení vysvětlí rozdíl větou, ne jen názvem', () => {
    renderDetail();
    expect(screen.getByText(/Potvrzení odešle stránka za něj/)).toBeInTheDocument();
    expect(screen.getByText(/Je to o klik navíc, zato máte doložené/)).toBeInTheDocument();
  });

  it('nepoužívá slova jednokrokové a dvoukrokové jako jediné vysvětlení', () => {
    renderDetail();
    expect(screen.getByRole('radio', { name: 'Jedním kliknutím' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }),
    ).toBeInTheDocument();
  });

  it('vybraný režim odpovídá datům', () => {
    renderDetail({ confirmation_mode: 'two_step' });
    expect(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' })).toBeChecked();
  });

  it('přepnutí režimu uloží a řekne, od kdy platí', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }));
    expect(setMode).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'l-1', mode: 'two_step' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Platí pro potvrzovací e-maily odeslané od teď.',
    );
  });
});

/**
 * Bezpečnostní vada: veřejné centrum předvoleb nabízelo VŠECHNY seznamy projektu,
 * takže se držitel jakéhokoli odhlašovacího odkazu mohl sám přihlásit i do seznamu,
 * který znamená nárok. Nastavení, které to řídí, musí být vidět v detailu seznamu.
 */
describe('veřejné nabízení seznamu', () => {
  beforeEach(() => setPublic.mockClear());

  it('je ve výchozím stavu vypnuté a texty pro příjemce se neptají', () => {
    renderDetail();
    expect(screen.getByTestId('list-public-visible')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.queryByTestId('list-public-name')).toBeNull();
  });

  it('zapnutí se uloží a teprve pak se ptá na veřejný název', async () => {
    renderDetail();
    await userEvent.click(screen.getByTestId('list-public-visible'));

    expect(setPublic).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      id: 'l-1',
      publicVisible: true,
      publicName: '',
      publicDescription: '',
    });
    expect(screen.getByTestId('list-public-name')).toBeTruthy();
  });

  it('nevyplněný veřejný název nabídne pracovní název jako to, co příjemce uvidí', () => {
    renderDetail({ public_visible: true });
    // Správce musí vědět, co se místo prázdného pole ukáže, jinak by mu unikla
    // pracovní poznámka do e-mailu příjemci. (Nadpis stránky nese totéž jméno,
    // proto se hledá celá nápověda, ne jen jméno seznamu.)
    expect(screen.getByText(/uvidí váš pracovní název „Newsletter“/)).toBeTruthy();
  });
});

/**
 * E-maily seznamu. Testuje se to, co uživatel na obrazovce rozhoduje:
 * jestli se posílají, jestli má znění vlastní, a jestli se dozví o e-mailu,
 * ze kterého se přihlášení dokončit nedá.
 */
describe('e-maily seznamu', () => {
  beforeEach(() => {
    createEmail.mockClear();
    toggleEmail.mockClear();
  });

  it('ukáže všechny tři e-maily a u potvrzení nenabídne vypínač', () => {
    renderDetail();
    expect(screen.getByTestId('list-email-confirmation')).toBeInTheDocument();
    expect(screen.getByTestId('list-email-welcome')).toBeInTheDocument();
    expect(screen.getByTestId('list-email-goodbye')).toBeInTheDocument();
    // Vypnout potvrzení znamená rozbít seznam s dvojím potvrzením, takže vypínač nemá.
    expect(screen.queryByTestId('list-email-enabled-confirmation')).toBeNull();
    expect(screen.getByTestId('list-email-enabled-welcome')).toBeInTheDocument();
  });

  it('vlastní znění zakládá šablonu jedním tlačítkem', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-email-create-welcome'));

    expect(createEmail).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'l-1', kind: 'welcome', language: 'cs' }),
    );
  });

  it('rozloučení se zapíná přepínačem', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-email-enabled-goodbye'));

    expect(toggleEmail).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'l-1', kind: 'goodbye', enabled: true }),
    );
  });

  /**
   * ZÁVORA SEZNAMU MUSÍ BÝT VIDĚT DOSLOVA. Server u potvrzovacího e-mailu bez
   * odkazu a u uvítacího s odhlašovacím odkazem vrací větu, která rovnou říká,
   * co s tím. Přebít ji obecným „nepodařilo se uložit" by z opravitelné chyby
   * udělalo záhadu, proto se hlídá, že se na obrazovku dostane nezměněná.
   */
  it('větu ze serveru ukáže doslova, ne obecné „nepodařilo se"', async () => {
    const user = userEvent.setup();
    const detail = 'Uvítací e-mail nesmí obsahovat odhlašovací odkaz.';
    createEmail.mockResolvedValueOnce({ status: 'error', code: 'unprocessable', detail });
    renderDetail();

    await user.click(screen.getByTestId('list-email-create-welcome'));

    expect(await screen.findByRole('alert')).toHaveTextContent(detail);
  });

  it('potvrzovací e-mail bez odkazu na potvrzení hlásí nahlas', () => {
    renderDetail({
      emails: [
        {
          kind: 'confirmation',
          templateId: 't-9',
          templateName: 'Moje potvrzení',
          enabled: true,
          hasConfirmLink: false,
        },
        {
          kind: 'welcome',
          templateId: null,
          templateName: null,
          enabled: false,
          hasConfirmLink: true,
        },
        {
          kind: 'goodbye',
          templateId: null,
          templateName: null,
          enabled: false,
          hasConfirmLink: true,
        },
      ],
    });

    expect(screen.getByTestId('list-email-no-link')).toHaveTextContent(/nemá odkaz na potvrzení/);
  });
});

/**
 * VÝCHOZÍ SEZNAM. Endpoint `POST /lists/{id}/default` existoval od začátku
 * a neměl volajícího, takže se výchozí seznam nedal přehodit odnikud.
 */
describe('výchozí seznam projektu', () => {
  it('nabídne nastavení, když seznam výchozí není', async () => {
    const user = userEvent.setup();
    makeDefault.mockClear();
    renderDetail();

    await user.click(screen.getByTestId('list-make-default'));

    expect(makeDefault).toHaveBeenCalledWith(expect.objectContaining({ listId: 'l-1' }));
  });

  it('u výchozího seznamu tlačítko nenabízí a řekne to větou', () => {
    renderDetail({ is_default: true });
    expect(screen.queryByTestId('list-make-default')).toBeNull();
    expect(screen.getByTestId('list-is-default')).toBeInTheDocument();
  });
});

/**
 * ARCHIVACE JE JEDINÉ MAZÁNÍ SEZNAMU, KTERÉ PRODUKT MÁ. Dřív ji ikona spouštěla
 * rovnou z `onClick` a obrazovka hned odešla na přehled, takže kliknutí vedle
 * znamenalo ztrátu přístupu k seznamu bez jediné otázky. Testy hlídají obojí:
 * že se otevře okno místo akce a že se v okně nelže o následcích.
 */
describe('archivace seznamu', () => {
  beforeEach(() => archive.mockClear());

  it('kliknutí na ikonu archivace nearchivuje, jen se zeptá', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-archive-open'));

    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Archivovat seznam Newsletter?');
  });

  it('vypisuje pravdivé následky: co zmizí, co přestane chodit a co zůstává', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-archive-open'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Seznam zmizí z nabídek');
    expect(dialog).toHaveTextContent('Nová přihlášení seznam přestane přijímat');
    expect(dialog).toHaveTextContent('ani historie souhlasů se nemažou');
    // Následek o výchozím seznamu platí jen pro výchozí seznam, jinak by to byla lež.
    expect(dialog).not.toHaveTextContent('přestane být výchozí');
  });

  it('u výchozího seznamu přidá i následek o ztrátě role výchozího', async () => {
    const user = userEvent.setup();
    renderDetail({ is_default: true });

    await user.click(screen.getByTestId('list-archive-open'));

    expect(screen.getByRole('dialog')).toHaveTextContent('přestane být výchozí');
  });

  it('archivuje teprve po potvrzení v okně', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-archive-open'));
    await user.click(screen.getByRole('button', { name: 'Archivovat seznam' }));

    expect(archive).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'l-1' });
  });

  it('ústup z okna seznam nechá být', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByTestId('list-archive-open'));
    await user.click(screen.getByRole('button', { name: 'Nechat seznam' }));

    expect(archive).not.toHaveBeenCalled();
  });

  /**
   * Neúspěch se nesmí spolknout. Dřív se návrat z akce vůbec nečetl, takže by
   * uživatel odešel na přehled s tím, že archivoval, a seznam by přitom stál.
   */
  it('neúspěch ohlásí a nechá uživatele na obrazovce', async () => {
    const user = userEvent.setup();
    archive.mockResolvedValueOnce({ status: 'error', code: 'forbidden' });
    renderDetail();

    await user.click(screen.getByTestId('list-archive-open'));
    await user.click(screen.getByRole('button', { name: 'Archivovat seznam' }));

    expect(await screen.findByText(/Seznam se nepodařilo archivovat \(forbidden\)/)).toBeVisible();
  });

  /**
   * PROTIMLUV, KVŮLI KTERÉMU TAHLE SKUPINA VZNIKLA. Karta potvrzovacího e-mailu
   * tvrdila „nejde vypnout" i na seznamu, který přihlašuje rovnou a kde se ten
   * e-mail při běžném přihlášení vůbec neposílá. Zdrojem pravdy je `opt_in`.
   */
  describe('potvrzovací e-mail vůči způsobu přihlášení', () => {
    it('u dvojího potvrzení řekne, že vypnout nejde, a proč', () => {
      renderDetail({ double_opt_in: true });
      expect(screen.getByText('nejde vypnout')).toBeVisible();
      expect(screen.getByText(/dostane každý, kdo se přihlásí/)).toBeVisible();
    });

    it('u jednoduchého přihlášení netvrdí, že nejde vypnout', () => {
      renderDetail({ double_opt_in: false });
      expect(screen.queryByText('nejde vypnout')).not.toBeInTheDocument();
      expect(screen.getByText('posílá se jen výjimečně')).toBeVisible();
    });

    it('u jednoduchého přihlášení vyjmenuje dva případy, kdy e-mail přesto odejde', () => {
      renderDetail({ double_opt_in: false });
      expect(screen.getByText(/vrací někdo, kdo se dřív odhlásil/)).toBeVisible();
      expect(screen.getByText(/vypršel dřív vydaný potvrzovací odkaz/)).toBeVisible();
    });
  });

  describe('rozsah odhlášení', () => {
    it('vybraná volba odpovídá datům', () => {
      renderDetail({ unsubscribe_scope: 'global' });
      expect(screen.getByRole('radio', { name: 'Odhlásit ze všech seznamů' })).toBeChecked();
    });

    /**
     * Volba mění víc než rozsah: globální odhlášení zapíše adresu mezi blokované
     * pro celý projekt. Bez téhle věty by si tím šlo omylem zablokovat vlastní
     * databázi kontaktů.
     */
    it('u volby ze všech seznamů řekne i to, že se adresa zablokuje pro celý projekt', async () => {
      const user = userEvent.setup();
      renderDetail();

      await user.click(screen.getByRole('radio', { name: 'Odhlásit ze všech seznamů' }));

      expect(saveScope).toHaveBeenCalledWith({
        workspaceId: 'w-1',
        listId: 'l-1',
        unsubscribeScope: 'global',
      });
      expect(await screen.findByTestId('list-unsubscribe-scope-warning')).toHaveTextContent(
        /mezi blokované pro celý projekt/,
      );
    });

    it('neúspěch ohlásí a volbu vrátí zpátky', async () => {
      const user = userEvent.setup();
      saveScope.mockResolvedValueOnce({ status: 'error', code: 'forbidden', detail: '' });
      renderDetail();

      await user.click(screen.getByRole('radio', { name: 'Odhlásit ze všech seznamů' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(screen.getByRole('radio', { name: 'Odhlásit jen z tohohle seznamu' })).toBeChecked();
    });
  });

  /**
   * Trojice voleb u každého kroku, viz plán
   * `docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md`.
   */
  describe('stránky pro návštěvníka', () => {
    it('řekne u potvrzení i u už přihlášeného, že nastavení na formuláři má přednost', () => {
      renderDetail();
      expect(screen.getAllByText(/Nastavení na formuláři má přednost/)).toHaveLength(2);
    });

    it('u kroku po odhlášení naopak řekne, že ho vlastní jen seznam', () => {
      renderDetail();
      expect(screen.getByText(/Tenhle krok vlastní jen seznam/)).toBeInTheDocument();
    });

    it('vlastní stránka se uloží a přesměrování se přitom vynuluje', async () => {
      const user = userEvent.setup();
      renderDetail();

      await user.click(within(row('confirmed')).getByRole('radio', { name: /Vlastní stránka/ }));
      await user.click(within(row('confirmed')).getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Hotovo' }));

      await waitFor(() => {
        expect(savePageChoice).toHaveBeenCalledWith({
          workspaceId: 'w-1',
          listId: 'l-1',
          surface: 'confirmed',
          templateId: 'page-1',
          // Trojice je jedna volba: připojená stránka a přesměrování si odporují.
          redirectUrl: null,
        });
      });
    });

    it('návrat na výchozí text uloží null v obou polích', async () => {
      const user = userEvent.setup();
      renderDetail({ confirmed_template_id: 'page-1' });

      await user.click(within(row('confirmed')).getByRole('radio', { name: /Výchozí text/ }));

      await waitFor(() => {
        expect(savePageChoice).toHaveBeenCalledWith({
          workspaceId: 'w-1',
          listId: 'l-1',
          surface: 'confirmed',
          templateId: null,
          redirectUrl: null,
        });
      });
    });

    it('adresu bez https ani neuloží a řekne proč', async () => {
      const user = userEvent.setup();
      renderDetail();

      await user.click(
        within(row('unsubscribed')).getByRole('radio', { name: /Přesměrovat na web/ }),
      );
      await user.type(screen.getByTestId('list-page-unsubscribed-redirect'), 'example.com/sbohem');
      await user.tab();

      expect(savePageChoice).not.toHaveBeenCalled();
      expect(await screen.findByText(/celá, včetně https/)).toBeInTheDocument();
    });

    it('stránku pro už přihlášeného uloží a upozorní, co tím prozradí', async () => {
      const user = userEvent.setup();
      renderDetail();

      expect(screen.getByText(/prozradíte, že ta adresa u vás v databázi je/)).toBeInTheDocument();

      await user.click(
        within(row('already-subscribed')).getByRole('radio', { name: /Přesměrovat na web/ }),
      );
      await user.type(
        screen.getByTestId('list-page-already-subscribed-redirect'),
        'https://example.com/uz-jste-u-nas',
      );
      await user.tab();

      await waitFor(() => {
        expect(savePageChoice).toHaveBeenCalledWith({
          workspaceId: 'w-1',
          listId: 'l-1',
          surface: 'already_subscribed',
          templateId: null,
          redirectUrl: 'https://example.com/uz-jste-u-nas',
        });
      });
    });
  });
});
