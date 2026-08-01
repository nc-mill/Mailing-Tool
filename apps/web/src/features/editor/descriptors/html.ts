import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const HTML_DESCRIPTOR: BlockDescriptor = {
  type: 'html',
  label: 'block.html',
  icon: 'code',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [
        {
          kind: 'code',
          key: 'code',
          label: 'prop.code',
          maxLength: 20000,
          permission: 'templates:write_html',
        },
      ],
    },
    ...contentGroups(),
  ],
  defaults: { ...COMMON_DEFAULTS, code: '' },
};
