import { BACKGROUND_PROP, PADDING_PROP, VISIBILITY_PROP } from './common';
import type { BlockDescriptor } from './types';

export const SECTION_DESCRIPTOR: BlockDescriptor = {
  type: 'section',
  label: 'block.section',
  icon: 'section',
  inPalette: true,
  groups: [
    {
      label: 'group.style',
      props: [
        BACKGROUND_PROP,
        {
          kind: 'color',
          key: 'outerBackgroundColor',
          label: 'prop.outerBackgroundColor',
          allowThemeRef: true,
          nullable: true,
        },
        {
          kind: 'asset',
          key: 'backgroundImageAssetId',
          label: 'prop.backgroundImage',
          nullable: true,
        },
        {
          kind: 'select',
          key: 'backgroundPosition',
          label: 'prop.backgroundPosition',
          options: [
            { value: 'top', label: 'value.position.top' },
            { value: 'center', label: 'value.position.center' },
            { value: 'bottom', label: 'value.position.bottom' },
          ],
        },
        {
          kind: 'toggle',
          key: 'roundedTop',
          label: 'prop.roundedTop',
          hint: 'hint.outlookIgnored',
        },
        {
          kind: 'toggle',
          key: 'roundedBottom',
          label: 'prop.roundedBottom',
          hint: 'hint.outlookIgnored',
        },
      ],
    },
    {
      label: 'group.layout',
      props: [PADDING_PROP, { kind: 'toggle', key: 'fullWidth', label: 'prop.fullWidth' }],
    },
    { label: 'group.visibility', props: [VISIBILITY_PROP] },
  ],
  defaults: {
    backgroundColor: null,
    outerBackgroundColor: null,
    backgroundImageAssetId: null,
    backgroundPosition: 'center',
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    fullWidth: false,
    roundedTop: false,
    roundedBottom: false,
  },
  outlookHints: ['roundedTop', 'roundedBottom'],
};
