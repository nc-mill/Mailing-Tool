'use client';

import type {
  ButtonBlock,
  ColumnBlock,
  ColumnsBlock,
  DividerBlock,
  FooterBlock,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  SectionBlock,
  SocialBlock,
  SpacerBlock,
  TextBlock,
} from '@mlain/emails/document/types';
import { paddingStyle, px } from '@mlain/emails/emitter/style';
import { columnWidths } from '@mlain/emails/normalize/columns';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { EditorBlock } from '../../../model/document-types';
import { blockDefaults, KNOWN_BLOCK_TYPES } from '../../../model/document-types';
import { useCanvas } from './canvas-context';
import { RichView } from './rich-view';

/**
 * Jediné přetypování vlastností v celém plátně.
 *
 * `EditorBlock.props` je `Record<string, unknown>`, protože operace nad stromem
 * jsou na typu bloku nezávislé (viz `model/document-types.ts`). Vzhled na typu
 * bloku ale závisí, takže se tady jednou zúží na typ z P08.
 *
 * Dřívější plátno mělo `block.props as Record<string, never>` a komentář, že se
 * vlastnosti čtou „netypově". `never` znamená, že KAŽDÝ přístup k vlastnosti
 * potřeboval další přetypování na místě použití, a typová kontrola tím
 * nekontrolovala vůbec nic. Tohle je opak: jedno přetypování a od něj dál
 * skutečné typy P08.
 */
function propsOf<T>(block: EditorBlock): T {
  return { ...defaultsFor(block.type), ...block.props } as T;
}

/**
 * Výchozí vlastnosti z P08 jako podklad, aby plátno nespadlo na neúplném bloku.
 *
 * Schéma sice všechny vlastnosti vyžaduje, ale plátno kreslí i dokumenty, které
 * schématem projít nemusí: rozpracovaný návrh od AI, starší verze po migraci,
 * blok z budoucí verze aplikace. Bez podkladu by `padding` chybělo, `paddingStyle`
 * sáhlo na `padding.left` a **zbělalo by celé plátno**, ne jen jeden blok.
 * Zbělaný editor je horší vada než blok s výchozím odsazením.
 */
function defaultsFor(type: string): Record<string, unknown> {
  return KNOWN_BLOCK_TYPES.includes(type)
    ? (blockDefaults(type as Parameters<typeof blockDefaults>[0]) as Record<string, unknown>)
    : {};
}

/**
 * Řádkování v pixelech, stejně jako `lineHeightStyle` v emitteru.
 *
 * Emitterová verze přidává `msoLineHeightRule: 'exactly'`, což je vlastnost pro
 * Word engine. V prohlížeči je to neznámá vlastnost stylu a React na ni nadává
 * do konzole, takže plátno počítá jen samotné číslo. Vzorec je týž, proto se
 * text na plátně a v e-mailu láme stejně.
 */
function lineHeightPx(fontSize: number, lineHeight: number): string {
  return px(fontSize * lineHeight);
}

/**
 * Rám obsahového bloku, obdoba `BlockFrame` z emitteru.
 *
 * Emitter kreslí tabulku, protože Word engine `padding` na `<div>` ignoruje.
 * Prohlížeč tuhle vadu nemá, takže plátno kreslí `<div>` se stejným odsazením
 * a stejným pozadím. Výsledek je na pixel týž a DOM je o tři úrovně mělčí,
 * což se hodí, protože se do něj montuje editace textu.
 */
function Frame({
  block,
  align,
  style,
  padding,
  backgroundColor,
  children,
}: {
  block: EditorBlock;
  align?: 'left' | 'center' | 'right' | 'justify' | undefined;
  style?: CSSProperties | undefined;
  /** Přebije odsazení z vlastností bloku. Používá jen mezera, jako v emitteru. */
  padding?: { top: number; right: number; bottom: number; left: number } | undefined;
  /**
   * Přebije barvu pozadí rámu.
   *
   * Tlačítko sem posílá `null`, protože jeho `props.backgroundColor` je barva
   * SAMOTNÉHO TLAČÍTKA, ne pruhu kolem něj. Bez toho se modrá roztáhla přes
   * celou šířku e-mailu a vypadalo to, jako by tlačítko bylo přes celý řádek.
   * Emitter to řeší stejně: `ButtonBlockView` předává `backgroundColor={null}`.
   */
  backgroundColor?: string | null | undefined;
  children: ReactNode;
}): ReactElement {
  const { theme, mobile } = useCanvas();
  const props = propsOf<{
    padding: { top: number; right: number; bottom: number; left: number };
    backgroundColor: string | null;
    hideOnMobile: boolean;
  }>(block);
  const ref = backgroundColor === undefined ? props.backgroundColor : backgroundColor;
  const background = ref ? theme.light.color(ref as never) : undefined;
  return (
    <div
      style={{
        ...mobilePadding(paddingStyle(padding ?? props.padding), mobile, theme),
        ...(background ? { backgroundColor: background } : {}),
        textAlign: align ?? 'left',
        // `.ml-hide-m` v mobilním @media. Blok se skutečně nekreslí, jen se
        // schová: kdyby zmizel z DOM, rozpadly by se cesty ve stromu a klávesová
        // navigace by po přepnutí na mobil ukazovala na jiné bloky.
        ...(mobile && props.hideOnMobile ? { display: 'none' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Vodorovné odsazení v mobilním zobrazení, pravidlo `.ml-pad`.
 *
 * Emitter dává třídu `ml-pad` na `<td>` každého rámu i sekce a v mobilním
 * `@media` jí přepíše levé a pravé odsazení na `theme.mobile.pad`. Svislé
 * odsazení zůstává. Plátno dělá totéž jediným místem, ať se to nerozejde.
 */
function mobilePadding(
  padding: CSSProperties,
  mobile: boolean,
  theme: { mobile: { pad: number } },
): CSSProperties {
  if (!mobile) return padding;
  return { ...padding, paddingLeft: px(theme.mobile.pad), paddingRight: px(theme.mobile.pad) };
}

export type BlockViewProps = {
  block: EditorBlock;
  /** Šířka obsahové oblasti v pixelech. Obrázek i tlačítko z ní počítají rozměr. */
  width: number;
  canWriteHtml: boolean;
  /** Vykreslení potomků. Dodává skořápka, aby si mohla potomky obalit ovládáním. */
  renderChild?: ((child: EditorBlock, width: number) => ReactNode) | undefined;
  /**
   * Vykreslení CELÉHO seznamu potomků, i s místy upuštění mezi nimi a s výzvou
   * v prázdném sloupci. Když chybí, kreslí se jen potomci: náhled bez ovládání.
   */
  renderList?: ((children: EditorBlock[], width: number) => ReactNode) | undefined;
  /** Bohatý text. Když chybí, kreslí se jen ke čtení. */
  renderRich?: ((input: RichSlot) => ReactNode) | undefined;
};

export type RichSlot = {
  block: EditorBlock;
  propKey: string;
  value: unknown;
  color: string;
  linkColor: string;
  align?: 'left' | 'center' | 'right' | 'justify' | undefined;
  style?: CSSProperties | undefined;
  /** Popisek tlačítka se kreslí řádkově, aby tlačítko nenarostlo na celou šířku. */
  inline?: boolean | undefined;
};

/** Vykreslí blok tak, jak bude vypadat v e-mailu. */
export function BlockView(props: BlockViewProps): ReactElement | null {
  switch (props.block.type) {
    case 'section':
      return <SectionView {...props} />;
    case 'columns':
      return <ColumnsView {...props} />;
    /*
     * SLOUPEC MÁ VLASTNÍ VĚTEV. Bez ní spadl do `default`, tedy na `LockedView`
     * s hláškou „tenhle blok jde jen prohlížet", a obsah sloupce se na plátně
     * VŮBEC NEVYKRESLIL. Uživatel vložil rozvržení „Dva sloupce" a dostal dvě
     * cedule, do kterých nešlo nic přidat ani v nich nic upravit; model přitom
     * potomky sloupce zná (`ColumnBlock.children` v `document/types.ts`)
     * a emitter je kreslí.
     */
    case 'column':
      return <ColumnBody view={props} column={props.block} innerWidth={props.width} />;
    case 'heading':
      return <HeadingView {...props} />;
    case 'text':
      return <TextView {...props} />;
    case 'button':
      return <ButtonView {...props} />;
    case 'image':
      return <ImageView {...props} />;
    case 'divider':
      return <DividerView {...props} />;
    case 'spacer':
      return <SpacerView {...props} />;
    case 'social':
      return <SocialView {...props} />;
    case 'footer':
      return <FooterView {...props} />;
    case 'html':
      return <HtmlView {...props} />;
    default:
      return <LockedView {...props} />;
  }
}

function Rich(props: { view: BlockViewProps } & Omit<RichSlot, 'block'>): ReactElement {
  const { view, ...slot } = props;
  if (view.renderRich) return <>{view.renderRich({ block: view.block, ...slot })}</>;
  return (
    <RichView
      value={slot.value as never}
      color={slot.color}
      linkColor={slot.linkColor}
      align={slot.align}
      style={slot.style}
      inline={slot.inline}
    />
  );
}

function SectionView(view: BlockViewProps): ReactElement {
  const { theme, mobile, viewport, darkOverride, assets } = useCanvas();
  const p = propsOf<SectionBlock['props']>(view.block);
  // Šířka obsahu sekce. Na mobilu se sekce roztáhne na šířku plochy (600px
  // s `max-width:100%` v 375px ploše) a odsazení přebije `.ml-pad`.
  const outerWidth = mobile ? viewport : theme.contentWidth;
  const horizontal = mobile ? theme.mobile.pad * 2 : p.padding.left + p.padding.right;
  const innerWidth = Math.max(1, outerWidth - horizontal);
  const inner = darkOverride(
    'surface.content',
    p.backgroundColor ? theme.light.color(p.backgroundColor) : theme.light.roles['surface.content'],
  );
  const outer = darkOverride(
    'surface.canvas',
    p.outerBackgroundColor
      ? theme.light.color(p.outerBackgroundColor)
      : theme.light.roles['surface.canvas'],
  );
  const radius = px(theme.radius);
  // Pozadí obrázkem kreslí emitter atributem `background` na vnější buňku
  // (plus VML pro Outlook). Plátno ho dřív ignorovalo, takže si uživatel vybral
  // obrázek na pozadí a na ploše se nezměnilo nic.
  const backgroundAsset = p.backgroundImageAssetId ? assets[p.backgroundImageAssetId] : undefined;

  return (
    <div
      style={{
        backgroundColor: outer,
        display: 'flex',
        justifyContent: 'center',
        ...(backgroundAsset
          ? {
              backgroundImage: `url(${backgroundAsset.url})`,
              backgroundPosition: p.backgroundPosition,
              backgroundSize: 'cover',
            }
          : {}),
      }}
    >
      <div
        style={{
          width: p.fullWidth ? '100%' : px(theme.contentWidth),
          maxWidth: '100%',
          backgroundColor: inner,
          borderTopLeftRadius: p.roundedTop ? radius : undefined,
          borderTopRightRadius: p.roundedTop ? radius : undefined,
          borderBottomLeftRadius: p.roundedBottom ? radius : undefined,
          borderBottomRightRadius: p.roundedBottom ? radius : undefined,
          ...mobilePadding(paddingStyle(p.padding), mobile, theme),
        }}
      >
        {view.renderList
          ? view.renderList(view.block.children ?? [], innerWidth)
          : (view.block.children ?? []).map((child) => (
              <BlockView key={child.id} {...view} block={child} width={innerWidth} />
            ))}
      </div>
    </div>
  );
}

function ColumnsView(view: BlockViewProps): ReactElement {
  const { theme, mobile } = useCanvas();
  const p = propsOf<ColumnsBlock['props']>(view.block);
  const children = view.block.children ?? [];
  const widths = columnWidths(p.layout, p.gap, view.width);
  // `.ml-col` v mobilním @media: sloupce se skládají pod sebe přes celou šířku,
  // ale jen když si to blok přeje (`stackOnMobile`). Bez toho by plátno na mobilu
  // ukazovalo dvousloupcové rozvržení, které příjemci nikdy nedojde.
  const stacked = mobile && p.stackOnMobile;

  /*
   * Sloupce vedle sebe, jako v e-mailu. Dřívější plátno je kreslilo pod sebou
   * s odsazením podle úrovně, takže uživatel z plátna vůbec nepoznal, že si
   * rozvržení do sloupců rozdělil.
   *
   * MEZI SLOUPCI SE NEKRESLÍ ŽÁDNÁ MEZERA, i když ji vlastnost `gap` má.
   * Emitter ji totiž nikam nekreslí: `columnWidths` o ni jen zúží sloupce
   * (`available = innerWidth - gap * (n - 1)`) a samotné sloupce jsou vedle
   * sebe `inline-block` v buňce s `font-size: 0`, takže mezi nimi není nic a
   * ušetřené místo zbude na konci řádku. Ověřeno ve zlatém vzorku
   * `03-two-columns.html`: dva sloupce po 268 px v buňce široké 552 px.
   *
   * Plátno tedy kreslí totéž, co dojde příjemci, i když to není hezké.
   * Kdyby si mezeru domalovalo, slibovalo by rozestup, který v e-mailu není.
   * Oprava patří do emitteru (P08) a je popsaná v reportu.
   */
  return (
    <div
      style={{
        display: 'flex',
        // Na mobilu pod sebe (`.ml-col`), jinak vedle sebe. Sloupec dole nese
        // `order`, aby šlo napodobit `stackOrder: 'reverse'`; to v prostém
        // `display: block` nejde, protože `order` platí jen ve flexu.
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'stretch' : toFlexAlign(p.verticalAlign),
      }}
    >
      {children.map((column, index) => {
        const columnProps = propsOf<ColumnBlock['props']>(column);
        const width = stacked
          ? view.width
          : (widths[index] ?? Math.floor(view.width / Math.max(1, children.length)));
        const innerWidth = Math.max(
          1,
          width - columnProps.padding.left - columnProps.padding.right,
        );
        return (
          <div
            key={column.id}
            style={{
              width: stacked ? '100%' : px(width),
              maxWidth: '100%',
              // Pořadí na mobilu. Emitter sloupce v `stackOrder: 'reverse'`
              // emituje obráceně už do HTML, plátno je jen přeskládá stylem,
              // aby ve stromu zůstaly v pořadí dokumentu.
              ...(stacked && p.stackOrder === 'reverse' ? { order: children.length - index } : {}),
              borderRadius: px(columnProps.borderRadius),
              ...(columnProps.backgroundColor
                ? { backgroundColor: theme.light.color(columnProps.backgroundColor) }
                : {}),
            }}
          >
            {view.renderChild ? (
              view.renderChild(column, innerWidth)
            ) : (
              <ColumnBody view={view} column={column} innerWidth={innerWidth} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ColumnBody({
  view,
  column,
  innerWidth,
}: {
  view: BlockViewProps;
  column: EditorBlock;
  innerWidth: number;
}): ReactElement {
  const columnProps = propsOf<ColumnBlock['props']>(column);
  const children = column.children ?? [];
  return (
    <div style={paddingStyle(columnProps.padding)} data-column={column.id}>
      {view.renderList
        ? view.renderList(children, innerWidth)
        : children.map((child) => (
            <BlockView key={child.id} {...view} block={child} width={innerWidth} />
          ))}
    </div>
  );
}

function toFlexAlign(value: 'top' | 'middle' | 'bottom'): CSSProperties['alignItems'] {
  return value === 'top' ? 'flex-start' : value === 'bottom' ? 'flex-end' : 'center';
}

function HeadingView(view: BlockViewProps): ReactElement {
  const { theme, mobile, darkOverride } = useCanvas();
  const p = propsOf<HeadingBlock['props']>(view.block);
  // `.ml-h1` až `.ml-h3` v mobilním @media přebijí i vlastní velikost z panelu,
  // protože nesou `!important`. Plátno se drží téhož, jinak by na mobilu
  // slibovalo větší nadpis, než jaký příjemce uvidí.
  const size = mobile
    ? theme.mobile.headingSize(p.level)
    : (p.fontSize ?? theme.headingSize(p.level));
  const lineHeight = mobile ? theme.mobile.headingLineHeight : (p.lineHeight ?? 1.25);
  // `.ml-text` v tmavém režimu přebije barvu nadpisu na `text.default`.
  const color = darkOverride('text.default', theme.light.color(p.color));
  const Tag = (['h1', 'h2', 'h3'] as const)[p.level - 1] ?? 'h1';
  return (
    <Frame block={view.block} align={p.align}>
      <Tag
        style={{
          margin: 0,
          fontFamily: theme.fonts.heading,
          fontSize: px(size),
          fontWeight: p.fontWeight,
          letterSpacing: px(p.letterSpacing),
          textAlign: p.align,
          color,
          lineHeight: lineHeightPx(size, lineHeight),
        }}
      >
        <Rich
          view={view}
          propKey="content"
          value={p.content}
          color={color}
          linkColor={darkOverride('link.default', theme.light.roles['link.default'])}
          align={p.align}
          style={{ fontSize: px(size), fontWeight: p.fontWeight }}
        />
      </Tag>
    </Frame>
  );
}

function TextView(view: BlockViewProps): ReactElement {
  const { theme, darkOverride } = useCanvas();
  const p = propsOf<TextBlock['props']>(view.block);
  const size = p.fontSize ?? theme.baseFontSize;
  const lineHeight = p.lineHeight ?? theme.baseLineHeight;
  // `.ml-text` a `.ml-link`: v tmavém režimu vyhrávají nad vlastní barvou.
  const color = darkOverride('text.default', theme.light.color(p.color));
  return (
    <Frame
      block={view.block}
      style={{
        fontFamily: theme.fonts.body,
        fontSize: px(size),
        color,
        lineHeight: lineHeightPx(size, lineHeight),
      }}
    >
      <Rich
        view={view}
        propKey="content"
        value={p.content}
        color={color}
        linkColor={darkOverride('link.default', theme.light.color(p.linkColor))}
        align={p.align}
        style={{ fontSize: px(size), lineHeight: lineHeightPx(size, lineHeight) }}
      />
    </Frame>
  );
}

function ButtonView(view: BlockViewProps): ReactElement {
  const { theme, mobile } = useCanvas();
  const p = propsOf<ButtonBlock['props']>(view.block);
  // `.ml-btn{width:100%!important}` v mobilním @media. Tlačítko je na mobilu
  // vždy přes celou šířku, i když `fullWidth` vypnuté je.
  const fullWidth = p.fullWidth || mobile;
  const background = theme.light.color(p.backgroundColor);
  const textColor = theme.light.color(p.textColor);
  const border = p.borderColor ? theme.light.color(p.borderColor) : background;
  const radius = p.borderRadius ?? theme.radius;
  const outline = p.style === 'outline';
  const face = outline ? background : textColor;
  return (
    <Frame block={view.block} align={p.align} backgroundColor={null}>
      <span
        style={{
          display: fullWidth ? 'block' : 'inline-block',
          backgroundColor: outline ? '#ffffff' : background,
          borderRadius: px(radius),
          border: `${px(p.borderWidth)} solid ${border}`,
          padding: `${px(p.paddingY)} ${px(p.paddingX)}`,
          ...(fullWidth ? { width: '100%', textAlign: 'center' } : {}),
        }}
      >
        <span
          style={{
            display: 'inline-block',
            fontFamily: theme.fonts.body,
            fontSize: px(p.fontSize),
            fontWeight: 'bold',
            lineHeight: px(Math.round(p.fontSize * 1.2)),
            color: face,
          }}
        >
          <Rich
            view={view}
            propKey="label"
            value={p.label}
            color={face}
            linkColor={face}
            inline
            style={{ fontSize: px(p.fontSize), fontWeight: 'bold' }}
          />
        </span>
      </span>
    </Frame>
  );
}

function ImageView(view: BlockViewProps): ReactElement {
  const t = useTranslations('editor');
  const { theme, assets, pickAsset, darkActive } = useCanvas();
  const p = propsOf<ImageBlock['props']>(view.block);
  /*
   * V tmavém režimu se kreslí tmavá varianta, jestli ji blok má.
   *
   * Emitter posílá obě a přepíná mezi nimi třídami `.ml-logo-light`
   * a `.ml-logo-dark` uvnitř `@media (prefers-color-scheme: dark)`. Plátno tedy
   * ukazuje totéž, co uvidí příjemce s tmavým režimem, jinak by uživatel tmavou
   * variantu nastavil a nikdy neviděl.
   */
  const darkVariant = darkActive && p.darkVariantAssetId ? assets[p.darkVariantAssetId] : undefined;
  const asset = darkVariant ?? (p.assetId ? assets[p.assetId] : undefined);
  const displayWidth = p.width === 'full' ? view.width : Math.min(p.width, view.width);
  const radius = p.borderRadius ?? theme.radius;

  // Blok bez vybraného obrázku není chyba uživatele, je to nedokončený krok.
  // Kreslí se jako klikací výzva rovnou na plátně, ne jako varování v pruhu
  // nálezů. Dřív se v téhle situaci hlásilo „Obrázek už v knihovně není",
  // což je hláška o obrázku, který tam nikdy nebyl, a uživatel z ní nepoznal,
  // že si má obrázek vybrat.
  if (!asset) {
    return (
      <Frame block={view.block} align={p.align}>
        <button
          type="button"
          data-testid="image-placeholder"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            pickAsset?.(view.block.id, 'assetId');
          }}
          style={{
            width: px(displayWidth),
            maxWidth: '100%',
            minHeight: '96px',
            borderRadius: px(radius),
            border: '2px dashed var(--color-border)',
            background: 'var(--color-surface-muted)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          {p.assetId ? t('canvas.imageMissing') : t('canvas.imagePick')}
        </button>
      </Frame>
    );
  }

  const height =
    asset.width && asset.height ? Math.round((displayWidth * asset.height) / asset.width) : null;

  return (
    <Frame block={view.block} align={p.align}>
      {/* Obyčejný `img`: adresa přichází z portu za běhu a `next/image` by na ni
          potřeboval statickou konfiguraci domén, kterou vlastní P01. Táž úvaha
          jako v `properties/controls/asset-control.tsx`. */}
      <img
        src={asset.url}
        alt={p.decorative ? '' : p.alt}
        width={displayWidth}
        {...(height ? { height } : {})}
        style={{
          display: 'inline-block',
          border: 0,
          maxWidth: '100%',
          height: 'auto',
          borderRadius: px(radius),
        }}
      />
    </Frame>
  );
}

function DividerView(view: BlockViewProps): ReactElement {
  const { theme } = useCanvas();
  const p = propsOf<DividerBlock['props']>(view.block);
  return (
    <Frame block={view.block} align={p.align}>
      <div
        style={{
          display: 'inline-block',
          width: `${p.width}%`,
          borderTop: `${px(p.thickness)} ${p.style} ${theme.light.color(p.color)}`,
        }}
      />
    </Frame>
  );
}

function SpacerView(view: BlockViewProps): ReactElement {
  const p = propsOf<SpacerBlock['props']>(view.block);
  // Mezera má vlastní odsazení vždy nulové, výšku nese `height`. Stejně jako
  // v emitteru, kde `SpacerBlockView` posílá do rámu samé nuly.
  return (
    <Frame block={view.block} padding={{ top: 0, right: 0, bottom: 0, left: 0 }}>
      <div style={{ height: px(p.height) }} aria-hidden />
    </Frame>
  );
}

function SocialView(view: BlockViewProps): ReactElement {
  const { theme } = useCanvas();
  const p = propsOf<SocialBlock['props']>(view.block);
  /*
   * Ikony sítí dodává produkt jako obrázky ze své vlastní adresy
   * (`socialIconUrl` v `packages/emails/src/emitter/assets.ts`), kterou plátno
   * nezná: základní adresu assetů zná až kompilace na serveru. Plátno proto
   * kreslí kolečko se zkratkou sítě ve správné velikosti a rozestupu, takže
   * rozvržení řádku sedí, i když konkrétní ikona ne. Skutečné ikony ukáže
   * náhled, který jede stejnou cestou jako odeslaný e-mail.
   */
  const dark = p.iconStyle !== 'mono_light';
  return (
    <Frame block={view.block} align={p.align}>
      <span style={{ display: 'inline-flex', gap: px(p.gap), alignItems: 'center' }}>
        {p.items.map((item, index) => (
          <span
            key={`${item.network}-${index}`}
            title={item.network}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: px(p.iconSize),
              height: px(p.iconSize),
              borderRadius: '999px',
              backgroundColor: dark
                ? theme.light.roles['text.default']
                : theme.light.roles['surface.subtle'],
              color: dark ? theme.light.roles['text.inverted'] : theme.light.roles['text.default'],
              fontSize: px(Math.max(9, Math.round(p.iconSize * 0.42))),
              textTransform: 'uppercase',
            }}
          >
            {item.network.slice(0, 2)}
          </span>
        ))}
      </span>
    </Frame>
  );
}

function FooterView(view: BlockViewProps): ReactElement {
  const { theme, darkOverride } = useCanvas();
  const p = propsOf<FooterBlock['props']>(view.block);
  // Patička nese `.ml-muted` a odkazy v ní `.ml-link`.
  const color = darkOverride('text.muted', theme.light.color(p.color));
  const linkColor = darkOverride('link.default', color);
  const links = [
    p.showUnsubscribe ? p.unsubscribeLabel : null,
    p.showPreferences ? p.preferencesLabel : null,
    p.showWebview ? p.webviewLabel : null,
  ].filter((label): label is string => Boolean(label));

  return (
    <Frame
      block={view.block}
      align="center"
      style={{
        fontFamily: theme.fonts.body,
        fontSize: px(p.fontSize),
        color,
        lineHeight: lineHeightPx(p.fontSize, 1.5),
      }}
    >
      <div style={{ color, textAlign: 'center' }}>
        <Rich
          view={view}
          propKey="senderInfo"
          value={p.senderInfo}
          color={color}
          linkColor={linkColor}
          align="center"
          style={{ fontSize: px(p.fontSize) }}
        />
      </div>
      <div style={{ color, textAlign: 'center', paddingTop: '8px' }}>
        {links.map((label, index) => (
          <span key={label}>
            {index > 0 ? ' | ' : null}
            <span style={{ color: linkColor, textDecoration: 'underline' }}>{label}</span>
          </span>
        ))}
      </div>
    </Frame>
  );
}

function HtmlView(view: BlockViewProps): ReactElement {
  const t = useTranslations('editor');
  const p = propsOf<HtmlBlock['props']>(view.block);
  if (!view.canWriteHtml) {
    return (
      <Frame block={view.block}>
        <p data-testid="html-forbidden" style={{ margin: 0, fontSize: '12px' }}>
          {t('block.htmlForbidden')}
        </p>
      </Frame>
    );
  }
  /*
   * Vlastní HTML se na plátně NEVYKRESLUJE, ukazuje se jeho zdroj.
   *
   * Vložit obsah dokumentu do stránky editoru jako živý markup by znamenalo
   * pustit ho do DOM aplikace, tedy pod stejný původ jako relace uživatele.
   * Skript z bloku html by pak běžel s právy přihlášeného člověka. Náhled to
   * dělat může, protože běží v `iframe` se `sandbox` a s CSP uvnitř `srcdoc`;
   * plátno takovou izolaci nemá, a proto ji nesmí obcházet.
   */
  return (
    <Frame block={view.block}>
      <pre
        style={{
          margin: 0,
          overflowX: 'auto',
          background: 'var(--color-surface-muted)',
          color: 'var(--color-text-muted)',
          padding: '8px',
          fontSize: '12px',
        }}
      >
        {p.code}
      </pre>
    </Frame>
  );
}

function LockedView(view: BlockViewProps): ReactElement {
  const t = useTranslations('editor');
  return (
    <div
      style={{
        padding: '8px',
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-muted)',
        fontSize: '13px',
      }}
    >
      {t('block.lockedHint', { type: view.block.type })}
    </div>
  );
}
