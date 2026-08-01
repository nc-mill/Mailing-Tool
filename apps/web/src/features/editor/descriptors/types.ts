/** Klíč v namespace `editor`. Píše se bez prefixu, komponenta volá useTranslations('editor'). */
export type I18nKey = string;

export type EditorIconName =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'columns2'
  | 'columns3'
  | 'social'
  | 'footer'
  | 'code'
  | 'section'
  | 'repeat'
  | 'unknown';

export type PropDescriptor =
  | {
      kind: 'color';
      key: string;
      label: I18nKey;
      allowThemeRef: true;
      nullable?: boolean;
      hint?: I18nKey;
    }
  | {
      kind: 'number';
      key: string;
      label: I18nKey;
      min: number;
      max: number;
      step: number;
      unit: 'px' | '%' | 'x';
      nullable?: boolean;
      hint?: I18nKey;
      /** Hodnota, kterou vlastnost dostane při vypnutí. Výchozí je null, `image.width` má "full". */
      nullValue?: unknown;
    }
  | {
      kind: 'select';
      key: string;
      label: I18nKey;
      options: Array<{ value: string | number; label: I18nKey }>;
      hint?: I18nKey;
    }
  | { kind: 'toggle'; key: string; label: I18nKey; hint?: I18nKey }
  | { kind: 'padding'; key: string; label: I18nKey }
  | {
      kind: 'richtext';
      key: string;
      label: I18nKey;
      allowLists: boolean;
      singleParagraph?: boolean;
    }
  | { kind: 'asset'; key: string; label: I18nKey; nullable?: boolean; hint?: I18nKey }
  | { kind: 'link'; key: string; label: I18nKey; trackableKey?: string }
  | { kind: 'text'; key: string; label: I18nKey; maxLength: number; hint?: I18nKey }
  | {
      kind: 'code';
      key: string;
      label: I18nKey;
      maxLength: number;
      permission: 'templates:write_html';
    }
  | { kind: 'socialItems'; key: string; label: I18nKey; max: number }
  | { kind: 'visibility'; key: 'visibleWhen'; label: I18nKey };

export type PropGroup = { label: I18nKey; props: PropDescriptor[] };

export type BlockDescriptor = {
  type: string;
  label: I18nKey;
  icon: EditorIconName;
  /** false u `column`, `repeat` a neznámých bloků: v paletě se nenabízejí. */
  inPalette: boolean;
  groups: PropGroup[];
  defaults: Record<string, unknown>;
  /** Klíče vlastností, u kterých se v panelu ukáže ikona s textem `hint.outlookIgnored`. */
  outlookHints?: string[];
};
