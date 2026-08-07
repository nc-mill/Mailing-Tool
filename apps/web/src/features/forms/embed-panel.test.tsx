import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmbedPanel } from './embed-panel';
import type { FormEmbedView, FormFieldView } from './types';
import { renderWithProviders } from './test-utils';

vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  };
});

const EMBED: FormEmbedView = {
  slug: 'AAAAAAAAAAAAAAAAAAAAAAAA',
  hosted_url: 'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
  script:
    '<script async src="https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA.js"></script>\n<div data-ml-form="AAAAAAAAAAAAAAAAAAAAAAAA"></div>',
  iframe:
    '<iframe src="https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA" width="100%" height="320" style="border:0" title="Přihlášení k odběru"></iframe>',
  first_submission_at: null,
};

const FIELDS: FormFieldView[] = [
  { target: 'email', label: { cs: 'E-mail', en: 'Email' }, required: true, type: 'email' },
  { target: 'first_name', label: { cs: 'Jméno', en: 'First name' }, required: false, type: 'text' },
];

function renderPanel(
  overrides: Partial<FormEmbedView> = {},
  extra: { fields?: FormFieldView[]; consentText?: string | null } = {},
) {
  return renderWithProviders(
    <EmbedPanel
      formId="form-1"
      formName="Newsletter"
      embed={{ ...EMBED, ...overrides }}
      basePath="/w/muj-projekt/forms"
      fields={extra.fields ?? FIELDS}
      consentText={extra.consentText ?? null}
    />,
  );
}

describe('EmbedPanel', () => {
  it('doporučenou volbou je delegování, ne vložení vlastní rukou', () => {
    renderPanel();
    // Je to jediné místo v produktu, kde netechnický uživatel narazí na kód.
    expect(screen.getByText('Doporučeno')).toBeInTheDocument();
    expect(screen.getByTestId('embed-delegate')).toBeInTheDocument();
    expect(screen.queryByTestId('embed-self')).toBeNull();
  });

  it('delegování přizná rovnou u volby, že e-mail neodešleme za uživatele', () => {
    renderPanel();
    // Popisek volby musí říkat, co obrazovka doopravdy udělá. Text z katalogu
    // kontaktů slibuje odeslání e-mailu, které zatím nikdo neumí.
    expect(screen.getByRole('radio', { name: /Pošlu to člověku/ })).toHaveAccessibleName(
      /E-mail za vás zatím neodešleme/,
    );
    expect(screen.queryByText(/Připravíme e-mail s kódem a s návodem/)).toBeNull();
  });

  it('vlastní vložení ukáže nejjednodušší variantu a rámeček schová pod rozbalovátko', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    expect(screen.getByText(/data-ml-form/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Nejde vložit skript/ }));
    expect(screen.getByText(/iframe/)).toBeInTheDocument();
  });

  it('čistě HTML variantu vůbec nenabízí, protože tiše zahazovala odeslání', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    await user.click(screen.getByRole('button', { name: /Nejde vložit skript/ }));
    // Statický HTML kód nemá jak získat nonce, takže odeslání skončilo jako
    // `dropped / missing_nonce` a návštěvník přitom viděl děkovací stránku.
    expect(screen.queryByText(/method="post"/)).toBeNull();
    // Místo ní se řekne, že bez JavaScriptu funguje rámeček.
    expect(screen.getByText(/vypnutým JavaScriptem/)).toBeInTheDocument();
  });

  it('vypíše úchyty, stavy i ukázkové CSS ke zkopírování', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    const styling = screen.getByTestId('embed-styling');
    // Bez výčtu úchytů by „stylovatelný" znamenalo „vyberte si to na značky a doufejte".
    for (const hook of ['.ml-form', '.ml-field', '.ml-input', '.ml-button', '.ml-error']) {
      expect(styling).toHaveTextContent(hook);
    }
    expect(styling).toHaveTextContent('data-ml-state');
    expect(styling).toHaveTextContent('Ukázkové CSS');
  });

  it('hotová stránka nabídne adresu, na kterou jde odkazovat', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Použiju hotovou stránku/ }));
    expect(screen.getByTestId('embed-hosted')).toHaveTextContent(
      'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('blok Zkouška před prvním přihlášením přizná, že zatím nic nedorazilo', () => {
    renderPanel();
    const test = screen.getByTestId('embed-test');
    expect(test).toHaveTextContent('Zatím jsme přes tenhle formulář nedostali žádné přihlášení.');
    expect(within(test).getByTestId('embed-preview-link')).toHaveAttribute(
      'href',
      'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('po prvním přihlášení ukáže, kdy dorazilo', () => {
    renderPanel({ first_submission_at: '2026-07-31T12:20:00.000Z' });
    expect(screen.getByTestId('embed-test')).toHaveTextContent('První přihlášení dorazilo');
  });

  /**
   * Rozhodnutí zadavatele ze 7. 8. 2026: náhled nesmí mást jiným vzhledem, než jaký
   * formulář na cizím webu dostane. Tyhle tři testy jsou jeho brána.
   */
  it('náhled vloženého formuláře je holé značkování bez jediného našeho stylu', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));

    const preview = within(screen.getByTestId('embed-preview')).getByTestId(
      'field-preview',
    ) as HTMLIFrameElement;
    // Vlastní dokument v rámečku: reset stylů aplikace se do něj nepromítne
    // a je vidět formulář tak, jak vypadá na webu, který si ho ještě nenastyloval.
    expect(preview.srcdoc).toContain('E-mail');
    expect(preview.srcdoc).not.toContain('<style');
    expect(preview.srcdoc).not.toContain('ml-public');
    // Bez téhle věty vypadá neurovnaný formulář jako vada, ne jako záměr.
    expect(screen.getByTestId('embed-preview')).toHaveTextContent(
      /Vzhled mu dá až web, kam ho vložíte/,
    );
  });

  it('u hotové stránky náhled bez stylů nenabízí, tam je náhledem ta stránka sama', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Použiju hotovou stránku/ }));
    expect(screen.queryByTestId('embed-preview')).toBeNull();
    // A odkaz se u ní jmenovat „náhled" smí, protože přesně takhle stránka vypadá.
    expect(
      within(screen.getByTestId('embed-test')).getByTestId('embed-preview-link'),
    ).toHaveTextContent('Otevřít náhled formuláře');
  });

  it('u vkládaného formuláře neslibuje odkaz na hostovanou stránku jeho vzhled', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    const test = screen.getByTestId('embed-test');
    // Hostovaná stránka naše styly MÁ. Kdyby se odkaz na ni jmenoval „náhled
    // formuláře", uživatel by z něj četl vzhled, který na svém webu nedostane.
    expect(within(test).getByTestId('embed-preview-link')).toHaveTextContent(
      'Otevřít naši hostovanou stránku',
    );
    expect(test).toHaveTextContent(/Vložený formulář žádné CSS nenese/);
  });

  it('náhled se vynechá, když se detail formuláře nenačetl', async () => {
    const user = userEvent.setup();
    renderPanel({}, { fields: [] });
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    // Prázdný formulář v náhledu by lhal stejně jako ostylovaný, jen naopak.
    expect(screen.queryByTestId('embed-preview')).toBeNull();
  });

  it('náhled ukáže i zaškrtávátko souhlasu, protože ho vložený formulář vykreslí', async () => {
    const user = userEvent.setup();
    renderPanel({}, { consentText: 'Souhlasím se zasíláním novinek.' });
    await user.click(screen.getByRole('radio', { name: /Vložím to sám/ }));
    const preview = within(screen.getByTestId('embed-preview')).getByTestId(
      'field-preview',
    ) as HTMLIFrameElement;
    expect(preview.srcdoc).toContain('Souhlasím se zasíláním novinek.');
  });
});
