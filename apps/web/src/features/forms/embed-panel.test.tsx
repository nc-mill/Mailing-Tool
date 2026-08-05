import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmbedPanel } from './embed-panel';
import type { FormEmbedView } from './types';
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

function renderPanel(overrides: Partial<FormEmbedView> = {}) {
  return renderWithProviders(
    <EmbedPanel
      formId="form-1"
      formName="Newsletter"
      embed={{ ...EMBED, ...overrides }}
      basePath="/w/muj-projekt/forms"
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
});
