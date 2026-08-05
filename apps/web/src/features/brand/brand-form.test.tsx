import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import csEditor from '@mlain/i18n/messages/cs/editor.json';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { BrandForm, type BrandFormValues } from './brand-form';

const initial: BrandFormValues = {
  name: 'Kolo shop',
  primary: '#2563eb',
  secondary: '#3b82f6',
  accent: '#1d4ed8',
  // CSS stack, ne identifikátor: přesně tak ho ukládá extrakce webu
  // i `DEFAULT_TYPOGRAPHY` v jádře.
  background: '#f4f5f7',
  text: '#111827',
  headingStack: 'Georgia, "Times New Roman", serif',
  bodyStack: 'Arial, Helvetica, sans-serif',
  radius: 4,
  logo: null,
};

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ ai: csAi, editor: csEditor }}
      timeZone="Europe/Prague"
    >
      {ui}
    </NextIntlClientProvider>,
  );

function setup(values: BrandFormValues = initial) {
  const action = vi.fn(async (): Promise<ActionState> => IDLE);
  wrap(
    <BrandForm
      action={action}
      workspaceId="11111111-1111-4111-8111-111111111111"
      workspaceSlug="kolo-shop"
      initial={values}
    />,
  );
  return { action };
}

describe('formulář značky projektu', () => {
  it('nabízí vizuální výběr u každé barvy, ne jen psaní kódu', () => {
    setup();
    // Nativní výběr barvy má vlastní roli až v prohlížeči; v jsdom je to
    // `input[type=color]`, takže se hledá podle přístupného jména.
    for (const label of [
      'Hlavní barva',
      'Doplňková barva',
      'Zvýrazňovací barva',
      'Pozadí e-mailu',
      'Barva textu',
    ]) {
      const picker = screen.getByLabelText(`${label}, výběr barvy`);
      expect(picker).toHaveAttribute('type', 'color');
      // Vedle výběru zůstává textové pole s hexem, takže hodnota jde opsat
      // z brand manuálu a je čitelná i bez rozeznávání barev.
      expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe('text');
    }
    // Vzorek s hodnotou vedle pole, aby barva nebyla jen popsaná.
    expect(screen.getByTestId('brand-swatch-primary')).toHaveStyle({ backgroundColor: '#2563eb' });
  });

  it('psaní hexu překreslí vzorek i odvozené barvy motivu', async () => {
    setup();
    const hex = screen.getByLabelText('Hlavní barva');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#aa0000');

    expect(screen.getByTestId('brand-swatch-primary')).toHaveStyle({ backgroundColor: '#aa0000' });
    // `text.inverted` se odvozuje z hlavní barvy: na tmavě červené je čitelná
    // bílá. Kdyby se náhled nepřepočítal, zůstala by tu původní hodnota.
    const roles = screen.getByTestId('brand-theme-roles');
    const inverted = roles.querySelector('[data-role="text.inverted"]');
    expect(inverted?.textContent).toContain('#ffffff');
  });

  it('ukazuje, které role se nastavují a které se dopočítají', () => {
    setup();
    const roles = screen.getByTestId('brand-theme-roles');
    expect(roles.querySelector('[data-role="brand.primary"]')?.textContent).toContain(
      'nastavujete přímo',
    );
    // Ztlumený text ani odkaz nastavit nejdou, protože je `brandToTheme`
    // při skládání šablony stejně přepíše. Obrazovka to musí říct nahlas.
    expect(roles.querySelector('[data-role="text.muted"]')?.textContent).toContain('dopočítá se');
    expect(roles.querySelector('[data-role="link.default"]')?.textContent).toContain('dopočítá se');
  });

  /**
   * Nabídka ukazuje TO, CO Z ULOŽENÉ HODNOTY UDĚLÁ EMITTER, ne to, co by
   * z ní udělala vlastní tabulka v obrazovce. Překlad dělá `brandToTheme`.
   *
   * TENHLE TEST DŘÍV ČEKAL U „Arial, Helvetica, sans-serif" TIMES NEW ROMAN
   * a držel tím viditelnou vadu emitteru: vzor `/times|serif/i` se zkoušel dřív
   * než `/arial/i` a „sans-serif" na něj sedl. Vada je od 4. 8. 2026 opravená
   * v `packages/emails/src/base/brand.ts` (konkrétní písma napřed, `serif` se
   * nechytá uvnitř `sans-serif`), takže test čeká Arial, jak si uživatel zvolil.
   *
   * Z obrazovky se dál ukládají IDENTIFIKÁTORY písem (`georgia`, `arial`),
   * ne CSS stacky: ty se mapují samy na sebe a nabídka pro ně má položku.
   */
  it('písmo se v nabídce ukáže tak, jak ho přeloží emitter', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Písmo nadpisů' })).toHaveTextContent('Georgia');
    expect(screen.getByRole('combobox', { name: 'Písmo textu' })).toHaveTextContent('Arial');
  });

  it('logo se vybírá z knihovny médií, nenahrává se bokem', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Vybrat z knihovny médií' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nahrát/)).not.toBeInTheDocument();
  });
});
