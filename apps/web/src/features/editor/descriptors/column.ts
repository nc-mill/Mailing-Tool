import { BACKGROUND_PROP, PADDING_PROP } from './common';
import type { BlockDescriptor } from './types';

/** V paletě není: sloupec vzniká jen jako potomek bloku `columns`. */
export const COLUMN_DESCRIPTOR: BlockDescriptor = {
  type: 'column',
  label: 'block.column',
  icon: 'columns2',
  inPalette: false,
  groups: [
    {
      label: 'group.style',
      props: [
        PADDING_PROP,
        BACKGROUND_PROP,
        {
          kind: 'number',
          key: 'borderRadius',
          label: 'prop.borderRadius',
          min: 0,
          max: 32,
          step: 1,
          unit: 'px',
          hint: 'hint.outlookIgnored',
        },
      ],
    },
  ],
  defaults: {
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    backgroundColor: null,
    borderRadius: 0,
  },
  outlookHints: ['borderRadius'],
};
