import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const HEADING_DESCRIPTOR: BlockDescriptor = {
  type: 'heading',
  label: 'block.heading',
  icon: 'heading',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [
        {
          kind: 'richtext',
          key: 'content',
          label: 'prop.content',
          allowLists: false,
          singleParagraph: true,
        },
        {
          kind: 'select',
          key: 'level',
          label: 'prop.level',
          options: [
            { value: 1, label: 'value.level.1' },
            { value: 2, label: 'value.level.2' },
            { value: 3, label: 'value.level.3' },
          ],
        },
      ],
    },
    {
      label: 'group.style',
      props: [
        { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
        { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
        /*
         * PÍSMO SE TU UŽ NENABÍZÍ, protože emitter vlastnost bloku nepoužívá:
         *
         *   fontFamily: props.fontFamily ? theme.fonts.heading : theme.fonts.heading
         *
         * Obě větve podmínky jsou totožné, takže nadpis dostane vždy písmo
         * z motivu, ať uživatel v panelu vybere cokoliv. Rozbalovátko s devíti
         * písmy tedy devětkrát nedělalo nic.
         *
         * Písmo se nastavuje v panelu motivu (nadpisy zvlášť, text zvlášť) a to
         * funguje. Vlastnost bloku zůstává ve schématu i v uložených šablonách.
         */
        {
          kind: 'number',
          key: 'fontSize',
          label: 'prop.fontSize',
          min: 12,
          max: 48,
          step: 1,
          unit: 'px',
          nullable: true,
        },
        {
          kind: 'select',
          key: 'fontWeight',
          label: 'prop.fontWeight',
          options: [
            { value: 400, label: 'value.weight.400' },
            { value: 600, label: 'value.weight.600' },
            { value: 700, label: 'value.weight.700' },
          ],
        },
        {
          kind: 'number',
          key: 'lineHeight',
          label: 'prop.lineHeight',
          min: 1,
          max: 2,
          step: 0.05,
          unit: 'x',
          nullable: true,
        },
        {
          kind: 'number',
          key: 'letterSpacing',
          label: 'prop.letterSpacing',
          min: -1,
          max: 4,
          step: 0.5,
          unit: 'px',
          hint: 'hint.outlookIgnored',
        },
      ],
    },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    level: 2,
    content: [{ t: 'p', children: [] }],
    color: 'text.default',
    align: 'left',
    fontFamily: null,
    fontSize: null,
    fontWeight: 700,
    lineHeight: null,
    letterSpacing: 0,
  },
  outlookHints: ['letterSpacing'],
};
