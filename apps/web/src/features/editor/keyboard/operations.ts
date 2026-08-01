import type { I18nKey } from '../descriptors/types';

export type OperationId =
  | 'move-up'
  | 'move-down'
  | 'move-out'
  | 'move-in'
  | 'duplicate'
  | 'delete'
  | 'insert-after'
  | 'edit'
  | 'select-prev'
  | 'select-next'
  | 'select-parent'
  | 'select-child'
  | 'undo'
  | 'redo'
  | 'escape';

export type EditorOperation = {
  id: OperationId;
  labelKey: I18nKey;
  /** Zápis kláves. `Mod` je Ctrl nebo Cmd. */
  keys: string[];
  /** true = má tlačítko v ovládání bloku, tedy je dostupná i myší. */
  inToolbar: boolean;
  icon?: 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right' | 'copy' | 'trash';
};

export const OPERATIONS: EditorOperation[] = [
  {
    id: 'move-up',
    labelKey: 'op.moveUp',
    keys: ['Alt+ArrowUp', 'Mod+ArrowUp'],
    inToolbar: true,
    icon: 'arrow-up',
  },
  {
    id: 'move-down',
    labelKey: 'op.moveDown',
    keys: ['Alt+ArrowDown', 'Mod+ArrowDown'],
    inToolbar: true,
    icon: 'arrow-down',
  },
  {
    id: 'move-out',
    labelKey: 'op.moveOut',
    keys: ['Alt+ArrowLeft'],
    inToolbar: true,
    icon: 'arrow-left',
  },
  {
    id: 'move-in',
    labelKey: 'op.moveIn',
    keys: ['Alt+ArrowRight'],
    inToolbar: true,
    icon: 'arrow-right',
  },
  { id: 'duplicate', labelKey: 'op.duplicate', keys: ['Mod+d'], inToolbar: true, icon: 'copy' },
  {
    id: 'delete',
    labelKey: 'op.delete',
    keys: ['Delete', 'Backspace'],
    inToolbar: true,
    icon: 'trash',
  },
  { id: 'insert-after', labelKey: 'op.insertAfter', keys: ['Mod+Enter'], inToolbar: false },
  { id: 'edit', labelKey: 'op.edit', keys: ['Enter'], inToolbar: false },
  { id: 'select-prev', labelKey: 'op.selectPrev', keys: ['ArrowUp'], inToolbar: false },
  { id: 'select-next', labelKey: 'op.selectNext', keys: ['ArrowDown'], inToolbar: false },
  { id: 'select-parent', labelKey: 'op.selectParent', keys: ['ArrowLeft'], inToolbar: false },
  { id: 'select-child', labelKey: 'op.selectChild', keys: ['ArrowRight'], inToolbar: false },
  { id: 'undo', labelKey: 'op.undo', keys: ['Mod+z'], inToolbar: false },
  { id: 'redo', labelKey: 'op.redo', keys: ['Mod+Shift+z'], inToolbar: false },
  { id: 'escape', labelKey: 'op.escape', keys: ['Escape'], inToolbar: false },
];

export const TOOLBAR_OPERATIONS = OPERATIONS.filter((operation) => operation.inToolbar);

export type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

function normalize(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join('+');
}

const BY_KEY = new Map<string, OperationId>();
for (const operation of OPERATIONS) {
  for (const key of operation.keys) BY_KEY.set(key, operation.id);
}

export function matchOperation(event: KeyEventLike): OperationId | null {
  return BY_KEY.get(normalize(event)) ?? null;
}
