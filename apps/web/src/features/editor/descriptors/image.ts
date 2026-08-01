import { ALIGN_OPTIONS, COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const IMAGE_DESCRIPTOR: BlockDescriptor = {
  type: 'image',
  label: 'block.image',
  icon: 'image',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [
        { kind: 'asset', key: 'assetId', label: 'prop.asset' },
        { kind: 'text', key: 'alt', label: 'prop.alt', maxLength: 200, hint: 'hint.altRequired' },
        { kind: 'toggle', key: 'decorative', label: 'prop.decorative', hint: 'hint.decorative' },
        { kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' },
      ],
    },
    {
      label: 'group.style',
      props: [
        {
          kind: 'number',
          key: 'width',
          label: 'prop.width',
          min: 20,
          max: 640,
          step: 10,
          unit: 'px',
          nullable: true,
          nullValue: 'full',
        },
        { kind: 'select', key: 'align', label: 'prop.align', options: ALIGN_OPTIONS },
        {
          kind: 'number',
          key: 'borderRadius',
          label: 'prop.borderRadius',
          min: 0,
          max: 32,
          step: 1,
          unit: 'px',
          nullable: true,
          hint: 'hint.outlookIgnored',
        },
        {
          kind: 'asset',
          key: 'darkVariantAssetId',
          label: 'prop.darkVariant',
          nullable: true,
          hint: 'hint.darkVariant',
        },
      ],
    },
    ...contentGroups(),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    // Prázdný řetězec, ne null: JSON Schema P08 má `assetId` jako string a nový
    // obrázek se stejně nedá uložit bez zvoleného souboru. Odchylka od doslovného
    // zápisu plánu, který tady měl null a neprošel by testem shody se schématem.
    assetId: '',
    alt: '',
    decorative: false,
    width: 'full',
    align: 'center',
    href: null,
    trackable: true,
    borderRadius: null,
    darkVariantAssetId: null,
  },
  outlookHints: ['borderRadius'],
};
