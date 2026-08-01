import type { BlockDescriptor } from './types';

export const COLUMNS_DESCRIPTOR: BlockDescriptor = {
  type: 'columns',
  label: 'block.columns',
  icon: 'columns2',
  inPalette: true,
  groups: [
    {
      label: 'group.layout',
      props: [
        {
          kind: 'select',
          key: 'layout',
          label: 'prop.layout',
          options: [
            { value: '1-1', label: 'value.layout.1-1' },
            { value: '1-2', label: 'value.layout.1-2' },
            { value: '2-1', label: 'value.layout.2-1' },
            { value: '1-1-1', label: 'value.layout.1-1-1' },
            { value: '2-1-1', label: 'value.layout.2-1-1' },
            { value: '1-1-2', label: 'value.layout.1-1-2' },
          ],
        },
        { kind: 'number', key: 'gap', label: 'prop.gap', min: 0, max: 48, step: 2, unit: 'px' },
        {
          kind: 'select',
          key: 'verticalAlign',
          label: 'prop.verticalAlign',
          options: [
            { value: 'top', label: 'value.valign.top' },
            { value: 'middle', label: 'value.valign.middle' },
            { value: 'bottom', label: 'value.valign.bottom' },
          ],
        },
      ],
    },
    {
      label: 'group.mobile',
      props: [
        {
          kind: 'toggle',
          key: 'stackOnMobile',
          label: 'prop.stackOnMobile',
          hint: 'hint.outlookIgnored',
        },
        {
          kind: 'select',
          key: 'stackOrder',
          label: 'prop.stackOrder',
          options: [
            { value: 'normal', label: 'value.stackOrder.normal' },
            { value: 'reverse', label: 'value.stackOrder.reverse' },
          ],
        },
      ],
    },
  ],
  defaults: {
    layout: '1-1',
    gap: 16,
    stackOnMobile: true,
    stackOrder: 'normal',
    verticalAlign: 'top',
  },
};
