import type { PropDescriptor, PropGroup } from './types';

export const PROP_KINDS = [
  'color',
  'number',
  'select',
  'toggle',
  'padding',
  'richtext',
  'asset',
  'link',
  'text',
  'code',
  'socialItems',
  'visibility',
] as const;

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'value.align.left' },
  { value: 'center', label: 'value.align.center' },
  { value: 'right', label: 'value.align.right' },
];

export const FONT_STACK_OPTIONS = [
  { value: 'system', label: 'value.font.system' },
  { value: 'arial', label: 'value.font.arial' },
  { value: 'helvetica', label: 'value.font.helvetica' },
  { value: 'verdana', label: 'value.font.verdana' },
  { value: 'tahoma', label: 'value.font.tahoma' },
  { value: 'trebuchet', label: 'value.font.trebuchet' },
  { value: 'georgia', label: 'value.font.georgia' },
  { value: 'times', label: 'value.font.times' },
  { value: 'courier', label: 'value.font.courier' },
];

export const PADDING_PROP: PropDescriptor = {
  kind: 'padding',
  key: 'padding',
  label: 'prop.padding',
};

export const BACKGROUND_PROP: PropDescriptor = {
  kind: 'color',
  key: 'backgroundColor',
  label: 'prop.backgroundColor',
  allowThemeRef: true,
  nullable: true,
};

export const HIDE_ON_MOBILE_PROP: PropDescriptor = {
  kind: 'toggle',
  key: 'hideOnMobile',
  label: 'prop.hideOnMobile',
  hint: 'hint.outlookIgnored',
};

export const VISIBILITY_PROP: PropDescriptor = {
  kind: 'visibility',
  key: 'visibleWhen',
  label: 'prop.visibleWhen',
};

export const COMMON_DEFAULTS = {
  padding: { top: 0, right: 24, bottom: 16, left: 24 },
  backgroundColor: null,
  hideOnMobile: false,
} as const;

/**
 * Skupiny, které má každý obsahový blok.
 *
 * Vypínače nejsou kosmetika, jsou to místa, kde emitter vlastnost NEPOUŽIJE:
 *
 * - `visibility: false` je patička (pravidlo S14, `visibleWhen` nemá ani ve schématu),
 * - `padding: false` je mezera. `SpacerBlockView` posílá do rámu natvrdo samé nuly
 *   (`packages/emails/src/emitter/blocks/spacer.tsx`), takže odsazení z panelu
 *   se sice uloží do dokumentu, ale do e-mailu se nikdy nedostane. Výšku má
 *   mezera vlastní vlastností a odsazení by k ní jen tiše přičítalo nic.
 * - `hideOnMobile: false` je patička. `FooterBlockView` posílá do rámu
 *   `hideOnMobile={false}`, protože právní minimum musí dostat každý příjemce.
 *
 * Pravidlo je jednoduché: co nemá vliv, se nemá dát nastavit. Nastavení, které
 * se tváří, že se uložilo, a nemá následek, je horší než chybějící nastavení.
 */
export function contentGroups(
  options: { visibility?: boolean; padding?: boolean; hideOnMobile?: boolean } = {},
): PropGroup[] {
  const layout: PropDescriptor[] = [];
  if (options.padding !== false) layout.push(PADDING_PROP);
  layout.push(BACKGROUND_PROP);
  if (options.hideOnMobile !== false) layout.push(HIDE_ON_MOBILE_PROP);

  const groups: PropGroup[] = [{ label: 'group.layout', props: layout }];
  if (options.visibility !== false) {
    groups.push({ label: 'group.visibility', props: [VISIBILITY_PROP] });
  }
  return groups;
}
