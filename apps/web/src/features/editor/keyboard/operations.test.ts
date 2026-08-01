import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createEditorStore } from '../state/editor-store';
import { matchOperation, OPERATIONS, type OperationId, TOOLBAR_OPERATIONS } from './operations';
import { runOperation } from './run-operation';

/** Klávesová zkratka zapsaná jako `Alt+ArrowUp` převedená na událost. */
function eventFor(key: string) {
  const parts = key.split('+');
  return {
    key: parts[parts.length - 1]!,
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    ctrlKey: parts.includes('Mod'),
    metaKey: false,
  };
}

describe('registr operací', () => {
  it('každá operace má aspoň jednu klávesovou zkratku', () => {
    for (const operation of OPERATIONS) {
      expect(operation.keys.length, operation.id).toBeGreaterThan(0);
    }
  });

  it('každá operace v ovládání bloku má ikonu i zkratku, takže myš a klávesnice umí totéž', () => {
    for (const operation of TOOLBAR_OPERATIONS) {
      expect(operation.icon, operation.id).toBeDefined();
      expect(operation.keys.length, operation.id).toBeGreaterThan(0);
    }
    expect(TOOLBAR_OPERATIONS.map((o) => o.id)).toEqual([
      'move-up',
      'move-down',
      'move-out',
      'move-in',
      'duplicate',
      'delete',
    ]);
  });

  it('každá deklarovaná zkratka se rozpozná zpátky na svou operaci', () => {
    for (const operation of OPERATIONS) {
      for (const key of operation.keys) {
        const parts = key.split('+');
        const event = {
          key: parts[parts.length - 1]!,
          altKey: parts.includes('Alt'),
          shiftKey: parts.includes('Shift'),
          ctrlKey: parts.includes('Mod'),
          metaKey: false,
        };
        expect(matchOperation(event), key).toBe(operation.id);
      }
    }
  });

  it('přesun je na Alt se šipkami a Ctrl je alias, obojí ze specifikace', () => {
    expect(
      matchOperation({
        key: 'ArrowUp',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('move-up');
    expect(
      matchOperation({
        key: 'ArrowUp',
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('move-up');
    expect(
      matchOperation({
        key: 'ArrowRight',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('move-in');
  });

  it('holá šipka posouvá výběr, ne blok', () => {
    expect(
      matchOperation({
        key: 'ArrowDown',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('select-next');
  });

  it('neznámá kombinace se nerozpozná a nechá událost projít dál', () => {
    expect(
      matchOperation({ key: 'F5', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }),
    ).toBeNull();
  });

  it('popisky operací jsou navzájem různé překladové klíče', () => {
    const labels = OPERATIONS.map((o) => o.labelKey);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('registr zná každou operaci z typu, a to právě jednou', () => {
    // Seznam je psaný ručně a typ `OperationId` ho hlídá: přidat operaci do typu
    // a zapomenout ji zaregistrovat znamená chybu překladu tady, ne tichou díru
    // v klávesové obsluze. Odebrat ji z typu a nechat v registru spadne taky.
    const expected: Record<OperationId, true> = {
      'move-up': true,
      'move-down': true,
      'move-out': true,
      'move-in': true,
      duplicate: true,
      delete: true,
      'insert-after': true,
      edit: true,
      'select-prev': true,
      'select-next': true,
      'select-parent': true,
      'select-child': true,
      undo: true,
      redo: true,
      escape: true,
    };
    expect(OPERATIONS.map((o) => o.id).sort()).toEqual(Object.keys(expected).sort());
  });
});

/**
 * Tvrdý požadavek části 6, 8.5.1, bodu 4: co umí tažení myší, musí jít i z klávesnice.
 *
 * Deklarace v registru na to nestačí. Zkratku i ikonu jde dopsat k operaci, která
 * nedělá nic, a test výš by prošel. Tažení bloku umí čtyři věci: posunout výš,
 * posunout níž, zasunout do kontejneru a vytáhnout ven. Tenhle test u všech čtyř
 * ověří celý řetěz: operace je v registru, má klávesu, má tlačítko v ovládání bloku,
 * stisk té klávesy se rozpozná na tuhle operaci a dokument se po něm SKUTEČNĚ změní.
 * Klávesová cesta, která by zůstala jen na papíře, tady spadne.
 */
describe('rovnocennost myši a klávesnice', () => {
  const doc = (): EditorDocument =>
    ({
      schemaVersion: 1,
      meta: { name: 'T', previewText: '', language: 'cs' },
      theme: {},
      blocks: [
        {
          id: 'b_s1',
          type: 'section',
          props: {},
          children: [
            { id: 'b_h1', type: 'heading', props: {} },
            { id: 'b_t1', type: 'text', props: {} },
            {
              id: 'b_c1',
              type: 'columns',
              props: {},
              children: [
                {
                  id: 'b_col1',
                  type: 'column',
                  props: {},
                  children: [{ id: 'b_d1', type: 'divider', props: {} }],
                },
                { id: 'b_col2', type: 'column', props: {}, children: [] },
              ],
            },
          ],
        },
      ],
    }) as unknown as EditorDocument;

  const cases: Array<[OperationId, string]> = [
    ['move-up', 'b_t1'],
    ['move-down', 'b_h1'],
    ['move-in', 'b_t1'],
    ['move-out', 'b_d1'],
  ];

  it.each(cases)('výsledek tažení %s jde vyvolat klávesnicí a opravdu přesune blok', (id, on) => {
    const operation = OPERATIONS.find((entry) => entry.id === id);
    expect(operation, `operace ${id} chybí v registru`).toBeDefined();
    expect(operation!.keys.length, `${id} nemá klávesu`).toBeGreaterThan(0);
    expect(operation!.inToolbar, `${id} nemá tlačítko pro myš`).toBe(true);
    expect(operation!.icon, `${id} nemá ikonu`).toBeDefined();

    const [key] = operation!.keys;
    expect(matchOperation(eventFor(key!)), `${key} se nerozpozná na ${id}`).toBe(id);

    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.select(on);
    const before = store.getState().document;
    const result = runOperation(store, id);

    expect(result.announce?.key, `${id} neohlásil novou pozici`).toBe('a11y.blockMoved');
    expect(store.getState().document, `${id} dokument nezměnil`).not.toBe(before);
  });

  it('žádný ze čtyř výsledků tažení nechybí, ovládání bloku je má všechny', () => {
    const inToolbar = TOOLBAR_OPERATIONS.map((entry) => entry.id);
    for (const [id] of cases) expect(inToolbar, `${id} chybí v ovládání bloku`).toContain(id);
  });
});
