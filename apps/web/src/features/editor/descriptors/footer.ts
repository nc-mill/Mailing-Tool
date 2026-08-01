import { COMMON_DEFAULTS, contentGroups } from './common';
import type { BlockDescriptor } from './types';

export const FOOTER_DESCRIPTOR: BlockDescriptor = {
  type: 'footer',
  label: 'block.footer',
  icon: 'footer',
  inPalette: true,
  groups: [
    {
      label: 'group.content',
      props: [
        { kind: 'richtext', key: 'senderInfo', label: 'prop.senderInfo', allowLists: false },
        {
          kind: 'toggle',
          key: 'showUnsubscribe',
          label: 'prop.showUnsubscribe',
          hint: 'hint.unsubscribeRequired',
        },
        { kind: 'text', key: 'unsubscribeLabel', label: 'prop.unsubscribeLabel', maxLength: 60 },
        { kind: 'toggle', key: 'showPreferences', label: 'prop.showPreferences' },
        { kind: 'text', key: 'preferencesLabel', label: 'prop.preferencesLabel', maxLength: 60 },
        { kind: 'toggle', key: 'showWebview', label: 'prop.showWebview' },
        { kind: 'text', key: 'webviewLabel', label: 'prop.webviewLabel', maxLength: 60 },
      ],
    },
    {
      label: 'group.style',
      props: [
        {
          kind: 'number',
          key: 'fontSize',
          label: 'prop.fontSize',
          min: 10,
          max: 16,
          step: 1,
          unit: 'px',
        },
        { kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true },
      ],
    },
    ...contentGroups({ visibility: false }),
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    senderInfo: [{ t: 'p', children: [{ t: 'var', expr: 'workspace.sender_address' }] }],
    showUnsubscribe: true,
    unsubscribeLabel: 'Odhlásit se z odběru',
    showPreferences: true,
    preferencesLabel: 'Nastavit předvolby',
    showWebview: true,
    webviewLabel: 'Zobrazit v prohlížeči',
    fontSize: 12,
    color: 'text.muted',
  },
};
