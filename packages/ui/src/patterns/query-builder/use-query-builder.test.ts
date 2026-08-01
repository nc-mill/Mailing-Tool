import { describe, expect, it, vi } from 'vitest';
import { OPERATOR_SHAPES, MAX_CHILDREN, MAX_DEPTH } from './types';
import {
  addCondition,
  addGroup,
  canAddGroup,
  canAddRule,
  nodeAt,
  removeAt,
  setField,
  setOperator,
  setOp,
  setValue,
  toggleNot,
} from './paths';
import type { GroupNode, SegmentAst } from './types';

const empty: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', not: false, children: [] },
};

const city = {
  id: 'attribute:city',
  label: 'Město',
  group: 'Údaje kontaktu',
  ref: { kind: 'attribute', key: 'city' } as const,
  valueType: 'text' as const,
  operators: [
    { id: 'eq', label: 'je', shape: 'scalar' as const },
    { id: 'in', label: 'je jedna z', shape: 'list' as const, minItems: 1, maxItems: 1000 },
    { id: 'is_empty', label: 'je prázdné', shape: 'none' as const },
  ],
};

const createdAt = {
  id: 'contact:created_at',
  label: 'Vytvořen',
  group: 'Údaje kontaktu',
  ref: { kind: 'contact', key: 'created_at' } as const,
  valueType: 'date' as const,
  operators: [
    { id: 'on', label: 'dne', shape: 'scalar' as const },
    { id: 'between', label: 'mezi', shape: 'range' as const },
    { id: 'in_last_days', label: 'za posledních', shape: 'integer' as const, min: 1, max: 3650 },
  ],
};

describe('rozklad operátorů na tvary hodnoty', () => {
  it('pokrývá přesně 40 operátorů matice části 2 a nic dvakrát', () => {
    const all = Object.values(OPERATOR_SHAPES).flat();
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });

  it('velikosti jednotlivých tvarů sedí s tabulkou 4.11.2', () => {
    expect(OPERATOR_SHAPES.none).toHaveLength(16);
    expect(OPERATOR_SHAPES.scalar).toHaveLength(13);
    expect(OPERATOR_SHAPES.list).toHaveLength(5);
    expect(OPERATOR_SHAPES.range).toHaveLength(1);
    expect(OPERATOR_SHAPES.integer).toHaveLength(5);
  });
});

describe('operace nad AST adresované cestou', () => {
  it('přidá podmínku do kořene', () => {
    const next = addCondition(empty.root, []);
    expect(next.children).toHaveLength(1);
    expect(next.children[0]!.type).toBe('condition');
  });

  it('dovolí zanoření do hloubky 5', () => {
    let root: GroupNode = empty.root;
    let path: number[] = [];
    for (let level = 0; level < 4; level += 1) {
      root = addGroup(root, path);
      path = [...path, (nodeAt(root, path) as GroupNode).children.length - 1];
    }
    expect(path).toHaveLength(4);
    expect(canAddGroup(root, path)).toBe(false);
  });

  it('šestou úroveň nepřidá a nevyhodí chybu', () => {
    let root: GroupNode = empty.root;
    let path: number[] = [];
    for (let level = 0; level < 4; level += 1) {
      root = addGroup(root, path);
      path = [...path, (nodeAt(root, path) as GroupNode).children.length - 1];
    }
    const before = JSON.stringify(root);
    expect(() => {
      root = addGroup(root, path);
    }).not.toThrow();
    expect(JSON.stringify(root)).toBe(before);
  });

  it('nedovolí víc než 50 potomků jedné skupiny', () => {
    let root: GroupNode = empty.root;
    for (let index = 0; index < 60; index += 1) root = addCondition(root, []);
    expect(root.children).toHaveLength(MAX_CHILDREN);
    expect(canAddRule(root, [])).toBe(false);
  });

  it('unese sto podmínek rozložených do stromu (kritérium 47)', () => {
    // Kritérium 47 mluví o sta podmínkách, tvrdý požadavek 13.1 o 50 potomcích
    // na skupinu. Není to spor: strom hloubky 5 unese sto podmínek s rezervou.
    let root: GroupNode = empty.root;
    for (let group = 0; group < 4; group += 1) {
      root = addGroup(root, []);
      for (let index = 0; index < 25; index += 1) root = addCondition(root, [group]);
    }
    const count = (node: GroupNode): number =>
      node.children.reduce((sum, child) => sum + (child.type === 'group' ? count(child) : 1), 0);
    expect(count(root)).toBe(100);
    expect(MAX_DEPTH).toBe(5);
  });

  it('negaci jde přepnout na kořeni i na vnořené skupině', () => {
    let root = toggleNot(empty.root, []);
    expect(root.not).toBe(true);
    root = addGroup(root, []);
    root = toggleNot(root, [0]);
    expect((nodeAt(root, [0]) as GroupNode).not).toBe(true);
  });

  it('přepínač všechny nebo alespoň jednu mění op', () => {
    expect(setOp(empty.root, [], 'or').op).toBe('or');
  });

  it('odebrání podmínky nechá zbytek beze změny', () => {
    let root = addCondition(empty.root, []);
    root = setValue(root, [0], { value: 'první' });
    root = addCondition(root, []);
    root = setValue(root, [1], { value: 'druhá' });
    root = removeAt(root, [0]);
    expect(root.children).toHaveLength(1);
    expect(nodeAt(root, [0])).toMatchObject({ value: 'druhá' });
  });

  it('změna pole vynuluje operátor i hodnotu, protože operátory se liší podle typu', () => {
    let root = addCondition(empty.root, []);
    root = setField(root, [0], city);
    root = setOperator(root, [0], city.operators[0]!);
    root = setValue(root, [0], { value: 'Brno' });
    root = setField(root, [0], createdAt);
    const node = nodeAt(root, [0]);
    expect(node).toEqual({
      type: 'condition',
      field: { kind: 'contact', key: 'created_at' },
      operator: '',
    });
  });

  it('operátor bez hodnoty smaže value i values z uzlu', () => {
    // Část 2, 4.11.2: „přítomnost value nebo values je chyba".
    let root = addCondition(empty.root, []);
    root = setField(root, [0], city);
    root = setOperator(root, [0], city.operators[1]!);
    root = setValue(root, [0], { values: ['Praha', 'Brno'] });
    expect(nodeAt(root, [0])).toHaveProperty('values');

    root = setOperator(root, [0], city.operators[2]!);
    const node = nodeAt(root, [0]) as Record<string, unknown>;
    expect('value' in node).toBe(false);
    expect('values' in node).toBe(false);
  });

  it('přepnutí na rozsah připraví právě dvě místa na hodnoty', () => {
    let root = addCondition(empty.root, []);
    root = setField(root, [0], createdAt);
    root = setOperator(root, [0], createdAt.operators[1]!);
    expect(nodeAt(root, [0])).toMatchObject({ values: [null, null] });
  });

  it('operace nikdy nemění vstupní strom, vrací nový', () => {
    const frozen = JSON.stringify(empty.root);
    addCondition(empty.root, []);
    toggleNot(empty.root, []);
    removeAt(empty.root, [0]);
    expect(JSON.stringify(empty.root)).toBe(frozen);
  });
});

describe('useQueryBuilder', () => {
  it('ohlásí strom až po úpravě, ne stav před ní', async () => {
    // Vada, kterou tenhle test hlídá: komponenta volala onChange s hodnotou
    // z předchozího vykreslení, takže obrazovka segmentu byla trvale
    // o jednu úpravu pozadu. Řízená komponenta to vylučuje z principu.
    const { renderHook, act } = await import('@testing-library/react');
    const { useQueryBuilder } = await import('./use-query-builder');
    const onChange = vi.fn();
    const { result } = renderHook(() => useQueryBuilder({ value: empty, onChange }));

    act(() => result.current.addCondition([]));

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]![0] as SegmentAst;
    expect(emitted.root.children).toHaveLength(1);
    expect(emitted.version).toBe(1);
  });
});
