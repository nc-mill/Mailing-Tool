import { blockDefaults, DEFAULT_THEME } from '../document/defaults';
import { newBlockId } from '../document/ids';
import type {
  ColumnsBlock,
  Document,
  RichText,
  SectionBlock,
  SectionChild,
} from '../document/types';
import { SUPPORTED_LANGUAGES } from '../normalize/index';
import { brandToTheme, type BrandInput } from './brand';
import { plainToRichText } from './rich';
import cs from './i18n/cs.json' with { type: 'json' };
import en from './i18n/en.json' with { type: 'json' };

const CATALOGS: Record<string, Record<string, string>> = { cs, en };

export type BaseTemplateVariant = 'newsletter' | 'announcement' | 'transactional' | 'reengagement';

export type BaseSectionSpec =
  | {
      kind: 'hero';
      headline: string;
      subhead?: string;
      imageAssetId?: string;
      cta?: { label: string; href: string };
    }
  | {
      kind: 'article';
      heading: string;
      body: string;
      imageAssetId?: string;
      link?: { label: string; href: string };
    }
  | {
      kind: 'feature';
      imageAssetId?: string;
      headline: string;
      body: string;
      cta: { label: string; href: string };
    }
  | { kind: 'bullets'; heading?: string; items: string[] }
  | { kind: 'keyValue'; rows: Array<{ label: string; value: string }> }
  | { kind: 'quote'; text: string; author?: string }
  | { kind: 'cta'; label: string; href: string; note?: string }
  | { kind: 'spacer' };

export type BaseTemplateParams = {
  variant: BaseTemplateVariant;
  brand: BrandInput;
  /** BCP 47. MVP 0 dodává texty pro cs a en, jinak se použije en. */
  language: string;
  sections: BaseSectionSpec[];
  websiteUrl?: string;
  darkMode: boolean;
};

export type BuildOptions = { nextId?: () => string };

/**
 * Parametr senderAddress tu vědomě není: adresu nese blok `footer` jako merge tag
 * a hodnotu doplní sender z aktuálního nastavení projektu. Kdyby ji generátor
 * dostával jako řetězec, zapekl by ji a po přestěhování firmy by byly všechny
 * vygenerované šablony špatně.
 */
export function buildBaseTemplate(
  params: BaseTemplateParams,
  options: BuildOptions = {},
): Document {
  const id = options.nextId ?? newBlockId;
  const base = params.language.split('-')[0]!.toLowerCase();
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : 'en';
  const t = (key: string): string => CATALOGS[language]?.[key] ?? CATALOGS.en![key]!;

  const theme = brandToTheme(params.brand);
  const section = (
    children: SectionChild[],
    props: Partial<SectionBlock['props']> = {},
  ): SectionBlock => ({
    id: id(),
    type: 'section',
    props: { ...blockDefaults('section'), ...props },
    children,
  });

  const text = (rich: RichText, over: Record<string, unknown> = {}): SectionChild =>
    ({
      id: id(),
      type: 'text',
      props: { ...blockDefaults('text'), content: rich, ...over },
    }) as SectionChild;

  const heading = (
    level: 1 | 2 | 3,
    value: string,
    over: Record<string, unknown> = {},
  ): SectionChild =>
    ({
      id: id(),
      type: 'heading',
      props: { ...blockDefaults('heading'), level, content: plainToRichText(value), ...over },
    }) as SectionChild;

  const button = (label: string, href: string): SectionChild =>
    ({
      id: id(),
      type: 'button',
      props: { ...blockDefaults('button'), label: plainToRichText(label), href },
    }) as SectionChild;

  const image = (assetId: string, alt = ''): SectionChild =>
    ({
      id: id(),
      type: 'image',
      props: { ...blockDefaults('image'), assetId, alt },
    }) as SectionChild;

  const divider = (): SectionChild =>
    ({ id: id(), type: 'divider', props: blockDefaults('divider') }) as SectionChild;

  const twoColumns = (left: SectionChild[], right: SectionChild[]): ColumnsBlock => ({
    id: id(),
    type: 'columns',
    props: { ...blockDefaults('columns'), layout: '1-1' },
    children: [
      { id: id(), type: 'column', props: blockDefaults('column'), children: left as never },
      { id: id(), type: 'column', props: blockDefaults('column'), children: right as never },
    ],
  });

  const middle: SectionBlock[] = [];
  for (const spec of params.sections) {
    switch (spec.kind) {
      case 'hero':
        middle.push(
          section([
            ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
            heading(1, spec.headline),
            ...(spec.subhead ? [text(plainToRichText(spec.subhead))] : []),
            ...(spec.cta ? [button(spec.cta.label, spec.cta.href)] : []),
          ]),
        );
        break;
      case 'article':
        middle.push(
          section([
            heading(3, spec.heading),
            ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
            text(plainToRichText(spec.body)),
            ...(spec.link
              ? [
                  text([
                    {
                      t: 'p',
                      children: [
                        {
                          t: 'a',
                          href: spec.link.href,
                          children: [{ t: 's', v: spec.link.label }],
                        },
                      ],
                    },
                  ]),
                ]
              : []),
            divider(),
          ]),
        );
        break;
      case 'feature':
        middle.push(
          section([
            ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
            heading(2, spec.headline),
            text(plainToRichText(spec.body)),
            button(spec.cta.label, spec.cta.href),
          ]),
        );
        break;
      case 'bullets':
        middle.push(
          section([
            ...(spec.heading ? [heading(3, spec.heading)] : []),
            text([{ t: 'ul', items: spec.items.map((item) => [{ t: 's' as const, v: item }]) }]),
          ]),
        );
        break;
      case 'keyValue':
        middle.push(
          section(
            spec.rows.map((row) =>
              twoColumns(
                [text(plainToRichText(row.label), { color: 'text.muted' })],
                [text(plainToRichText(row.value))],
              ),
            ),
          ),
        );
        break;
      case 'quote':
        middle.push(
          section([
            text(plainToRichText(spec.text), { align: 'center' }),
            ...(spec.author
              ? [text(plainToRichText(spec.author), { align: 'center', color: 'text.muted' })]
              : []),
          ]),
        );
        break;
      case 'cta':
        middle.push(
          section([
            button(spec.label, spec.href),
            ...(spec.note
              ? [text(plainToRichText(spec.note), { align: 'center', color: 'text.muted' })]
              : []),
          ]),
        );
        break;
      case 'spacer':
        middle.push(
          section([{ id: id(), type: 'spacer', props: blockDefaults('spacer') } as SectionChild]),
        );
        break;
    }
  }

  // Reaktivační varianta má pevný závěr se dvěma tlačítky vedle sebe.
  if (params.variant === 'reengagement') {
    middle.push(
      section([
        twoColumns(
          [button(t('cta.default'), params.websiteUrl ?? 'https://example.com')],
          [
            text([
              {
                t: 'p',
                children: [
                  {
                    t: 'a',
                    href: '{{ unsubscribe_url }}',
                    children: [{ t: 's', v: t('footer.unsubscribe') }],
                  },
                ],
              },
            ]),
          ],
        ),
      ]),
    );
  }

  return {
    schemaVersion: 1,
    // Jméno je v JSON Schema povinné s minLength 1, takže prázdný řetězec, který
    // píše plán, by dokument neprošel vlastním schématem. Varianta je jediná
    // hodnota, kterou generátor v tu chvíli zná, a je deterministická.
    meta: { name: params.variant, previewText: '', language: params.language },
    theme: {
      ...theme,
      darkMode: {
        strategy: params.darkMode ? 'auto' : 'off',
        colors: DEFAULT_THEME.darkMode.colors,
      },
    },
    blocks: [
      // Preheader: skrytý text, který schránka ukáže vedle předmětu.
      section(
        [
          text([{ t: 'p', children: [{ t: 'var', expr: 'campaign.preheader' }] }], {
            fontSize: 10,
            color: 'surface.content',
          }),
        ],
        { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      ),
      ...(params.brand.palette.primary
        ? [
            section([heading(3, '', { content: [] })], {
              padding: { top: 16, right: 24, bottom: 0, left: 24 },
            }),
          ]
        : []),
      ...middle,
      section([
        {
          id: id(),
          type: 'footer',
          props: {
            ...blockDefaults('footer'),
            unsubscribeLabel: t('footer.unsubscribe'),
            preferencesLabel: t('footer.preferences'),
            webviewLabel: t('footer.webview'),
          },
        } as SectionChild,
      ]),
    ],
  };
}
