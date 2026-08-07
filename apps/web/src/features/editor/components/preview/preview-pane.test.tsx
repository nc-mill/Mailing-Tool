import messages from '@mlain/i18n/messages/cs/editor.json';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { createFakePorts } from '../../ports/fake-ports';
import { ViewControls } from '../header/view-controls';
import { TemplateProfileProvider } from '../richtext/template-profile';
import { ViewProvider } from '../view/view-state';
import { explainPreviewLinks, PreviewPane } from './preview-pane';

// Radix v jsdom potřebuje pár metod, které tam nejsou.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

/**
 * Náhled se testuje SPOLU s ovladači z hlavičky, protože od téhle změny je to
 * jeden stav: přepínač zařízení, tmavý režim i „Zobrazit jako" sedí v hlavičce
 * a řídí zároveň plátno. Kdyby si je náhled držel sám, byly by dva stavy.
 */
// Ovladače zobrazení jsou od zúžení hlavičky ikony v bublinách a `Tooltip`
// mimo `TooltipProvider` vyhodí výjimku. V aplikaci ho dodává skořápka.
function setup(ports = createFakePorts()) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <TooltipProvider>
        <ViewProvider language="cs">
          <ViewControls ports={ports} />
          <PreviewPane templateId="t1" ports={ports} flush={async () => {}} />
        </ViewProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
  return ports;
}

describe('PreviewPane a ovladače zobrazení', () => {
  it('má čtyři režimy a k tomu nezávislý přepínač tmavého režimu', () => {
    setup();
    for (const label of ['Počítač', 'Mobil', 'Textová verze', 'Zdroj']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('switch', { name: /Tmavý režim/ })).toBeInTheDocument();
  });

  it('přepnutí tmavého režimu nevolá server znovu', async () => {
    // Tmavý režim kreslí komponenta K6 v prohlížeči. Kdyby byl v závislostech
    // načítání, každé cvaknutí by znamenalo cestu na server a probliknutí náhledu.
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('switch', { name: /Tmavý režim/ }));
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('kreslí náhled v iframe se šířkou podle režimu', async () => {
    setup();
    await waitFor(() => expect(screen.getByTitle(/Náhled/)).toBeInTheDocument());
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '700');
    await userEvent.click(screen.getByRole('radio', { name: 'Mobil' }));
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '375');
  });

  it('volba Kontakt bez jména vyžádá náhled s prázdnými osobními údaji, kritérium 55', async () => {
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Kontakt bez jména/ }));
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ previewData: { type: 'sample', variant: 'no_name' } }),
      ),
    );
  });

  it('před vyžádáním náhledu dopíše rozdělanou změnu na server', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <ViewProvider language="cs">
          <PreviewPane templateId="t1" ports={createFakePorts()} flush={flush} />
        </ViewProvider>
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(flush).toHaveBeenCalled());
  });

  it('textová verze se zobrazí jako text, ne jako HTML', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Textová verze' }));
    await waitFor(() => expect(screen.getByTestId('preview-text')).toHaveTextContent('Dobrý den'));
  });

  /**
   * Systémové odkazy v náhledu nesou `#preview-disabled`, protože odhlašovací
   * adresa se podepisuje až při odeslání. Je to správně, ale uživateli to nic
   * neříká: v textové verzi viděl tři řádky se záhadnou značkou a musel se ptát.
   */
  it('místo #preview-disabled vysvětlí, že odkaz vznikne až při odeslání', () => {
    expect(
      explainPreviewLinks(
        'Odhlásit se z odběru: #preview-disabled',
        '(odkaz vznikne až při odeslání)',
      ),
    ).toBe('Odhlásit se z odběru: (odkaz vznikne až při odeslání)');
    // Náhrada nesmí vypadat jako adresa, aby si ji nikdo nezkopíroval.
    expect(
      explainPreviewLinks('#preview-disabled', '(odkaz vznikne až při odeslání)'),
    ).not.toContain('http');
  });
});

/**
 * Náhled VEŘEJNÉ STRÁNKY se kreslí v rámu prohlížeče, ne e-mailového klienta.
 * Není to kosmetika: náhled má říct, kde ten obsah skončí, a stránka skončí
 * na webu. Přepínač mobil a počítač zůstává, šířka je u stránky pořád hlavní
 * otázka.
 */
describe('rám náhledu se řídí profilem šablony', () => {
  const setupWithProfile = (profile: 'campaign' | 'page') => {
    const ports = createFakePorts();
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <TooltipProvider>
          <TemplateProfileProvider value={profile}>
            <ViewProvider language="cs">
              <PreviewPane templateId="t1" ports={ports} flush={async () => {}} />
            </ViewProvider>
          </TemplateProfileProvider>
        </TooltipProvider>
      </NextIntlClientProvider>,
    );
  };

  it('u stránky kreslí rám prohlížeče a pojmenuje ho jako stránku', async () => {
    setupWithProfile('page');
    await waitFor(() =>
      expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-frame', 'page'),
    );
    expect(screen.getByTitle('Náhled stránky')).toBeInTheDocument();
    expect(screen.getByText('Stránka na vaší doméně')).toBeInTheDocument();
  });

  it('u kampaně zůstává rám e-mailového klienta', async () => {
    setupWithProfile('campaign');
    await waitFor(() =>
      expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-frame', 'email'),
    );
    expect(screen.getByTitle('Náhled e-mailu')).toBeInTheDocument();
  });
});
