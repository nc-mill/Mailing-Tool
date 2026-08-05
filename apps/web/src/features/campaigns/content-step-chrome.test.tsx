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
vi.mock('./actions', () => ({
  useLibraryTemplateAction: (input: unknown) => useLibraryTemplate(input),
  saveCampaignContentAsTemplateAction: (input: unknown) => saveAsTemplate(input),
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

function renderChrome(overrides: { hasDesign?: boolean; readOnly?: boolean } = {}) {
  return renderWithProviders(
    <CampaignContentChrome
      workspaceId="ws-1"
      campaignId="camp-1"
      campaignName="Letní výprodej"
      workingCopyId="work-1"
      hasDesign={overrides.hasDesign ?? true}
      templates={[{ id: 'tpl-1', name: 'Výprodejová šablona' }]}
      basePath="/w/kolo-shop"
      readOnly={overrides.readOnly ?? false}
    />,
  );
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

  it('u kampaně s obsahem se na převzetí šablony nejdřív zeptá, přepis je nevratný', async () => {
    renderChrome({ hasDesign: true });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Převzít obsah ze šablony' }));
    await userEvent.click(screen.getByRole('option', { name: 'Výprodejová šablona' }));
    await userEvent.click(screen.getByTestId('use-library-submit'));

    expect(useLibraryTemplate).not.toHaveBeenCalled();
    expect(screen.getByText('Přepsat obsah kampaně obsahem šablony?')).toBeInTheDocument();

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
    await userEvent.click(screen.getByRole('combobox', { name: 'Převzít obsah ze šablony' }));
    await userEvent.click(screen.getByRole('option', { name: 'Výprodejová šablona' }));
    await userEvent.click(screen.getByTestId('use-library-submit'));

    await waitFor(() => expect(useLibraryTemplate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Přepsat obsah kampaně obsahem šablony?')).not.toBeInTheDocument();
  });

  it('neúspěšné převzetí nespolkne a stránku nenačte znovu', async () => {
    useLibraryTemplate.mockResolvedValueOnce({ status: 'error', code: 'not_found' });
    renderChrome({ hasDesign: false });

    await userEvent.click(screen.getByTestId('use-library-open'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Převzít obsah ze šablony' }));
    await userEvent.click(screen.getByRole('option', { name: 'Výprodejová šablona' }));
    await userEvent.click(screen.getByTestId('use-library-submit'));

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
