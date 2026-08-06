import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { CampaignContentChrome } from './content-step-chrome';

/**
 * Pruh, kterým je editor prvním krokem kampaně.
 *
 * Vada, kterou to léčí, zněla doslova: „Krok 1 kampaně má být editor a obsah
 * e-mailu." Předtím byl krok 1 rozcestník s odkazem „Upravit obsah v editoru",
 * takže se uživatel k psaní e-mailu proklikával přes dvě obrazovky navíc.
 * Testy proto míří na tři věci: pás kroků je vidět i v editoru, ovládání
 * šablon je tam, kde se obsah tvoří, a odchod na další krok jde přes uložení.
 */

/** Radix `Select` a `Checkbox` potřebují v jsdom tyhle náhrady, viz settings-form.test. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const useLibraryTemplate = vi.fn().mockResolvedValue({ status: 'success', overwritten: false });
const saveAsTemplate = vi.fn().mockResolvedValue({ status: 'success', templateId: 'tpl-new' });
const renameCampaign = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  useLibraryTemplateAction: (input: unknown) => useLibraryTemplate(input),
  saveCampaignContentAsTemplateAction: (input: unknown) => saveAsTemplate(input),
  renameCampaignAction: (input: unknown) => renameCampaign(input),
}));

/*
 * Předání práce z editoru. Dvojník místo skutečného editoru: tenhle soubor
 * testuje pruh, ne plátno, a skutečná skořápka by si k sobě přitáhla celý
 * editor včetně automatického ukládání.
 */
const leave = vi.fn();
const flush = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/editor/state/use-handoff', () => ({
  useEditorHandoff: () => ({ leave, flush, busy: false }),
}));

const reload = vi.fn();

beforeEach(() => {
  leave.mockClear();
  flush.mockClear();
  reload.mockClear();
  useLibraryTemplate.mockClear();
  useLibraryTemplate.mockResolvedValue({ status: 'success', overwritten: false });
  saveAsTemplate.mockClear();
  saveAsTemplate.mockResolvedValue({ status: 'success', templateId: 'tpl-new' });
  // `window.location.reload` je v jsdom jen ke čtení, proto celý objekt.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

function renderChrome(
  overrides: {
    hasDesign?: boolean;
    readOnly?: boolean;
    templates?: Array<{ id: string; name: string }>;
    templatesTruncated?: boolean;
    canRename?: boolean;
  } = {},
) {
  return renderWithProviders(
    <CampaignContentChrome
      workspaceId="ws-1"
      campaignId="camp-1"
      campaignName="Letní výprodej"
      workingCopyId="work-1"
      hasDesign={overrides.hasDesign ?? true}
      templates={overrides.templates ?? [{ id: 'tpl-1', name: 'Výprodejová šablona' }]}
      templatesTruncated={overrides.templatesTruncated ?? false}
      basePath="/w/kolo-shop"
      readOnly={overrides.readOnly ?? false}
      canRename={overrides.canRename ?? true}
    />,
  );
}

/** Knihovna o zadaném počtu šablon. Jedna z nich má diakritiku, ať jde ověřit hledání. */
function library(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `tpl-${index + 1}`,
    name: index === 0 ? 'Pozvánka na výprodej' : `Šablona ${index + 1}`,
  }));
}

describe('editor jako krok 1 kampaně', () => {
  it('ukazuje pás kroků i uvnitř editoru, ať je vidět, kde uživatel je', () => {
    renderChrome();

    expect(screen.getByRole('status')).toHaveTextContent('Krok 1 z 3');
    expect(screen.getByTestId('campaign-step-content')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('campaign-step-basics')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-step-settings')).toBeInTheDocument();
  });

  /**
   * Odchod z editoru NENÍ obyčejný odkaz. Nejdřív se dopíše rozdělaný dokument
   * a převezme se do kampaně, jinak by kampaň držela obsah z chvíle, kdy se
   * pracovní kopie zakládala, a odešel by prázdný e-mail.
   */
  it('na další krok odchází přes uložení a převzetí obsahu', async () => {
    renderChrome();

    await userEvent.click(screen.getByTestId('campaign-step-basics'));

    expect(leave).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-1?step=basics');
  });

  it('na poslední krok vede taky, ne jen na ten hned další', async () => {
    renderChrome();

    await userEvent.click(screen.getByTestId('campaign-step-settings'));

    expect(leave).toHaveBeenCalledWith('/w/kolo-shop/campaigns/camp-1?step=settings');
  });

  /**
   * Uložení do knihovny je VÝSLOVNÁ akce, nikdy vedlejší účinek psaní kampaně,
   * a ukládá se to, co je na obrazovce, ne poslední automaticky uložená verze.
   */
  it('uložit jako šablonu je samostatná akce s vlastním názvem', async () => {
    renderChrome();

    await userEvent.click(screen.getByTestId('save-as-template'));
    const name = screen.getByLabelText('Název šablony');
    await userEvent.clear(name);
    await userEvent.type(name, 'Měsíční newsletter');
    await userEvent.click(screen.getByTestId('save-as-template-submit'));

    await waitFor(() =>
      expect(saveAsTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        workingCopyId: 'work-1',
        name: 'Měsíční newsletter',
      }),
    );
    expect(flush).toHaveBeenCalled();
  });

  /**
   * NABÍDKA MÍSTO ROZBALOVACÍHO POLE. Do 6. 8. 2026 se šablona vybírala
   * v `Select`u uvnitř pruhu pod hlavičkou a teprve druhé tlačítko „Převzít
   * obsah" spustilo akci. Seznam dnes visí přímo na tlačítku a klik na položku
   * JE tou volbou, takže testy míří na `menuitem`, ne na `combobox`. Tvrdí
   * ale pořád totéž: bez potvrzení se nepřepisuje a po potvrzení se volá
   * tatáž akce s toutéž šablonou.
   */
  it('u kampaně s obsahem se na převzetí šablony nejdřív zeptá, přepis je nevratný', async () => {
    renderChrome({ hasDesign: true });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Výprodejová šablona' }));

    expect(useLibraryTemplate).not.toHaveBeenCalled();
    expect(screen.getByText('Přepsat obsah kampaně obsahem šablony?')).toBeInTheDocument();
    // Nabídka je zavřená, takže potvrzení musí samo říct, ze které šablony se bere.
    expect(
      screen.getByText('Do kampaně se převezme obsah šablony „Výprodejová šablona“.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Přepsat obsah' }));

    await waitFor(() =>
      expect(useLibraryTemplate).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        campaignId: 'camp-1',
        // Pracovní kopie kampaně, do které se dokument zapíše.
        workingCopyId: 'work-1',
        // Knihovní šablona, ze které se bere. Ta se tímhle krokem nemění.
        templateId: 'tpl-1',
      }),
    );
    // Editor drží starý dokument ve svém stavu, takže se stránka musí načíst
    // znovu; jinak by ho automatické ukládání vrátilo zpátky nad převzatý obsah.
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('u kampaně bez dokumentu převezme šablonu rovnou, není se na co ptát', async () => {
    renderChrome({ hasDesign: false });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Výprodejová šablona' }));

    await waitFor(() => expect(useLibraryTemplate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Přepsat obsah kampaně obsahem šablony?')).not.toBeInTheDocument();
  });

  /**
   * ZAMÍTNUTÉ POTVRZENÍ NESMÍ NIC PŘEPSAT. Klik na šablonu je od téhle změny
   * jediné gesto, kterým se přepis spouští, takže ústup z dialogu je poslední
   * místo, kde se dá couvnout.
   */
  it('zamítnuté potvrzení nechá obsah kampaně na pokoji', async () => {
    renderChrome({ hasDesign: true });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Výprodejová šablona' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nechat obsah' }));

    expect(screen.queryByText('Přepsat obsah kampaně obsahem šablony?')).not.toBeInTheDocument();
    expect(useLibraryTemplate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * Prázdná knihovna dřív měla svou větu v pruhu pod hlavičkou. Pruh zmizel,
   * takže věta musí být v nabídce: tlačítko, které se otevře do prázdna, vypadá
   * jako rozbité.
   */
  it('prázdná knihovna to v nabídce řekne a nenabízí nic k převzetí', async () => {
    renderChrome({ templates: [] });

    await userEvent.click(screen.getByTestId('use-library-open'));

    expect(await screen.findByText('V knihovně zatím žádná šablona není.')).toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  /** Věta o tom, že se ze šablony jen kopíruje, patří k okamžiku výběru. */
  it('nabídka vysvětluje, že se šablona převzetím nemění', async () => {
    renderChrome();

    await userEvent.click(screen.getByTestId('use-library-open'));

    expect(await screen.findByText(/Šablona se tím nemění/)).toBeInTheDocument();
  });

  /**
   * HLEDÁNÍ AŽ OD DVANÁCTI ŠABLON.
   *
   * Krátký seznam se přejede očima a pole nad ním jen ubírá místo tomu, co
   * uživatel hledá. Hranice je v `SEARCH_FROM` a testy hlídají obě strany,
   * jinak by se dala posunout, aniž by si toho někdo všiml.
   */
  it('u krátké knihovny nabídka hledání nemá', async () => {
    renderChrome({ templates: library(11) });

    await userEvent.click(screen.getByTestId('use-library-open'));

    expect(await screen.findAllByRole('menuitem')).toHaveLength(11);
    expect(screen.queryByLabelText('Hledat šablonu')).not.toBeInTheDocument();
  });

  it('od dvanácti šablon nabídka hledá a zúží seznam', async () => {
    renderChrome({ templates: library(12) });

    await userEvent.click(screen.getByTestId('use-library-open'));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(12);

    // Bez diakritiky: kdo píše „vyprodej", musí najít „Pozvánka na výprodej".
    await userEvent.type(screen.getByLabelText('Hledat šablonu'), 'vyprodej');

    const found = await screen.findAllByRole('menuitem');
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveTextContent('Pozvánka na výprodej');
  });

  it('když hledání nic nenajde, řekne to a nenechá prázdno', async () => {
    renderChrome({ templates: library(12) });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.type(screen.getByLabelText('Hledat šablonu'), 'nic takového');

    expect(
      await screen.findByText('Žádná šablona tomu, co hledáte, neodpovídá.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  /** Zúžený seznam pořád přebírá obsah, hledání je filtr, ne jiná cesta. */
  it('vyhledaná šablona se dá převzít stejně jako každá jiná', async () => {
    renderChrome({ templates: library(12), hasDesign: false });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.type(screen.getByLabelText('Hledat šablonu'), 'pozvanka');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pozvánka na výprodej' }));

    await waitFor(() =>
      expect(useLibraryTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'tpl-1' }),
      ),
    );
  });

  /**
   * Uříznutý seznam to musí přiznat. Sto šablon je strop cesty (`limit=100`),
   * ne konec knihovny, a tichý ústřižek je k nerozeznání od úplného seznamu.
   */
  it('uříznutý seznam přizná, že v knihovně je toho víc', async () => {
    renderChrome({ templates: library(12), templatesTruncated: true });

    await userEvent.click(screen.getByTestId('use-library-open'));

    expect(await screen.findByText(/Nabídka ukazuje 12 naposledy upravených šablon/)).toBeVisible();
  });

  it('úplný seznam o žádném ústřižku nemluví', async () => {
    renderChrome({ templates: library(12) });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await screen.findAllByRole('menuitem');

    expect(screen.queryByText(/naposledy upravených šablon/)).not.toBeInTheDocument();
  });

  it('neúspěšné převzetí nespolkne a stránku nenačte znovu', async () => {
    useLibraryTemplate.mockResolvedValueOnce({ status: 'error', code: 'not_found' });
    renderChrome({ hasDesign: false });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Výprodejová šablona' }));

    const outcome = await screen.findByTestId('content-outcome');
    expect(outcome).toHaveAttribute('data-tone', 'error');
    expect(reload).not.toHaveBeenCalled();
  });

  /** Odeslaná kampaň se needituje. Pás kroků zůstává, akce nad obsahem mizí. */
  it('u uzamčené kampaně nenabízí ani uložení do knihovny, ani převzetí šablony', () => {
    renderChrome({ readOnly: true });

    expect(screen.queryByTestId('save-as-template')).not.toBeInTheDocument();
    expect(screen.queryByTestId('use-library-open')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-step-basics')).toBeInTheDocument();
  });
});
