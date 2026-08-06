import type {
  ButtonProps,
  ColumnProps,
  ColumnsProps,
  DividerProps,
  FooterProps,
  HeadingProps,
  HtmlProps,
  ImageProps,
  Padding,
  RepeatProps,
  SectionProps,
  SocialProps,
  SpacerProps,
  TextProps,
  Theme,
} from './types';

export const DEFAULT_THEME: Theme = {
  contentWidth: 600,
  colors: {},
  fonts: { heading: 'system', body: 'system' },
  typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
  radius: 6,
  darkMode: { strategy: 'auto', colors: {} },
};

const pad = (top: number, right: number, bottom: number, left: number): Padding => ({
  top,
  right,
  bottom,
  left,
});

const COMMON = {
  padding: pad(0, 24, 16, 24),
  backgroundColor: null,
  hideOnMobile: false,
} as const;

const DEFAULTS = {
  section: {
    backgroundColor: null,
    outerBackgroundColor: null,
    backgroundImageAssetId: null,
    backgroundPosition: 'center',
    padding: pad(24, 24, 24, 24),
    fullWidth: false,
    roundedTop: false,
    roundedBottom: false,
  } satisfies SectionProps,
  columns: {
    layout: '1-1',
    gap: 16,
    stackOnMobile: true,
    stackOrder: 'normal',
    verticalAlign: 'top',
  } satisfies ColumnsProps,
  column: {
    padding: pad(0, 0, 0, 0),
    backgroundColor: null,
    borderRadius: 0,
  } satisfies ColumnProps,
  repeat: { ...COMMON, path: '' } satisfies RepeatProps,
  heading: {
    ...COMMON,
    level: 2,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    fontWeight: 700,
    lineHeight: null,
    letterSpacing: 0,
  } satisfies HeadingProps,
  text: {
    ...COMMON,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    linkColor: 'link.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    lineHeight: null,
  } satisfies TextProps,
  image: {
    ...COMMON,
    assetId: '',
    alt: '',
    decorative: false,
    width: 'full',
    align: 'center',
    href: null,
    trackable: true,
    borderRadius: null,
    darkVariantAssetId: null,
  } satisfies ImageProps,
  button: {
    ...COMMON,
    label: [{ t: 'p', children: [{ t: 's', v: 'Zjistit více' }] }],
    href: '',
    trackable: true,
    style: 'solid',
    backgroundColor: 'brand.primary',
    textColor: 'text.inverted',
    borderColor: null,
    borderWidth: 0,
    borderRadius: null,
    fullWidth: false,
    align: 'center',
    paddingX: 28,
    paddingY: 14,
    fontSize: 16,
  } satisfies ButtonProps,
  divider: {
    ...COMMON,
    color: 'surface.subtle',
    thickness: 1,
    style: 'solid',
    width: 100,
    align: 'center',
  } satisfies DividerProps,
  spacer: { ...COMMON, height: 24, heightMobile: null } satisfies SpacerProps,
  html: { ...COMMON, code: '' } satisfies HtmlProps,
  social: {
    ...COMMON,
    items: [],
    iconStyle: 'color',
    iconSize: 28,
    gap: 12,
    align: 'center',
  } satisfies SocialProps,
  footer: {
    ...COMMON,
    // Poštovní adresa se čte z dat zprávy, nikdy se nezapéká při kompilaci (3.2.12).
    senderInfo: [{ t: 'p', children: [{ t: 'var', expr: 'workspace.sender_address' }] }],
    showUnsubscribe: true,
    unsubscribeLabel: 'Odhlásit se z odběru',
    showPreferences: true,
    preferencesLabel: 'Nastavit předvolby',
    showWebview: true,
    webviewLabel: 'Zobrazit v prohlížeči',
    fontSize: 12,
    color: 'text.muted',
  } satisfies FooterProps,
} as const;

export type BlockTypeWithDefaults = keyof typeof DEFAULTS;

/**
 * Vrací vlastní kopii, ne sdílený objekt. Volající výchozí hodnoty rozprostírá do
 * nového bloku a mutuje je; sdílená reference by tichou změnou přepsala výchozí
 * hodnoty pro celý proces a projevila by se až u jiného dokumentu.
 */
export function blockDefaults<T extends BlockTypeWithDefaults>(type: T): (typeof DEFAULTS)[T] {
  return structuredClone(DEFAULTS[type]) as (typeof DEFAULTS)[T];
}

export const KNOWN_BLOCK_TYPES: readonly string[] = [
  'section',
  'columns',
  'column',
  'repeat',
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'html',
  'social',
  'footer',
];
