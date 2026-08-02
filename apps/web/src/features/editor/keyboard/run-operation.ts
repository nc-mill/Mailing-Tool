import { descriptorFor } from '../descriptors/registry';
import { findBlock, flatten } from '../model/tree';
import type { EditorStore } from '../state/editor-store';
import type { OperationId } from './operations';

/**
 * Oznámení je **data, ne hotová věta**: klíč a parametry. Skládat řetězec tady
 * by porušilo kritérium 71 části 6 a znemožnilo překlad.
 *
 * `tone` rozhoduje, do které oblasti `aria-live` text půjde. `useAnnouncer()`
 * z P05 vrací dvě metody schválně: úspěšný přesun se hlásí zdvořile, aby
 * nepřerušil čtení, ale odmítnutí musí uživatel slyšet hned, jinak mačká
 * klávesu dál a nic se neděje. Výchozí hodnota je `polite`.
 */
export type Announcement = {
  key: string;
  params?: Record<string, string | number>;
  tone?: 'polite' | 'assertive';
};

export type OperationResult = {
  announce?: Announcement;
  /** true = akce se dá vrátit a volající na ni nabídne toast s vrácením. */
  undo?: boolean;
  /** true = fokus se má přesunout do panelu vlastností. */
  focusProperties?: boolean;
};

function position(store: EditorStore, id: string) {
  const item = flatten(store.getState().document).find((entry) => entry.block.id === id);
  return item ? { position: item.index + 1, total: item.siblings } : null;
}

export function runOperation(store: EditorStore, operation: OperationId): OperationResult {
  const state = store.getState();
  const id = state.selectedId;

  if (operation === 'undo') {
    store.undo();
    return { announce: { key: 'a11y.undone' } };
  }
  if (operation === 'redo') {
    store.redo();
    return { announce: { key: 'a11y.redone' } };
  }
  if (!id) return {};

  const found = findBlock(state.document, id);
  if (!found) return {};
  const label = descriptorFor(found.block.type).label;
  const flat = flatten(state.document);
  const index = flat.findIndex((entry) => entry.block.id === id);

  switch (operation) {
    case 'move-up':
    case 'move-down':
    case 'move-out':
    case 'move-in': {
      const direction = operation.slice(5) as 'up' | 'down' | 'out' | 'in';
      const moved = store.moveByKeyboard(id, direction);
      if (!moved) {
        return {
          announce: { key: 'a11y.moveBlocked', params: { block: label }, tone: 'assertive' },
        };
      }
      const place = position(store, id);
      return {
        announce: {
          key: 'a11y.blockMoved',
          params: { block: label, position: place?.position ?? 1, total: place?.total ?? 1 },
        },
      };
    }
    case 'duplicate': {
      const newId = store.duplicateBlock(id);
      if (!newId) {
        return {
          announce: { key: 'a11y.duplicateBlocked', params: { block: label }, tone: 'assertive' },
        };
      }
      return { announce: { key: 'a11y.blockDuplicated', params: { block: label } }, undo: true };
    }
    case 'delete': {
      /**
       * Výběr se po smazání přesune na souseda, ne na nic.
       *
       * `removeBlock` sám nastaví `selectedId` na null. Kdyby to tak zůstalo,
       * plátno by ztratilo fokus, spadl by na `body` a další úhoz už by se
       * k editoru nedostal: **`Ctrl+Z` by po smazání nešlo z klávesnice vůbec**.
       * Ověřeno v prohlížeči, ne odvozeno.
       */
      const neighbour = flat[index + 1] ?? flat[index - 1];
      store.removeBlock(id);
      if (neighbour && findBlock(store.getState().document, neighbour.block.id)) {
        store.select(neighbour.block.id);
      }
      return { announce: { key: 'a11y.blockDeleted', params: { block: label } }, undo: true };
    }
    case 'insert-after': {
      const parent = found.path.slice(0, -1);
      const at = (found.path[found.path.length - 1] ?? 0) + 1;
      const type = found.block.type === 'section' ? 'section' : 'text';
      store.insertBlock(type, { parent, index: at });
      return {
        announce: { key: 'a11y.blockInserted', params: { block: descriptorFor(type).label } },
      };
    }
    case 'edit':
      return { focusProperties: true };
    case 'select-prev': {
      const target = flat[index - 1];
      if (target) store.select(target.block.id);
      return {};
    }
    case 'select-next': {
      const target = flat[index + 1];
      if (target) store.select(target.block.id);
      return {};
    }
    case 'select-parent': {
      const parentPath = found.path.slice(0, -1);
      if (parentPath.length === 0) return {};
      const parent = flat.find((entry) => entry.path.join('.') === parentPath.join('.'));
      if (parent) store.select(parent.block.id);
      return {};
    }
    case 'select-child': {
      const child = found.block.children?.[0];
      if (child) store.select(child.id);
      return {};
    }
    case 'escape':
      store.select(null);
      return {};
    default:
      return {};
  }
}
