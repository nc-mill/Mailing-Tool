import messages from '@mlain/i18n/messages/cs/editor.json';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../model/document-types';
import { createFakePorts } from '../ports/fake-ports';
import { EditorShell } from './editor-shell';

/**
 * Motiv i vlastnosti jsou skutečné, ne prázdné objekty. Plátno teď kreslí e-mail
 * v jeho podobě, takže si motiv rozřeší `resolveTheme` z `@mlain/emails`, a ta
 * na `theme: {}` spadne na `theme.darkMode.colors`. Dřív to prošlo jen proto,
 * že plátno motiv vůbec nečetlo.
 */
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
        children: [{ id: 'b_h1', type: 'heading', props: { ...blockDefaults('heading') } }],
      },
    ],
  }) as unknown as EditorDocument;

const base = {
  templateId: 't1',
  designHash: 'h1',
  document: document(),
  canWriteHtml: true,
  templateKind: 'campaign' as const,
  readOnly: false,
  fieldCatalog: { fields: [], version: 'v1' },
  ports: createFakePorts(),
};

// `Tooltip` mimo `TooltipProvider` vyhodí výjimku. V aplikaci ho dodává
// skořápka projektu, v testu ho musí dodat obal.
const wrap = (props: Partial<typeof base> = {}) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <TooltipProvider>
        <EditorShell {...base} {...props} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );

describe('EditorShell', () => {
  it('má tři panely: paletu, plátno a vlastnosti', () => {
    wrap();
    expect(screen.getByRole('complementary', { name: /Bloky/ })).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /Vlastnosti/ })).toBeInTheDocument();
  });

  it('stav uložení je v hlavičce a nikdy toastem', () => {
    wrap();
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Uloženo/ })).toBeNull();
  });

  /*
   * Tvrzení je totéž: JEDNO tlačítko přepne plátno pryč a tímtéž kliknutím ho
   * vrátí. Změnil se jen způsob, jak se pozná, ve kterém stavu jsme: popisek
   * se od 6. 8. 2026 nemění (lámal hlavičku do dvou řádků) a stav nese
   * `aria-pressed`, jak to pro přepínací tlačítko popisuje WAI-ARIA.
   */
  it('tlačítko Náhled přepne prostřední panel a tímtéž kliknutím ho vrátí', async () => {
    wrap();
    const toggle = screen.getByRole('button', { name: 'Náhled' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Náhled' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Náhled' }));
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('šablona jen pro čtení ukáže pruh s důvodem a nekreslí zašedlá pole', () => {
    wrap({ readOnly: true });
    expect(screen.getByTestId('state-read-only')).toBeInTheDocument();
  });

  it('novější schéma se neotevře a řekne proč, kritérium 3 části 3', () => {
    wrap({ document: { ...document(), schemaVersion: 2 } as EditorDocument });
    expect(screen.getByTestId('state-schema-too-new')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('při vyčerpaném limitu bloků to řekne a nezakáže ostatní práci', () => {
    const many = {
      ...document(),
      blocks: Array.from({ length: 301 }, (_, index) => ({
        id: `b_x${index}`,
        type: 'section',
        props: {},
        children: [],
      })),
    } as unknown as EditorDocument;
    wrap({ document: many });
    expect(screen.getByTestId('state-too-many-blocks')).toBeInTheDocument();
  });
});
