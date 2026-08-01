import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups, FONT_STACK_OPTIONS } from './common';
import type { BlockDescriptor } from './types';

export const TEXT_DESCRIPTOR: BlockDescriptor = {
  type: 'text',
  label: 'block.text',
  icon: 'text',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [{ kind: 'richtext', key: 'content', label: 'prop.content', allowLists: true }],
    },
    {
      label: 'group.style',
      props: [
        { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
        { kind: 'color', key: 'linkColor', label: 'prop.linkColor', allowThemeRef: true },
        {
          kind: 'select',
          key: 'align',
          label: 'prop.align',
          options: [...ALIGN_OPTIONS, { value: 'justify', label: 'value.align.justify' }],
        },
        {
          kind: 'select',
          key: 'fontFamily',
          label: 'prop.fontFamily',
          options: FONT_STACK_OPTIONS,
        },
        {
          kind: 'number',
          key: 'fontSize',
          label: 'prop.fontSize',
          min: 10,
          max: 32,
          step: 1,
          unit: 'px',
          nullable: true,
        },
        {
          kind: 'number',
          key: 'lineHeight',
          label: 'prop.lineHeight',
          min: 1,
          max: 2.5,
          step: 0.05,
          unit: 'x',
          nullable: true,
        },
      ],
    },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    linkColor: 'link.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    lineHeight: null,
  },
};
