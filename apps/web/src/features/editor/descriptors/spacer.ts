import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const SPACER_DESCRIPTOR: BlockDescriptor = {
  type: 'spacer',
  label: 'block.spacer',
  icon: 'spacer',
  inPalette: true,
  groups: [
    {
      label: 'group.style',
      props: [
        {
          kind: 'number',
          key: 'height',
          label: 'prop.height',
          min: 4,
          max: 120,
          step: 4,
          unit: 'px',
        },
        {
          kind: 'number',
          key: 'heightMobile',
          label: 'prop.heightMobile',
          min: 4,
          max: 120,
          step: 4,
          unit: 'px',
          nullable: true,
          hint: 'hint.outlookIgnored',
        },
      ],
    },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, height: 24, heightMobile: null },
  outlookHints: ['heightMobile'],
};
