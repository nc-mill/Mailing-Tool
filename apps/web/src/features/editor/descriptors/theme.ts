import { FONT_STACK_OPTIONS } from './common';
import type { PropGroup } from './types';

export const THEME_GROUPS: PropGroup[] = [
  {
    label: 'group.emailLayout',
    props: [
      {
        kind: 'select',
        key: 'contentWidth',
        label: 'prop.contentWidth',
        options: [
          { value: 600, label: 'value.width.600' },
          { value: 640, label: 'value.width.640' },
        ],
      },
      /*
        KLÍČ JE ROLE MOTIVU, ne pole motivu. Obě plochy se kreslí z rolí
        `surface.canvas` a `surface.content` (plátno v `canvas.tsx`, e-mail
        v `emitter/shell.tsx` a `emitter/blocks/section.tsx`), takže panel
        píše rovnou do nich. Dřív měl motiv na tutéž barvu vlastní pole
        `canvasBackground` a `contentBackground`, jenže je nečetl nikdo:
        volba se uložila a nezměnila nic. Dvě cesty k jedné barvě by se stejně
        rozešly, tak zbyla ta, která se kreslí.

        Hodnotu podle klíče proto NEHLEDEJ v `document.theme` cestou s tečkou:
        role jméno s tečkou má a bydlí v `theme.colors`. Obsluhuje to
        `theme-panel.tsx`, viz `ROLE_KEYS`.
      */
      { kind: 'color', key: 'surface.canvas', label: 'prop.canvasBackground', allowThemeRef: true },
      {
        kind: 'color',
        key: 'surface.content',
        label: 'prop.contentBackground',
        allowThemeRef: true,
      },
      {
        kind: 'select',
        key: 'radius',
        label: 'prop.radius',
        options: [
          { value: 0, label: 'value.radius.0' },
          { value: 4, label: 'value.radius.4' },
          { value: 6, label: 'value.radius.6' },
          { value: 8, label: 'value.radius.8' },
          { value: 12, label: 'value.radius.12' },
        ],
      },
    ],
  },
  {
    label: 'group.typography',
    props: [
      {
        kind: 'select',
        key: 'fonts.heading',
        label: 'prop.headingFont',
        options: FONT_STACK_OPTIONS,
      },
      { kind: 'select', key: 'fonts.body', label: 'prop.bodyFont', options: FONT_STACK_OPTIONS },
      {
        kind: 'number',
        key: 'typography.baseFontSize',
        label: 'prop.baseFontSize',
        min: 12,
        max: 20,
        step: 1,
        unit: 'px',
      },
      {
        kind: 'number',
        key: 'typography.baseLineHeight',
        label: 'prop.baseLineHeight',
        min: 1.2,
        max: 2,
        step: 0.1,
        unit: 'x',
      },
      {
        kind: 'select',
        key: 'typography.headingScale',
        label: 'prop.headingScale',
        options: [
          { value: 1.125, label: 'value.scale.1125' },
          { value: 1.2, label: 'value.scale.12' },
          { value: 1.25, label: 'value.scale.125' },
          { value: 1.333, label: 'value.scale.1333' },
        ],
      },
    ],
  },
  {
    label: 'group.darkMode',
    props: [
      {
        kind: 'select',
        key: 'darkMode.strategy',
        label: 'prop.darkMode',
        options: [
          { value: 'auto', label: 'value.darkMode.auto' },
          { value: 'off', label: 'value.darkMode.off' },
        ],
      },
    ],
  },
];
