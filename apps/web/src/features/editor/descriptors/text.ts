import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
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
        /*
         * PÍSMO SE TU UŽ NENABÍZÍ. `TextBlockView` má
         *   fontFamily: props.fontFamily ? theme.fonts.body : theme.fonts.body
         * tedy obě větve stejné: text dostane vždy písmo z motivu. Výběr v panelu
         * neměl žádný následek. Písmo textu se nastavuje v panelu motivu.
         */
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
