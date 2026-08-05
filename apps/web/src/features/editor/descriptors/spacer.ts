import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const SPACER_DESCRIPTOR: BlockDescriptor = {
  type: 'spacer',
  label: 'block.spacer',
  icon: 'spacer',
  inPalette: true,
  /*
   * MEZERA NABÍZÍ JEN TO, CO SE PROJEVÍ.
   *
   * Odsazení tu není, protože `SpacerBlockView` posílá do rámu natvrdo nuly.
   * Mobilní výška tu není, protože `heightMobile` neužije ani emitter, ani
   * `buildHeadCss`: v celém `packages/emails/src` se ta vlastnost jen deklaruje
   * ve schématu a nikde nečte. Obojí se dřív nastavit dalo a nemělo to žádný
   * následek, což uživatel našel sám na odsazení.
   *
   * Výchozí hodnoty ZŮSTÁVAJÍ (`padding`, `heightMobile` níž): schéma je
   * vyžaduje a starší šablony je mají uložené. Mizí ovládání, ne data.
   */
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
      ],
    },
    ...contentGroups({ padding: false }),
  ],
  defaults: { ...COMMON_DEFAULTS, height: 24, heightMobile: null },
  outlookHints: ['heightMobile'],
};
