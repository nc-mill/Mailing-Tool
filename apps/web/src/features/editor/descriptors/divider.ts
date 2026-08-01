import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const DIVIDER_DESCRIPTOR: BlockDescriptor = {
  type: 'divider',
  label: 'block.divider',
  icon: 'divider',
  inPalette: true,
  groups: [
    {
      label: 'group.style',
      props: [
        { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
        {
          kind: 'select',
          key: 'thickness',
          label: 'prop.thickness',
          options: [
            { value: 1, label: 'value.thickness.1' },
            { value: 2, label: 'value.thickness.2' },
            { value: 3, label: 'value.thickness.3' },
            { value: 4, label: 'value.thickness.4' },
          ],
        },
        {
          kind: 'select',
          key: 'style',
          label: 'prop.lineStyle',
          options: [
            { value: 'solid', label: 'value.lineStyle.solid' },
            { value: 'dashed', label: 'value.lineStyle.dashed' },
            { value: 'dotted', label: 'value.lineStyle.dotted' },
          ],
          hint: 'hint.outlookLineStyle',
        },
        {
          kind: 'number',
          key: 'width',
          label: 'prop.lineWidth',
          min: 10,
          max: 100,
          step: 5,
          unit: '%',
        },
        { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
      ],
    },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    color: 'surface.subtle',
    thickness: 1,
    style: 'solid',
    width: 100,
    align: 'center',
  },
};
