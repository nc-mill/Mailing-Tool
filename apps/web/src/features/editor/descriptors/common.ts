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

/** Skupiny, které má každý obsahový blok. `visibility: false` je jen patička (pravidlo S14). */
export function contentGroups(options: { visibility?: boolean } = {}): PropGroup[] {
  const groups: PropGroup[] = [
    { label: 'group.layout', props: [PADDING_PROP, BACKGROUND_PROP, HIDE_ON_MOBILE_PROP] },
  ];
  if (options.visibility !== false) {
    groups.push({ label: 'group.visibility', props: [VISIBILITY_PROP] });
  }
  return groups;
}
