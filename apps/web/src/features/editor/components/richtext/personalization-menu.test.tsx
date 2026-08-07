import csMessages from '@mlain/i18n/messages/cs/editor.json';
import enMessages from '@mlain/i18n/messages/en/editor.json';
import { buildRenderSchema } from '@mlain/emails/compile/render-schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Editor } from '@tiptap/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { validateDocumentClient } from '../../model/validate-client';
import { ViewProvider } from '../view/view-state';
import type { PageSurface } from '../../model/page-surface';
import { pageVariablesFor, PersonalizationMenu, systemLinksFor } from './personalization-menu';
import { PageSurfaceProvider } from './page-surface-context';
import { TemplateProfileProvider } from './template-profile';

/** Povrch se předává jen u profilu `page`, e-mail žádný nemá. */
type MenuOptions = {
  locale: 'cs' | 'en';
  profile: 'campaign' | 'transactional' | 'page';
  surface?: PageSurface;
};

/**
 * Radix Popover si měří spouštěč a cmdk roluje na vybranou položku. jsdom neumí
 * ani jedno, takže bez těchhle tří náhrad se nabídka vůbec neotevře. Netýká se
 * to toho, co se měří: filtr `cmdk` běží nad hodnotami, ne nad rozměry.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
});

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { cs: 'Jméno', en: 'First name' },
      group: 'name',
      deleted: false,
    },
  ],
};

const editorStub = (): { editor: Editor; inserted: ReturnType<typeof vi.fn> } => {
  const inserted = vi.fn();
  const editor = {
    chain: () => ({
      focus: () => ({
        insertContent: (content: unknown) => {
          inserted(content);
          return { run: () => true };
        },
      }),
    }),
  } as unknown as Editor;
  return { editor, inserted };
};

const wrap = (ui: ReactNode, options: MenuOptions) =>
  render(
    <NextIntlClientProvider
      locale={options.locale}
      messages={{ editor: options.locale === 'cs' ? csMessages : enMessages }}
    >
      <TemplateProfileProvider value={options.profile}>
        <PageSurfaceProvider value={options.surface ?? null}>{ui}</PageSurfaceProvider>
      </TemplateProfileProvider>
    </NextIntlClientProvider>,
  );

const openMenu = async (options: MenuOptions) => {
  const { editor, inserted } = editorStub();
  const user = userEvent.setup();
  wrap(<PersonalizationMenu editor={editor} fieldCatalog={catalog} />, options);
  await user.click(screen.getByTestId('insert-personalization'));
  return { user, inserted };
};

const labelsOf = (): string[] =>
  [...document.querySelectorAll('[cmdk-item]')].map((item) => item.textContent ?? '');

/**
 * VADA Z PROVOZU, kvůli které tenhle soubor vznikl: zadavatel hlásil, že odkaz
 * na zobrazení v prohlížeči v nabídce chybí. Byl tam celou dobu, jenže pod
 * popiskem „Zobrazení v prohlížeči", a výchozí filtr `cmdk` porovnává hledaný
 * text jen s popiskem. Na „odkaz" i na „URL" tedy dostal skóre 0 a ze seznamu
 * zmizel, přesně ve chvíli, kdy ho někdo hledal.
 */
describe('nabídka personalizace najde systémový odkaz podle toho, co to je', () => {
  it('česky ho najde na „odkaz", „URL" i „adresa"', async () => {
    const { user } = await openMenu({ locale: 'cs', profile: 'campaign' });
    const search = screen.getByPlaceholderText('Hledat pole');

    for (const query of ['odkaz', 'URL', 'adresa']) {
      await user.clear(search);
      await user.type(search, query);
      expect(labelsOf().join(' | ')).toContain('Odkaz na zobrazení v prohlížeči');
    }
  });

  it('anglicky ho najde na „link", „url" i „address"', async () => {
    const { user } = await openMenu({ locale: 'en', profile: 'campaign' });
    const search = screen.getByPlaceholderText('Search fields');

    for (const query of ['link', 'url', 'address']) {
      await user.clear(search);
      await user.type(search, query);
      expect(labelsOf().join(' | ')).toContain('Link to view in browser');
    }
  });

  it('vloží značku, ne popisek', async () => {
    const { user, inserted } = await openMenu({ locale: 'cs', profile: 'campaign' });
    await user.type(screen.getByPlaceholderText('Hledat pole'), 'prohlížeč');
    await user.click(screen.getByText('Odkaz na zobrazení v prohlížeči'));

    expect(inserted).toHaveBeenCalledWith({
      type: 'personalization',
      attrs: { expr: 'webview_url', fallback: null, dateFormat: null },
    });
  });

  it('u každého systémového odkazu ukáže, kde funguje', async () => {
    await openMenu({ locale: 'cs', profile: 'campaign' });
    expect(
      screen.getByText('Otevře tuhle zprávu jako webovou stránku, i s obrázky.'),
    ).toBeVisible();
  });
});

/**
 * Potvrzovací odkaz dává smysl jen v e-mailu seznamu a v kampani by skončil
 * blokující chybou, protože kořen `data` je v kampaňovém profilu zakázaný.
 * Naopak odhlašovací odkaz a předvolby odesílač transakční zprávě nedodává.
 */
describe('nabídka se řídí druhem šablony', () => {
  it('v kampani nabídne tři adresy odesílatele a potvrzení ne', () => {
    expect(systemLinksFor('campaign')).toEqual([
      'webview_url',
      'unsubscribe_url',
      'preferences_url',
    ]);
  });

  it('v transakční šabloně nabídne jen potvrzovací odkaz', () => {
    expect(systemLinksFor('transactional')).toEqual(['data.confirm_url']);
  });

  it('potvrzovací odkaz v kampani nenabídne ani při hledání', async () => {
    const { user } = await openMenu({ locale: 'cs', profile: 'campaign' });
    await user.type(screen.getByPlaceholderText('Hledat pole'), 'potvrzení');
    expect(labelsOf().join(' | ')).not.toContain('Odkaz na potvrzení přihlášení');
  });

  it('v transakční šabloně potvrzovací odkaz najde na „odkaz"', async () => {
    const { user } = await openMenu({ locale: 'cs', profile: 'transactional' });
    await user.type(screen.getByPlaceholderText('Hledat pole'), 'odkaz');
    expect(labelsOf().join(' | ')).toContain('Odkaz na potvrzení přihlášení');
  });
});

/**
 * ZÁVORA PROTI HORŠÍ VADĚ, NEŽ JE CHYBĚJÍCÍ POLOŽKA: značka, kterou nabídka
 * nabídne, ale validace odmítne nebo renderer nezná. Kontroluje se tímtéž
 * `checkSemantics`, kterým editor hlídá dokument, takže se test nemůže rozejít
 * s tím, co uživateli skutečně projde uložením.
 */
describe('každá nabídnutá značka projde validací svého profilu', () => {
  const documentWith = (expr: string): EditorDocument =>
    ({
      schemaVersion: 1,
      meta: { name: 'T', previewText: '', language: 'cs' },
      theme: DEFAULT_THEME,
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: blockDefaults('section'),
          children: [
            {
              id: 'b_000000000002',
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [{ t: 'p', children: [{ t: 'var', expr }] }],
              },
            },
          ],
        },
      ],
    }) as unknown as EditorDocument;

  const codesFor = (expr: string, profile: 'campaign' | 'transactional') =>
    validateDocumentClient(documentWith(expr), catalog, {
      assetIds: new Set<string>(),
      templateKind: profile,
    })
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code);

  for (const profile of ['campaign', 'transactional'] as const) {
    for (const tag of systemLinksFor(profile)) {
      it(`${tag} je v profilu ${profile} bez jediné výtky Liquidu`, () => {
        expect(codesFor(tag, profile).filter((code) => code.startsWith('liquid_'))).toEqual([]);
      });
    }
  }

  // Přesně tohle by uživatel dostal, kdyby se potvrzovací odkaz nabízel všude:
  // blokující chybu nad blokem, do kterého ho nabídka sama vložila.
  it('kdyby se potvrzovací odkaz nabídl v kampani, validace ho odmítne', () => {
    expect(codesFor('data.confirm_url', 'campaign')).toContain('liquid_unknown_root');
  });

  /**
   * Druhá polovina téže závory: značku musí posbírat i `buildRenderSchema`, což
   * je sběrač, ze kterého se plní `messages.render_data` a podle kterého poznají
   * závory e-mailů seznamu, že potvrzovací odkaz v dokumentu je. Značka, kterou
   * by sběrač přeskočil, by odešla jako prázdný řetězec, a to bez jediné chyby:
   * render běží s `strictVariables: false`.
   */
  for (const profile of ['campaign', 'transactional'] as const) {
    for (const tag of systemLinksFor(profile)) {
      it(`${tag} posbírá i sběrač dat pro odesílač`, () => {
        const schema = buildRenderSchema(documentWith(tag) as never, {
          fields: { version: 'v1', fields: [] },
          skippedBlockIds: new Set<string>(),
        });
        expect(schema.usedPaths).toContain(tag);
      });
    }
  }
});

/**
 * Nález z provozu: „Když tam vložím Oslovení, tak vlastně nevím, jak vypadá.
 * Je tam v šabloně mailu napsáno jen ‚Oslovení'. Ale bude to vypadat jak?
 * Dobrý den Honzo? Nebo Krásný den Honzo? Prostě to není jasné."
 *
 * Věta se v nabídce BERE ze vzorových dat, která skládá `buildGreeting`, tedy
 * tentýž kód, jaký ji složí při odeslání. Natvrdo napsaný příklad by se s ním
 * dřív nebo později rozešel a uživatel by se řídil něčím, co neplatí.
 */
describe('nabídka ukazuje u oslovení výslednou větu, ne jen název pole', () => {
  const withGreeting: FieldCatalog = {
    version: 'v1',
    fields: [
      ...catalog.fields,
      {
        path: 'greeting',
        type: 'string',
        label: { cs: 'Oslovení', en: 'Greeting' },
        group: 'salutation',
        deleted: false,
      },
    ],
  };

  const openWithGreeting = async (language: string) => {
    const { editor } = editorStub();
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: csMessages }}>
        <TemplateProfileProvider value="campaign">
          <ViewProvider language={language}>
            <PersonalizationMenu editor={editor} fieldCatalog={withGreeting} />
          </ViewProvider>
        </TemplateProfileProvider>
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByTestId('insert-personalization'));
  };

  it('u českého dokumentu ukáže českou větu i s 5. pádem', async () => {
    await openWithGreeting('cs');
    expect(screen.getByTestId('greeting-example')).toHaveTextContent(
      'Vyrobí: Dobrý den, Přemyslave-Řehoři',
    );
  });

  it('u anglického dokumentu ukáže anglickou větu, ne českou', async () => {
    await openWithGreeting('en');
    const example = screen.getByTestId('greeting-example');
    expect(example).toHaveTextContent('Hello');
    expect(example).not.toHaveTextContent('Dobrý den');
  });
});

/**
 * PALETKA ZNÁ POVRCH, ne jen druh šablony. Je to nejtvrdší pravidlo celého
 * plánu veřejných stránek (oddíl 4.3): na děkovací stránce žádný kontakt není,
 * protože se na ni chodí přesměrováním bez tokenu.
 *
 * Nabídnout ho a chybu ohlásit až při uložení nestačí. Kdo údaj v nabídce vidí,
 * ten ho použije, a teprve pak se dozví, že tam nepatří.
 */
describe('paletka veřejné stránky se řídí povrchem', () => {
  it('na děkovací stránce nenabídne kontakt', async () => {
    await openMenu({ locale: 'cs', profile: 'page', surface: 'form_thanks' });
    expect(labelsOf().join(' | ')).not.toContain('Jméno');
  });

  it('na stránce po potvrzení kontakt nabídne', async () => {
    await openMenu({ locale: 'cs', profile: 'page', surface: 'confirmed' });
    expect(labelsOf().join(' | ')).toContain('Jméno');
  });

  it('nabídne údaje, které povrch opravdu dodá, a nic navíc', () => {
    expect(pageVariablesFor('form_thanks')).toEqual([
      'workspace.name',
      'workspace.sender_address',
      'data.form_name',
      'data.list_name',
    ]);
    // Na povrchu s tokenem není název formuláře: odkaz v e-mailu o formuláři
    // nic neříká, takže by hodnota jednou byla a podruhé ne.
    expect(pageVariablesFor('confirmed')).not.toContain('data.form_name');
  });

  it('název formuláře ukáže na děkovací stránce, na potvrzovací ne', async () => {
    await openMenu({ locale: 'cs', profile: 'page', surface: 'form_thanks' });
    expect(labelsOf().join(' | ')).toContain('Název formuláře');
    cleanup();
    await openMenu({ locale: 'cs', profile: 'page', surface: 'confirmed' });
    expect(labelsOf().join(' | ')).not.toContain('Název formuláře');
  });

  it('bez zadaného povrchu se chová jako děkovací stránka, tedy nejúžeji', async () => {
    // Nezapojená propa se má projevit v editoru, ne až prázdným místem
    // u návštěvníka. Nejužší povrch je proto výchozí schválně.
    await openMenu({ locale: 'cs', profile: 'page' });
    expect(labelsOf().join(' | ')).not.toContain('Jméno');
  });

  it('na stránce nenabídne žádný systémový odkaz, ani při hledání', async () => {
    // Odesílač do stránky nic nedosazuje: není to zpráva. Odhlašovací odkaz má
    // vlastní stránku, potvrzovací odkaz patří do potvrzovacího e-mailu.
    expect(systemLinksFor('page')).toEqual([]);
    const { user } = await openMenu({ locale: 'cs', profile: 'page', surface: 'confirmed' });
    await user.type(screen.getByPlaceholderText('Hledat pole'), 'odkaz');
    expect(labelsOf().join(' | ')).not.toContain('Odkaz na odhlášení z odběru');
  });
});
