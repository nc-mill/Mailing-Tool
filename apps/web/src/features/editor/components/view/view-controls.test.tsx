import { resolveTheme } from '@mlain/emails/theme/resolve';
import messages from '@mlain/i18n/messages/cs/editor.json';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { createFakePorts } from '../../ports/fake-ports';
import { EditorShell } from '../editor-shell';

// Radix a ProseMirror v jsdom potřebují pár metod, které tam nejsou.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'greeting',
      type: 'string',
      label: { cs: 'Oslovení', en: 'Greeting' },
      group: 'name',
      deleted: false,
    },
  ],
};

const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'Letní výprodej', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: { ...blockDefaults('section') },
        children: [
          {
            id: 'b_t1',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [
                {
                  t: 'p',
                  children: [
                    { t: 'var', expr: 'contact.greeting' },
                    { t: 's', v: ', vítejte.' },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

// `Tooltip` v hlavičce potřebuje `TooltipProvider`; v aplikaci ho dodává
// skořápka projektu, tady obal testu.
function shell(assistant?: React.ReactNode) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <TooltipProvider>
        <EditorShell
          templateId="t1"
          designHash="h1"
          document={document()}
          canWriteHtml
          readOnly={false}
          fieldCatalog={catalog}
          ports={createFakePorts()}
          templateKind="campaign"
          {...(assistant === undefined ? {} : { assistant })}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

const canvas = () => screen.getByRole('tree');

/** jsdom vrací styly v `rgb()`, motiv je v hexu. */
function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Ovladače zobrazení patří do hlavičky A MUSÍ MĚNIT PLÁTNO.
 *
 * Přesně o to jde: uživatel skládá e-mail v prostředí, ve kterém e-mail dojde.
 * Kdyby přepínače ovlivnily jen oddělený náhled, byla by to jen přestěhovaná
 * lišta a nic víc.
 */
describe('ovladače zobrazení v hlavičce editoru', () => {
  it('stojí u stavu ukládání, ne až v náhledu', () => {
    shell();
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Režim náhledu' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Tmavý režim/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zobrazit jako/ })).toBeInTheDocument();
  });

  /**
   * REŽIMY JSOU OD 6. 8. 2026 IKONY BEZ SLOV.
   *
   * Hlavička se lámala do dvou řádků a místo drželi právě tihle čtyři
   * s texty (390 px ze 927). Jméno volby se tím ale nesmělo ztratit: čtečka
   * i hlasové ovládání ho čtou dál jako přístupné jméno přepínače, e2e taky.
   */
  describe('přepínač režimů zobrazení', () => {
    const NAMES = ['Počítač', 'Mobil', 'Textová verze', 'Zdroj'];

    it('každá volba se dál jmenuje svým slovem', () => {
      shell();
      for (const name of NAMES) {
        expect(screen.getByRole('radio', { name })).toBeInTheDocument();
      }
    });

    it('jméno je i v `title`, takže bublinu ukáže i prohlížeč sám', () => {
      shell();
      expect(screen.getByRole('radio', { name: 'Mobil' })).toHaveAttribute('title', 'Mobil');
    });

    it('slovo uvnitř tlačítka už není, zbyla ikona', () => {
      shell();
      expect(screen.getByTestId('view-mode-mobile').textContent).toBe('');
    });

    it('zvolená volba se pozná z `aria-checked`, ne jen z barvy', () => {
      shell();
      expect(screen.getByTestId('view-mode-desktop')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('view-mode-mobile')).toHaveAttribute('aria-checked', 'false');
    });

    /*
     * Barva sama by byla informace nesená jen barvou (WCAG 1.4.1). Zvolená
     * volba proto kromě plochy dostává i vnitřní pruh u spodní hrany.
     */
    it('zvolená volba má kromě plochy i vlastní pruh, ne jen odstín', () => {
      shell();
      const mode = screen.getByTestId('view-mode-desktop');
      expect(mode).toHaveClass('aria-checked:bg-accent-surface');
      expect(mode.className).toContain(
        'aria-checked:shadow-[inset_0_-2px_0_var(--color-accent-text)]',
      );
    });

    /* WCAG 2.5.8. Bylo 36 px a s odebráním textu by se cíl zmenšil ještě víc. */
    it('klikací plocha je 44 px, ne 36', () => {
      shell();
      for (const name of NAMES) {
        expect(screen.getByRole('radio', { name })).toHaveClass('size-[var(--size-target-min)]');
      }
    });

    /* Tmavý režim není volba ze skupiny, je to samostatné zapnuto/vypnuto. */
    it('tmavý režim zůstal přepínačem se jménem, jen bez viditelného textu', () => {
      shell();
      const dark = screen.getByRole('switch', { name: 'Tmavý režim' });
      expect(dark).toBeInTheDocument();
      expect(dark.closest('label')?.textContent).toBe('');
    });
  });

  /**
   * SPOUŠTĚČ NABÍDKY NESE JEN „ZOBRAZIT JAKO", aby hlavička nebyla přes dva
   * řádky. Zvolená hodnota se tím nesmí ztratit: čtečka ji čte z `aria-label`,
   * oko ji najde v rozbalené nabídce.
   */
  it('na tlačítku je jen Zobrazit jako, hodnota je v přístupném jméně', () => {
    shell();
    const trigger = screen.getByRole('button', { name: /Zobrazit jako/ });
    expect(trigger.textContent).toBe('Zobrazit jako');
    expect(trigger).toHaveAttribute('aria-label', 'Zobrazit jako: Značky');
  });

  it('rozbalená nabídka ukáže současnou volbu řádkem i zaškrtnutím', async () => {
    shell();
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    expect(await screen.findByTestId('view-as-current')).toHaveTextContent('Zobrazit jako: Značky');
    expect(screen.getByRole('button', { name: 'Značky' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Vzorová data' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('po přepnutí publika se posune i zaškrtnutí a přístupné jméno tlačítka', async () => {
    shell();
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vzorová data' }));
    expect(screen.getByRole('button', { name: /Zobrazit jako/ })).toHaveAttribute(
      'aria-label',
      'Zobrazit jako: Vzorová data',
    );
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    expect(await screen.findByRole('button', { name: 'Vzorová data' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('Mobil zúží plátno na šířku mobilu', async () => {
    shell();
    expect(canvas()).toHaveAttribute('data-viewport', 'desktop');
    await userEvent.click(screen.getByRole('radio', { name: 'Mobil' }));
    expect(canvas()).toHaveAttribute('data-viewport', 'mobile');
    expect(canvas().getAttribute('style')).toContain('375px');
  });

  it('tmavý režim ztmaví plátno barvami z motivu, ne barvami aplikace', async () => {
    shell();
    const light = canvas().parentElement!.getAttribute('style');
    await userEvent.click(screen.getByRole('switch', { name: /Tmavý režim/ }));
    const dark = canvas().parentElement!.getAttribute('style');
    expect(dark).not.toEqual(light);
    // `surface.canvas` z TMAVÉ palety motivu (`resolveTheme(...).dark`), ne
    // token aplikace. Jsou to tytéž hodnoty, jaké emitter posílá v pravidle
    // `.ml-canvas` uvnitř `@media (prefers-color-scheme: dark)`.
    const expected = resolveTheme(DEFAULT_THEME as never).dark.roles['surface.canvas'];
    expect(dark).toContain(hexToRgb(expected));
  });

  it('volba Vzorová data dosadí do značky hodnotu, ne popisek pole', async () => {
    shell();
    expect(screen.getByTestId('token')).toHaveTextContent('Oslovení');
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vzorová data' }));
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('Dobrý den'));
    // Do e-mailu jde dál `{{ … }}`; dosazení je jen zobrazení.
    expect(screen.getByTestId('token').textContent).not.toContain('{{');
  });

  it('Kontakt bez jména ukáže díru tam, kde jméno chybí', async () => {
    shell();
    await userEvent.click(screen.getByRole('button', { name: /Zobrazit jako/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Kontakt bez jména' }));
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent(''));
  });

  it('Textová verze needituje: plátno zmizí a jedno kliknutí ho vrátí', async () => {
    shell();
    await userEvent.click(screen.getByRole('radio', { name: 'Textová verze' }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByTestId('view-read-only')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zpět k úpravám' }));
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('Zdroj se chová stejně jako textová verze', async () => {
    shell();
    await userEvent.click(screen.getByRole('radio', { name: 'Zdroj' }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByTestId('view-read-only')).toBeInTheDocument();
  });
});

describe('sbalený panel asistenta', () => {
  it('je vidět: nese jméno asistenta, ne jen šipku', async () => {
    shell(<aside aria-label="AI asistent">panel</aside>);
    const rail = screen.getByTestId('assistant-rail');
    expect(rail).toHaveTextContent('AI asistent');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
  });

  it('rozbalí se z klávesnice', async () => {
    shell(<aside aria-label="AI asistent">panel</aside>);
    screen.getByTestId('assistant-rail').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('assistant-rail')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('panel')).toBeInTheDocument();
  });
});
