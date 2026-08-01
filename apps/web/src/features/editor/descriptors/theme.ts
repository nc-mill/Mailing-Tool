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
      {
        kind: 'color',
        key: 'canvasBackground',
        label: 'prop.canvasBackground',
        allowThemeRef: true,
      },
      {
        kind: 'color',
        key: 'contentBackground',
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
