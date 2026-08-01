import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const SOCIAL_NETWORKS = [
  'facebook',
  'instagram',
  'x',
  'linkedin',
  'youtube',
  'tiktok',
  'threads',
  'pinterest',
  'bluesky',
  'mastodon',
  'web',
  'email',
] as const;

export const SOCIAL_DESCRIPTOR: BlockDescriptor = {
  type: 'social',
  label: 'block.social',
  icon: 'social',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [{ kind: 'socialItems', key: 'items', label: 'prop.socialItems', max: 8 }],
    },
    {
      label: 'group.style',
      props: [
        {
          kind: 'select',
          key: 'iconStyle',
          label: 'prop.iconStyle',
          options: [
            { value: 'color', label: 'value.iconStyle.color' },
            { value: 'mono_dark', label: 'value.iconStyle.monoDark' },
            { value: 'mono_light', label: 'value.iconStyle.monoLight' },
          ],
        },
        {
          kind: 'number',
          key: 'iconSize',
          label: 'prop.iconSize',
          min: 16,
          max: 48,
          step: 2,
          unit: 'px',
        },
        { kind: 'number', key: 'gap', label: 'prop.gap', min: 0, max: 32, step: 2, unit: 'px' },
        { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
      ],
    },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    items: [],
    iconStyle: 'color',
    iconSize: 28,
    gap: 12,
    align: 'center',
  },
};
