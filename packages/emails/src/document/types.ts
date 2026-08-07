// Mlain Mailer Document v1. Zdroj pravdy je 3.1 části 3 specifikace,
// strojové schéma je v schema/document.v1.schema.json.

export type HexColor = `#${string}`;

export type ThemeColorRole =
  | 'brand.primary'
  | 'brand.secondary'
  | 'brand.accent'
  | 'text.default'
  | 'text.muted'
  | 'text.inverted'
  | 'surface.canvas'
  | 'surface.content'
  | 'surface.subtle'
  | 'link.default';

export type ColorRef = HexColor | ThemeColorRole;

export type FontStackId =
  | 'system'
  | 'arial'
  | 'helvetica'
  | 'verdana'
  | 'tahoma'
  | 'trebuchet'
  | 'georgia'
  | 'times'
  | 'courier';

export type Padding = { top: number; right: number; bottom: number; left: number };

export type HeadingScale = 1.125 | 1.2 | 1.25 | 1.333;
export type Radius = 0 | 4 | 6 | 8 | 12;

/**
 * Motiv dokumentu.
 *
 * PLOCHY JSOU ROLE, NE VLASTNÍ POLE. Motiv míval navíc `canvasBackground`
 * a `contentBackground`, jenže je nečetl nikdo: `resolveTheme` skládá barvy
 * výhradně z `colors`, plátno editoru i emitter kreslí role `surface.canvas`
 * a `surface.content`. Uživatel si v panelu vybral barvu, ta se uložila do
 * dokumentu a nezměnila ani plátno, ani odeslaný e-mail. Panel proto dnes píše
 * rovnou do `colors` a ta dvě pole zmizela, aby k téže barvě nevedly dvě cesty,
 * které se dřív nebo později rozejdou.
 *
 * Uložené dokumenty ta pole ještě nesou. Schéma je proto pořád zná, jen už je
 * nevyžaduje, a nic je nečte.
 */
/**
 * Mapa rolí motivu. Částečná: neuvedená role bere výchozí hodnotu
 * z theme/palette.ts (3.1.4).
 *
 * HODNOTA SMÍ BÝT I JMÉNO JINÉ ROLE, ne jen odstín. „Pozadí plátna = hlavní
 * barva značky" je pak VAZBA, ne kopie odstínu: když se změní značka projektu,
 * změní se `brand.primary` a pozadí plátna jde s ním. Rozvazuje to
 * `resolveTheme`, takže do e-mailu odchází vždycky hex.
 */
export type RoleColorMap = Partial<Record<ThemeColorRole, ColorRef>>;

export type Theme = {
  contentWidth: 600 | 640;
  colors: RoleColorMap;
  fonts: { heading: FontStackId; body: FontStackId };
  typography: { baseFontSize: number; baseLineHeight: number; headingScale: HeadingScale };
  radius: Radius;
  darkMode: { strategy: 'auto' | 'off'; colors: RoleColorMap };
};

export type DateFormat = '%d.%m.%Y' | '%-d.%-m.%Y' | '%Y-%m-%d' | '%d.%m.%Y %H:%M' | '%H:%M';

export type TextInline = { t: 's'; v: string; b?: true; i?: true; u?: true; strike?: true };
export type LinkInline = { t: 'a'; href: string; children: InlineNode[]; trackable?: boolean };
export type BreakInline = { t: 'br' };

/**
 * Liquid výraz je vlastní uzel, ne text se závorkami (3.1.5).
 * `expr` je BEZ argumentů filtrů a BEZ uvozovek; hodnoty argumentů nesou
 * `fallback` a `dateFormat` a doplňuje je až kompilace po renderu (3.3.5).
 * `slots` je interní pole přidělené normalizací, v uloženém JSON nikdy není
 * (JSON Schema má na uzlu `var` additionalProperties: false). Uzel může nést
 * argumenty obou filtrů naráz (`{{ x | date | default }}`), proto dvě čísla, ne jedno.
 */
export type VarInline = {
  t: 'var';
  expr: string;
  fallback?: string;
  dateFormat?: DateFormat;
  slots?: { default?: number; date?: number };
};

export type InlineNode = TextInline | LinkInline | BreakInline | VarInline;

export type RichNode =
  | { t: 'p'; children: InlineNode[]; align?: 'left' | 'center' | 'right' }
  | { t: 'ul'; items: InlineNode[][] }
  | { t: 'ol'; items: InlineNode[][] };

export type RichText = RichNode[];

export type VisibilityCondition = {
  /** Plná cesta pole VČETNĚ prefixu contact., například "contact.attr.mesto". */
  field: string;
  op: 'present' | 'blank' | 'true' | 'false';
};

export type CommonBlockProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  hideOnMobile: boolean;
};

export type SectionProps = {
  backgroundColor: ColorRef | null;
  outerBackgroundColor: ColorRef | null;
  backgroundImageAssetId: string | null;
  backgroundPosition: 'top' | 'center' | 'bottom';
  padding: Padding;
  fullWidth: boolean;
  roundedTop: boolean;
  roundedBottom: boolean;
};

export type ColumnsLayout = '1-1' | '1-2' | '2-1' | '1-1-1' | '2-1-1' | '1-1-2';

export type ColumnsProps = {
  layout: ColumnsLayout;
  gap: number;
  stackOnMobile: boolean;
  stackOrder: 'normal' | 'reverse';
  verticalAlign: 'top' | 'middle' | 'bottom';
};

export type ColumnProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  borderRadius: number;
};

export type HeadingProps = CommonBlockProps & {
  level: 1 | 2 | 3;
  content: RichText;
  color: ColorRef;
  align: 'left' | 'center' | 'right';
  fontFamily: FontStackId | null;
  fontSize: number | null;
  fontWeight: 400 | 600 | 700;
  lineHeight: number | null;
  letterSpacing: number;
};

export type TextProps = CommonBlockProps & {
  content: RichText;
  color: ColorRef;
  linkColor: ColorRef;
  align: 'left' | 'center' | 'right' | 'justify';
  fontFamily: FontStackId | null;
  fontSize: number | null;
  lineHeight: number | null;
};

export type ImageProps = CommonBlockProps & {
  assetId: string;
  alt: string;
  decorative: boolean;
  width: 'full' | number;
  align: 'left' | 'center' | 'right';
  href: string | null;
  trackable: boolean;
  borderRadius: number | null;
  darkVariantAssetId: string | null;
};

export type ButtonProps = CommonBlockProps & {
  label: RichText;
  href: string;
  trackable: boolean;
  style: 'solid' | 'outline';
  backgroundColor: ColorRef;
  textColor: ColorRef;
  borderColor: ColorRef | null;
  borderWidth: 0 | 1 | 2;
  borderRadius: number | null;
  fullWidth: boolean;
  align: 'left' | 'center' | 'right';
  paddingX: number;
  paddingY: number;
  fontSize: number;
};

export type DividerProps = CommonBlockProps & {
  color: ColorRef;
  thickness: 1 | 2 | 3 | 4;
  style: 'solid' | 'dashed' | 'dotted';
  width: number;
  align: 'left' | 'center' | 'right';
};

export type SpacerProps = CommonBlockProps & { height: number; heightMobile: number | null };

export type HtmlProps = CommonBlockProps & { code: string };

export type SocialNetwork =
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'pinterest'
  | 'bluesky'
  | 'mastodon'
  | 'web'
  | 'email';

export type SocialItem = { network: SocialNetwork; href: string; label?: string };

export type SocialProps = CommonBlockProps & {
  items: SocialItem[];
  iconStyle: 'color' | 'mono_dark' | 'mono_light';
  iconSize: number;
  gap: number;
  align: 'left' | 'center' | 'right';
};

export type FooterProps = CommonBlockProps & {
  senderInfo: RichText;
  showUnsubscribe: boolean;
  unsubscribeLabel: string;
  showPreferences: boolean;
  preferencesLabel: string;
  showWebview: boolean;
  webviewLabel: string;
  fontSize: number;
  color: ColorRef;
};

export type RepeatProps = CommonBlockProps & { path: string };

type WithId<T extends string, P, C = never> = {
  id: string;
  type: T;
  props: P;
  visibleWhen?: VisibilityCondition | null;
} & ([C] extends [never] ? Record<never, never> : { children: C });

export type HeadingBlock = WithId<'heading', HeadingProps>;
export type TextBlock = WithId<'text', TextProps>;
export type ImageBlock = WithId<'image', ImageProps>;
export type ButtonBlock = WithId<'button', ButtonProps>;
export type DividerBlock = WithId<'divider', DividerProps>;
export type SpacerBlock = WithId<'spacer', SpacerProps>;
export type HtmlBlock = WithId<'html', HtmlProps>;
export type SocialBlock = WithId<'social', SocialProps>;
export type FooterBlock = WithId<'footer', FooterProps>;

export type ContentBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | HtmlBlock
  | SocialBlock
  | FooterBlock;

/** Neznámý typ bloku se nese jako neprůhledný objekt, aby uložení bylo bajtově shodné (3.1.7). */
export type UnknownBlock = { id: string; type: string; [key: string]: unknown };

export type ColumnBlock = {
  id: string;
  type: 'column';
  props: ColumnProps;
  children: (ContentBlock | UnknownBlock)[];
};

export type ColumnsBlock = {
  id: string;
  type: 'columns';
  props: ColumnsProps;
  children: ColumnBlock[];
};

/** Uzel cyklu. V gramatice od schématu 1, MVP 0 ho nevydává (3.1.2). */
export type RepeatBlock = WithId<'repeat', RepeatProps, (ContentBlock | UnknownBlock)[]>;

export type SectionChild = ColumnsBlock | RepeatBlock | ContentBlock | UnknownBlock;

export type SectionBlock = {
  id: string;
  type: 'section';
  props: SectionProps;
  visibleWhen?: VisibilityCondition | null;
  children: SectionChild[];
};

export type AnyBlock =
  SectionBlock | ColumnsBlock | ColumnBlock | RepeatBlock | ContentBlock | UnknownBlock;

export type DocumentMeta = {
  name: string;
  previewText: string;
  /** BCP 47 tag, libovolný platný (3.1.9). MVP 0 dodává texty pro cs a en. */
  language: string;
};

export type Document = {
  schemaVersion: number;
  meta: DocumentMeta;
  theme: Theme;
  blocks: SectionBlock[];
};

export const CURRENT_SCHEMA_VERSION = 1;

/** Limity dokumentu z 3.1.2. */
export const MAX_BLOCKS_PER_DOCUMENT = 300;
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_SECTIONS = 60;
export const MAX_SECTION_CHILDREN = 40;
export const MAX_COLUMN_CHILDREN = 20;
export const MAX_RICHTEXT_NODES = 200;
export const MAX_TEXT_RUN_CHARS = 5000;
export const MAX_VAR_EXPR_CHARS = 200;
export const MAX_VAR_FALLBACK_CHARS = 100;
export const MAX_LINKS_PER_DOCUMENT = 999;
